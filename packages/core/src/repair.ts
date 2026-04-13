/**
 * @module repair
 * Scan, prune corrupt entries, and rebuild HNSW index.
 *
 * 1:1 PORT from original repair.py.
 * When ChromaDB's HNSW index accumulates duplicate entries (from repeated
 * add() calls with the same ID), link_lists.bin can grow unbounded —
 * terabytes on large palaces — eventually causing segfaults.
 *
 * Three operations:
 *   scan    — find every corrupt/unfetchable ID in the palace
 *   prune   — delete only the corrupt IDs (surgical)
 *   rebuild — extract all drawers, delete the collection, recreate with
 *             correct HNSW settings, and upsert everything back
 */

import { writeFileSync, readFileSync, existsSync, copyFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ChromaClient } from 'chromadb';
import {
  getCollection,
  getDrawers,
  deleteDrawer,
  drawerCount,
  INCLUDE_DOCUMENTS,
  INCLUDE_METADATAS,
  type ChromaCollection,
} from './chroma.js';
import { DEFAULT_COLLECTION_NAME } from './types.js';
import { resolvePath, expandHome } from './utils/paths.js';

/** Batch size for paginating ID reads. */
const PAGE_SIZE = 1000;

/** Batch size for probing drawers during scan. */
const PROBE_BATCH = 100;

/** Batch size for extraction and re-import during rebuild. */
const REBUILD_BATCH = 5000;

/**
 * Pull all IDs from a collection using pagination.
 *
 * Python: repair.py _paginate_ids()
 *
 * @param collection - ChromaDB collection to read from
 * @param where - Optional metadata filter
 * @returns Array of all IDs in the collection
 */
async function paginateIds(
  collection: ChromaCollection,
  where?: Record<string, string>,
): Promise<string[]> {
  const ids: string[] = [];
  let offset = 0;

  while (true) {
    try {
      const r = await collection.get({
        ...(where ? { where } : {}),
        include: [],
        limit: PAGE_SIZE,
        offset,
      });
      const n = r.ids.length;
      if (n === 0) break;
      ids.push(...r.ids);
      offset += n;
      if (n < PAGE_SIZE) break;
    } catch {
      // Fallback: try without offset (some ChromaDB versions lack offset support)
      try {
        const r = await collection.get({
          ...(where ? { where } : {}),
          include: [],
          limit: PAGE_SIZE,
        });
        const seen = new Set(ids);
        const newIds = r.ids.filter((id: string) => !seen.has(id));
        if (newIds.length === 0) break;
        ids.push(...newIds);
        offset += newIds.length;
      } catch {
        break;
      }
    }
  }

  return ids;
}

/** Result returned by {@link scanPalace}. */
export interface ScanResult {
  good: Set<string>;
  bad: Set<string>;
}

/**
 * Scan the palace for corrupt/unfetchable IDs.
 *
 * Python: repair.py scan_palace()
 *
 * Probes in batches of 100, falls back to per-ID on failure.
 * Writes corrupt_ids.txt to the palace directory for the prune step.
 *
 * @param palacePath - Path to the palace directory
 * @param onlyWing - Optional wing to restrict the scan to
 * @returns Sets of good and bad IDs
 */
export async function scanPalace(
  palacePath: string,
  onlyWing?: string,
): Promise<ScanResult> {
  const resolved = resolvePath(palacePath);
  console.log(`\n  Palace: ${resolved}`);
  console.log('  Loading...');

  const collection = await getCollection();
  const where = onlyWing ? { wing: onlyWing } : undefined;
  const total = await drawerCount(collection);
  console.log(`  Collection: ${DEFAULT_COLLECTION_NAME}, total: ${total.toLocaleString()}`);
  if (onlyWing) {
    console.log(`  Scanning wing: ${onlyWing}`);
  }

  console.log('\n  Step 1: listing all IDs...');
  const t0 = Date.now();
  const allIds = await paginateIds(collection, where);
  console.log(`  Found ${allIds.length.toLocaleString()} IDs in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

  if (allIds.length === 0) {
    console.log('  Nothing to scan.');
    return { good: new Set(), bad: new Set() };
  }

  console.log('  Step 2: probing each ID (batches of 100)...');
  const t1 = Date.now();
  const good = new Set<string>();
  const bad = new Set<string>();

  for (let i = 0; i < allIds.length; i += PROBE_BATCH) {
    const chunk = allIds.slice(i, i + PROBE_BATCH);
    try {
      const r = await collection.get({ ids: chunk, include: [INCLUDE_DOCUMENTS] });
      for (const got of r.ids) {
        good.add(got);
      }
      for (const mid of chunk) {
        if (!good.has(mid)) {
          bad.add(mid);
        }
      }
    } catch {
      // Fallback to per-ID probing
      for (const sid of chunk) {
        try {
          const r = await collection.get({ ids: [sid], include: [INCLUDE_DOCUMENTS] });
          if (r.ids.length > 0) {
            good.add(sid);
          } else {
            bad.add(sid);
          }
        } catch {
          bad.add(sid);
        }
      }
    }

    const batchIndex = Math.floor(i / PROBE_BATCH);
    if (batchIndex % 50 === 0) {
      const elapsed = (Date.now() - t1) / 1000;
      const processed = i + PROBE_BATCH;
      const rate = processed / Math.max(elapsed, 0.01);
      const eta = (allIds.length - processed) / Math.max(rate, 0.01);
      console.log(
        `    ${String(processed).padStart(6)}/${String(allIds.length).padStart(6)}  ` +
        `good=${String(good.size).padStart(6)}  bad=${String(bad.size).padStart(6)}  ` +
        `eta=${Math.round(eta)}s`,
      );
    }
  }

  const elapsed = ((Date.now() - t1) / 1000).toFixed(1);
  console.log(`\n  Scan complete in ${elapsed}s`);
  console.log(`  GOOD: ${good.size.toLocaleString()}`);
  console.log(`  BAD:  ${bad.size.toLocaleString()}  (${(bad.size / Math.max(allIds.length, 1) * 100).toFixed(1)}%)`);

  const badFile = join(resolved, 'corrupt_ids.txt');
  const sorted = [...bad].sort();
  writeFileSync(badFile, sorted.join('\n') + (sorted.length > 0 ? '\n' : ''));
  console.log(`\n  Bad IDs written to: ${badFile}`);

  return { good, bad };
}

/**
 * Delete corrupt IDs listed in corrupt_ids.txt.
 *
 * Python: repair.py prune_corrupt()
 *
 * @param palacePath - Path to the palace directory
 * @param confirm - When false, performs a dry run only
 */
export async function pruneCorrupt(
  palacePath: string,
  confirm: boolean = false,
): Promise<void> {
  const resolved = resolvePath(palacePath);
  const badFile = join(resolved, 'corrupt_ids.txt');

  if (!existsSync(badFile)) {
    console.log('  No corrupt_ids.txt found — run scan first.');
    return;
  }

  const content = readFileSync(badFile, 'utf-8');
  const badIds = content.split('\n').map((l) => l.trim()).filter(Boolean);
  console.log(`  ${badIds.length.toLocaleString()} corrupt IDs queued for deletion`);

  if (!confirm) {
    console.log('\n  DRY RUN — no deletions performed.');
    console.log('  Re-run with confirm=true to actually delete.');
    return;
  }

  const collection = await getCollection();
  const before = await drawerCount(collection);
  console.log(`  Collection size before: ${before.toLocaleString()}`);

  let deleted = 0;
  let failed = 0;

  for (let i = 0; i < badIds.length; i += PROBE_BATCH) {
    const chunk = badIds.slice(i, i + PROBE_BATCH);
    try {
      await collection.delete({ ids: chunk });
      deleted += chunk.length;
    } catch {
      for (const sid of chunk) {
        try {
          await deleteDrawer(collection, sid);
          deleted += 1;
        } catch {
          failed += 1;
        }
      }
    }

    const batchIndex = Math.floor(i / PROBE_BATCH);
    if (batchIndex % 20 === 0) {
      console.log(`    deleted ${deleted}/${badIds.length}  (failed: ${failed})`);
    }
  }

  const after = await drawerCount(collection);
  console.log(`\n  Deleted: ${deleted.toLocaleString()}`);
  console.log(`  Failed:  ${failed.toLocaleString()}`);
  console.log(`  Collection size: ${before.toLocaleString()} → ${after.toLocaleString()}`);
}

/** Drawer data extracted for rebuild. */
interface ExtractedDrawer {
  id: string;
  document: string;
  metadata: Record<string, string | number | boolean>;
}

/**
 * Rebuild the HNSW index from scratch.
 *
 * Python: repair.py rebuild_index()
 *
 * 1. Extract all drawers via ChromaDB get()
 * 2. Back up ONLY chroma.sqlite3 (not the bloated HNSW files)
 * 3. Delete and recreate the collection with hnsw:space=cosine
 * 4. Upsert all drawers back
 *
 * @param palacePath - Path to the palace directory
 */
export async function rebuildIndex(palacePath: string): Promise<void> {
  const resolved = resolvePath(palacePath);

  if (!existsSync(resolved)) {
    console.log(`\n  No palace found at ${resolved}`);
    return;
  }

  console.log(`\n${'='.repeat(55)}`);
  console.log('  MemPalace Repair — Index Rebuild');
  console.log(`${'='.repeat(55)}\n`);
  console.log(`  Palace: ${resolved}`);

  const client = new ChromaClient();
  let collection: ChromaCollection;
  let total: number;

  try {
    collection = await client.getOrCreateCollection({ name: DEFAULT_COLLECTION_NAME });
    total = await collection.count();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`  Error reading palace: ${msg}`);
    console.log('  Palace may need to be re-mined from source files.');
    return;
  }

  console.log(`  Drawers found: ${total}`);

  if (total === 0) {
    console.log('  Nothing to repair.');
    return;
  }

  // Extract all drawers in batches
  console.log('\n  Extracting drawers...');
  const allDrawers: ExtractedDrawer[] = [];
  let offset = 0;

  while (offset < total) {
    const batch = await collection.get({
      limit: REBUILD_BATCH,
      offset,
      include: [INCLUDE_DOCUMENTS, INCLUDE_METADATAS],
    });
    if (batch.ids.length === 0) break;

    for (let i = 0; i < batch.ids.length; i++) {
      allDrawers.push({
        id: batch.ids[i],
        document: (batch.documents as Array<string | null>)?.[i] ?? '',
        metadata: ((batch.metadatas as Array<Record<string, unknown> | null>)?.[i] ?? {}) as Record<string, string | number | boolean>,
      });
    }
    offset += batch.ids.length;
  }
  console.log(`  Extracted ${allDrawers.length} drawers`);

  // Back up ONLY the SQLite database
  const sqlitePath = join(resolved, 'chroma.sqlite3');
  if (existsSync(sqlitePath)) {
    const backupPath = sqlitePath + '.backup';
    const sizeMB = Math.round(statSync(sqlitePath).size / 1e6);
    console.log(`  Backing up chroma.sqlite3 (${sizeMB} MB)...`);
    copyFileSync(sqlitePath, backupPath);
    console.log(`  Backup: ${backupPath}`);
  }

  // Rebuild with correct HNSW settings
  console.log('  Rebuilding collection with hnsw:space=cosine...');
  await client.deleteCollection({ name: DEFAULT_COLLECTION_NAME });
  const newCol = await client.createCollection({
    name: DEFAULT_COLLECTION_NAME,
    metadata: { 'hnsw:space': 'cosine' },
  });

  let filed = 0;
  for (let i = 0; i < allDrawers.length; i += REBUILD_BATCH) {
    const batchIds = allDrawers.slice(i, i + REBUILD_BATCH).map((d) => d.id);
    const batchDocs = allDrawers.slice(i, i + REBUILD_BATCH).map((d) => d.document);
    const batchMetas = allDrawers.slice(i, i + REBUILD_BATCH).map((d) => d.metadata);
    await newCol.upsert({ ids: batchIds, documents: batchDocs, metadatas: batchMetas });
    filed += batchIds.length;
    console.log(`  Re-filed ${filed}/${allDrawers.length} drawers...`);
  }

  console.log(`\n  Repair complete. ${filed} drawers rebuilt.`);
  console.log('  HNSW index is now clean with cosine distance metric.');
  console.log(`\n${'='.repeat(55)}\n`);
}
