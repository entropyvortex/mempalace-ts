/**
 * @module backends/chroma
 * ChromaDB-backed MemPalace collection adapter.
 *
 * 1:1 PORT from mempalace/backends/chroma.py.
 * Wraps a raw ChromaDB collection into the {@link BaseCollection} interface
 * and provides a factory class for obtaining collections by palace path.
 */

import { existsSync, mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { ChromaClient } from 'chromadb';
import type { BaseCollection } from './base.js';

// ---------------------------------------------------------------------------
// Inferred ChromaDB collection type (package doesn't export it directly)
// ---------------------------------------------------------------------------

/** Inferred Collection type from ChromaClient.getOrCreateCollection return. */
type RawChromaCollection = Awaited<ReturnType<ChromaClient['getOrCreateCollection']>>;

// ---------------------------------------------------------------------------
// _fixBlobSeqIds — ChromaDB migration helper
// ---------------------------------------------------------------------------

/**
 * Fix ChromaDB 0.6.x -> 1.5.x migration bug: BLOB seq_ids -> INTEGER.
 *
 * ChromaDB 0.6.x stored seq_id as big-endian 8-byte BLOBs. ChromaDB 1.5.x
 * expects INTEGER. The auto-migration doesn't convert existing rows, causing
 * the Rust compactor to crash with "mismatched types; Rust type u64 (as SQL
 * type INTEGER) is not compatible with SQL type BLOB".
 *
 * Must run BEFORE PersistentClient is created (the compactor fires on init).
 */
function _fixBlobSeqIds(palacePath: string): void {
  const dbPath = join(palacePath, 'chroma.sqlite3');
  if (!existsSync(dbPath)) return;

  try {
    const db = new Database(dbPath);
    try {
      for (const table of ['embeddings', 'max_seq_id']) {
        try {
          const rows = db
            .prepare(`SELECT rowid, seq_id FROM ${table} WHERE typeof(seq_id) = 'blob'`)
            .all() as Array<{ rowid: number; seq_id: Buffer }>;

          if (rows.length === 0) continue;

          const update = db.prepare(`UPDATE ${table} SET seq_id = ? WHERE rowid = ?`);
          const runAll = db.transaction(() => {
            for (const row of rows) {
              // Convert big-endian 8-byte BLOB to integer
              const value = row.seq_id.readBigUInt64BE();
              update.run(Number(value), row.rowid);
            }
          });
          runAll();
        } catch {
          // Table may not exist — skip
          continue;
        }
      }
    } finally {
      db.close();
    }
  } catch {
    // Could not fix BLOB seq_ids — log and continue
  }
}

// ---------------------------------------------------------------------------
// ChromaCollection — thin adapter
// ---------------------------------------------------------------------------

/**
 * Thin adapter over a ChromaDB collection.
 *
 * Delegates every call to the underlying ChromaDB collection so the rest
 * of the codebase only depends on {@link BaseCollection}.
 */
export class ChromaCollection implements BaseCollection {
  private readonly _collection: RawChromaCollection;

  constructor(collection: RawChromaCollection) {
    this._collection = collection;
  }

  async add(params: {
    documents: string[];
    ids: string[];
    metadatas?: Record<string, string | number>[];
  }): Promise<void> {
    await this._collection.add({
      documents: params.documents,
      ids: params.ids,
      metadatas: params.metadatas,
    });
  }

  async upsert(params: {
    documents: string[];
    ids: string[];
    metadatas?: Record<string, string | number>[];
  }): Promise<void> {
    await this._collection.upsert({
      documents: params.documents,
      ids: params.ids,
      metadatas: params.metadatas,
    });
  }

  async query(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const result = await this._collection.query(params as Parameters<RawChromaCollection['query']>[0]);
    return result as unknown as Record<string, unknown>;
  }

  async get(params?: Record<string, unknown>): Promise<Record<string, unknown>> {
    const result = await this._collection.get(params as Parameters<RawChromaCollection['get']>[0]);
    return result as unknown as Record<string, unknown>;
  }

  async delete(params: Record<string, unknown>): Promise<void> {
    await this._collection.delete(params as Parameters<RawChromaCollection['delete']>[0]);
  }

  async count(): Promise<number> {
    return this._collection.count();
  }
}

// ---------------------------------------------------------------------------
// ChromaBackend — factory for palace collections
// ---------------------------------------------------------------------------

/**
 * Factory for MemPalace's default ChromaDB backend.
 *
 * Manages client creation, directory setup, and the BLOB seq_id migration
 * fix before handing back a {@link ChromaCollection}.
 */
export class ChromaBackend {
  /**
   * Obtain a ChromaDB-backed collection for the given palace path.
   *
   * @param palacePath      - Filesystem path to the palace data directory
   * @param collectionName  - Name of the ChromaDB collection
   * @param create          - When true, create the directory and collection if missing
   * @returns A {@link ChromaCollection} wrapping the underlying ChromaDB collection
   */
  async getCollection(
    palacePath: string,
    collectionName: string,
    create: boolean = false,
  ): Promise<ChromaCollection> {
    if (!create && !existsSync(palacePath)) {
      throw new Error(`Palace path not found: ${palacePath}`);
    }

    if (create) {
      mkdirSync(palacePath, { recursive: true });
      try {
        chmodSync(palacePath, 0o700);
      } catch {
        // chmod may not be supported on all platforms (e.g. Windows)
      }
    }

    _fixBlobSeqIds(palacePath);

    const client = new ChromaClient({ path: palacePath });
    // Always use getOrCreateCollection — chromadb's getCollection requires
    // an embeddingFunction param, and the existing codebase uses this pattern.
    const collection = await client.getOrCreateCollection({ name: collectionName });

    return new ChromaCollection(collection);
  }
}
