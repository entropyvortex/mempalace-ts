/**
 * @module migrate
 * Recover a palace created with a different ChromaDB version.
 *
 * 1:1 PORT from original migrate.py.
 * Reads documents and metadata directly from the palace's SQLite database
 * (bypassing ChromaDB's API, which fails on version-mismatched palaces),
 * then re-imports everything into a fresh palace using the currently installed
 * ChromaDB version.
 *
 * This fixes upgrade paths where chromadb was downgraded or upgraded across
 * breaking on-disk format changes.
 */

import { existsSync, copyFileSync, mkdirSync, rmSync, renameSync, statSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { ChromaClient } from 'chromadb';
import { resolvePath, expandHome } from './utils/paths.js';
import { DEFAULT_COLLECTION_NAME } from './types.js';

/** Batch size for re-importing drawers. */
const IMPORT_BATCH = 500;

/** A drawer extracted directly from SQLite. */
export interface SqliteDrawer {
  id: string;
  document: string;
  metadata: Record<string, string | number | boolean>;
}

/** Summary of wings and rooms found during migration. */
export interface MigrationSummary {
  wings: Record<string, Record<string, number>>;
  totalDrawers: number;
}

/** Result returned by {@link migrate}. */
export interface MigrateResult {
  success: boolean;
  drawersImported: number;
  backupPath?: string;
}

/**
 * Read all drawers directly from ChromaDB's SQLite, bypassing the API.
 *
 * Python: migrate.py extract_drawers_from_sqlite()
 *
 * Works regardless of which ChromaDB version created the database.
 *
 * @param dbPath - Path to the chroma.sqlite3 file
 * @returns Array of drawers with id, document, and metadata
 */
export function extractDrawersFromSqlite(dbPath: string): SqliteDrawer[] {
  const resolved = resolvePath(dbPath);
  const db = new Database(resolved, { readonly: true });

  try {
    // Get all embedding IDs and their documents
    const rows = db.prepare(`
      SELECT e.embedding_id,
             MAX(CASE WHEN em.key = 'chroma:document' THEN em.string_value END) as document
      FROM embeddings e
      JOIN embedding_metadata em ON em.id = e.id
      GROUP BY e.embedding_id
    `).all() as Array<{ embedding_id: string; document: string | null }>;

    const drawers: SqliteDrawer[] = [];

    const metaStmt = db.prepare(`
      SELECT em.key, em.string_value, em.int_value, em.float_value, em.bool_value
      FROM embedding_metadata em
      JOIN embeddings e ON e.id = em.id
      WHERE e.embedding_id = ?
        AND em.key NOT LIKE 'chroma:%'
    `);

    for (const row of rows) {
      if (!row.document) continue;

      const metaRows = metaStmt.all(row.embedding_id) as Array<{
        key: string;
        string_value: string | null;
        int_value: number | null;
        float_value: number | null;
        bool_value: number | null;
      }>;

      const metadata: Record<string, string | number | boolean> = {};
      for (const mr of metaRows) {
        if (mr.string_value !== null) {
          metadata[mr.key] = mr.string_value;
        } else if (mr.int_value !== null) {
          metadata[mr.key] = mr.int_value;
        } else if (mr.float_value !== null) {
          metadata[mr.key] = mr.float_value;
        } else if (mr.bool_value !== null) {
          metadata[mr.key] = mr.bool_value !== 0;
        }
      }

      drawers.push({
        id: row.embedding_id,
        document: row.document,
        metadata,
      });
    }

    return drawers;
  } finally {
    db.close();
  }
}

/**
 * Detect which ChromaDB version created the database by checking schema.
 *
 * Python: migrate.py detect_chromadb_version()
 *
 * @param dbPath - Path to the chroma.sqlite3 file
 * @returns Version string: "1.x", "0.6.x", or "unknown"
 */
export function detectChromadbVersion(dbPath: string): string {
  const resolved = resolvePath(dbPath);
  const db = new Database(resolved, { readonly: true });

  try {
    // 1.x has schema_str column in collections table
    const cols = db.prepare('PRAGMA table_info(collections)').all() as Array<{ name: string }>;
    const colNames = cols.map((c) => c.name);
    if (colNames.includes('schema_str')) {
      return '1.x';
    }

    // 0.6.x has embeddings_queue but no schema_str
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
    const tableNames = tables.map((t) => t.name);
    if (tableNames.includes('embeddings_queue')) {
      return '0.6.x';
    }

    return 'unknown';
  } finally {
    db.close();
  }
}

/**
 * Return true when path looks like a MemPalace ChromaDB directory.
 *
 * Python: migrate.py contains_palace_database()
 *
 * @param palacePath - Directory path to check
 * @returns true if chroma.sqlite3 exists in the directory
 */
export function containsPalaceDatabase(palacePath: string): boolean {
  return existsSync(join(resolvePath(palacePath), 'chroma.sqlite3'));
}

/**
 * Build a summary of wings and rooms from extracted drawers.
 */
function buildSummary(drawers: SqliteDrawer[]): MigrationSummary {
  const wings: Record<string, Record<string, number>> = {};

  for (const d of drawers) {
    const wing = String(d.metadata.wing ?? '?');
    const room = String(d.metadata.room ?? '?');
    if (!wings[wing]) wings[wing] = {};
    wings[wing][room] = (wings[wing][room] ?? 0) + 1;
  }

  return { wings, totalDrawers: drawers.length };
}

/**
 * Migrate a palace to the currently installed ChromaDB version.
 *
 * Python: migrate.py migrate()
 *
 * Reads documents and metadata directly from SQLite (bypassing the ChromaDB
 * API that fails on version-mismatched palaces), then re-imports everything
 * into a fresh palace.
 *
 * @param palacePath - Path to the palace directory
 * @param dryRun - When true, show what would be migrated without making changes
 * @param confirm - When true, proceed with destructive migration; when false, abort
 * @returns Result with success status, drawer count, and backup path
 */
export async function migrate(
  palacePath: string,
  dryRun: boolean = false,
  confirm: boolean = false,
): Promise<MigrateResult> {
  const resolved = resolvePath(expandHome(palacePath));
  const dbPath = join(resolved, 'chroma.sqlite3');

  if (!existsSync(resolved) || !containsPalaceDatabase(resolved)) {
    console.log(`\n  No palace database found at ${dbPath}`);
    return { success: false, drawersImported: 0 };
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log('  MemPalace Migrate');
  console.log(`${'='.repeat(60)}\n`);
  console.log(`  Palace:    ${resolved}`);
  console.log(`  Database:  ${dbPath}`);

  const dbSizeMB = (statSync(dbPath).size / 1024 / 1024).toFixed(1);
  console.log(`  DB size:   ${dbSizeMB} MB`);

  // Detect version
  const sourceVersion = detectChromadbVersion(dbPath);
  console.log(`  Source:    ChromaDB ${sourceVersion}`);

  // Try reading with current chromadb first
  try {
    const client = new ChromaClient();
    const col = await client.getOrCreateCollection({ name: DEFAULT_COLLECTION_NAME });
    const count = await col.count();
    console.log(`\n  Palace is already readable by current chromadb.`);
    console.log(`  ${count} drawers found. No migration needed.`);
    return { success: true, drawersImported: count };
  } catch {
    console.log(`\n  Palace is NOT readable by current chromadb.`);
    console.log('  Extracting from SQLite directly...');
  }

  // Extract all drawers via raw SQL
  const drawers = extractDrawersFromSqlite(dbPath);
  console.log(`  Extracted ${drawers.length} drawers from SQLite`);

  if (drawers.length === 0) {
    console.log('  Nothing to migrate.');
    return { success: true, drawersImported: 0 };
  }

  // Show summary
  const summary = buildSummary(drawers);
  console.log('\n  Summary:');
  for (const wing of Object.keys(summary.wings).sort()) {
    const rooms = summary.wings[wing];
    const total = Object.values(rooms).reduce((a, b) => a + b, 0);
    console.log(`    WING: ${wing} (${total} drawers)`);
    const sortedRooms = Object.entries(rooms).sort((a, b) => b[1] - a[1]);
    for (const [room, count] of sortedRooms) {
      console.log(`      ROOM: ${room.padEnd(30)} ${String(count).padStart(5)}`);
    }
  }

  if (dryRun) {
    console.log('\n  DRY RUN — no changes made.');
    console.log(`  Would migrate ${drawers.length} drawers.`);
    return { success: true, drawersImported: 0 };
  }

  if (!confirm) {
    console.log('\n  Aborted — confirm=true required for destructive migration.');
    return { success: false, drawersImported: 0 };
  }

  // Backup the old palace
  const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15).replace(/(\d{8})(\d{6})/, '$1_$2');
  const backupPath = `${resolved}.pre-migrate.${timestamp}`;
  console.log(`\n  Backing up to ${backupPath}...`);
  cpSync(resolved, backupPath, { recursive: true });

  // Build fresh palace in a temp directory (avoids chromadb reading old state)
  const tempPalace = join(tmpdir(), `mempalace_migrate_${Date.now()}`);
  mkdirSync(tempPalace, { recursive: true });
  console.log(`  Creating fresh palace in ${tempPalace}...`);

  const client = new ChromaClient();
  const col = await client.getOrCreateCollection({ name: DEFAULT_COLLECTION_NAME });

  // Re-import in batches
  let imported = 0;
  for (let i = 0; i < drawers.length; i += IMPORT_BATCH) {
    const batch = drawers.slice(i, i + IMPORT_BATCH);
    await col.add({
      ids: batch.map((d) => d.id),
      documents: batch.map((d) => d.document),
      metadatas: batch.map((d) => d.metadata),
    });
    imported += batch.length;
    console.log(`  Imported ${imported}/${drawers.length} drawers...`);
  }

  // Verify before swapping
  const finalCount = await col.count();

  // Swap: remove old palace, move new one into place
  console.log('  Swapping old palace for migrated version...');
  rmSync(resolved, { recursive: true, force: true });
  renameSync(tempPalace, resolved);

  console.log('\n  Migration complete.');
  console.log(`  Drawers migrated: ${finalCount}`);
  console.log(`  Backup at: ${backupPath}`);

  if (finalCount !== drawers.length) {
    console.log(`  WARNING: Expected ${drawers.length}, got ${finalCount}`);
  }

  console.log(`\n${'='.repeat(60)}\n`);
  return { success: true, drawersImported: finalCount, backupPath };
}
