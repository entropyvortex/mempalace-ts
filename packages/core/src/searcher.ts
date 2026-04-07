/**
 * @module searcher
 * Semantic search interface for the memory palace.
 *
 * 1:1 PORT from original searcher.py
 *
 * Maps directly to:
 *   Python functions: search(), search_memories()
 *   Python file:      searcher.py
 */

import { getCollection, searchDrawers } from './chroma.js';
import type { SearchResponse, SearchResult } from './types.js';

/**
 * Search memories and return structured results.
 *
 * Python: searcher.py search_memories(query, palace_path, wing=None, room=None, n_results=5) -> dict
 * TS: searchMemories(options) -> SearchResponse
 *
 * @param options - Search options
 * @returns Structured search response with results and filters
 */
export async function searchMemories(options: {
  query: string;
  wing?: string;
  room?: string;
  nResults?: number;
  collectionName?: string;
}): Promise<SearchResponse> {
  const { query, wing, room, nResults = 5, collectionName } = options;

  const collection = await getCollection(collectionName);
  const results = await searchDrawers(collection, query, wing, room, nResults);

  return {
    query,
    filters: { wing, room },
    results,
  };
}

/**
 * Search and print results to stdout (CLI use).
 *
 * Python: searcher.py search(query, palace_path, wing=None, room=None, n_results=5)
 * TS: search(options) -> void
 */
export async function search(options: {
  query: string;
  wing?: string;
  room?: string;
  nResults?: number;
  collectionName?: string;
}): Promise<void> {
  const response = await searchMemories(options);

  if (response.results.length === 0) {
    console.log('No results found.');
    return;
  }

  console.log(`\nSearch: "${response.query}"`);
  if (response.filters.wing) console.log(`  Wing: ${response.filters.wing}`);
  if (response.filters.room) console.log(`  Room: ${response.filters.room}`);
  console.log(`  Results: ${response.results.length}\n`);

  for (const result of response.results) {
    const similarity = (result.similarity * 100).toFixed(1);
    console.log(`  [${result.wing}/${result.room}] (${similarity}%)`);
    console.log(`  ${result.text.slice(0, 200)}`);
    console.log(`  Source: ${result.source_file}\n`);
  }
}
