/**
 * @module backends
 * Pluggable storage backend abstraction for MemPalace.
 *
 * 1:1 PORT from mempalace/backends/__init__.py.
 * Re-exports the base interface and the default ChromaDB implementation.
 */

export type { BaseCollection } from './base.js';
export { ChromaCollection, ChromaBackend } from './chroma.js';
