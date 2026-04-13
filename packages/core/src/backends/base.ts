/**
 * @module backends/base
 * Abstract collection interface for MemPalace storage backends.
 *
 * 1:1 PORT from mempalace/backends/base.py.
 * Defines the smallest collection contract the rest of MemPalace relies on.
 * Implement this interface to add a new storage backend.
 */

// ---------------------------------------------------------------------------
// BaseCollection — the pluggable storage contract
// ---------------------------------------------------------------------------

/**
 * Smallest collection contract the rest of MemPalace relies on.
 *
 * Every storage backend (ChromaDB, SQLite, in-memory, etc.) must provide
 * an object satisfying this interface for each named collection.
 */
export interface BaseCollection {
  /** Insert new documents. Fails if any ID already exists. */
  add(params: {
    documents: string[];
    ids: string[];
    metadatas?: Record<string, string | number>[];
  }): Promise<void>;

  /** Insert or update documents by ID. */
  upsert(params: {
    documents: string[];
    ids: string[];
    metadatas?: Record<string, string | number>[];
  }): Promise<void>;

  /** Semantic / similarity query. Return shape is backend-specific. */
  query(params: Record<string, unknown>): Promise<Record<string, unknown>>;

  /** Retrieve documents by ID or filter. */
  get(params?: Record<string, unknown>): Promise<Record<string, unknown>>;

  /** Delete documents by ID or filter. */
  delete(params: Record<string, unknown>): Promise<void>;

  /** Return the total number of documents in the collection. */
  count(): Promise<number>;
}
