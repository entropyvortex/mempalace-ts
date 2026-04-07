/**
 * @module chroma
 * ChromaDB wrapper for the drawer storage layer.
 *
 * 1:1 PORT from original miner.py get_collection() and ChromaDB operations.
 * Provides vector storage and semantic search over memory drawers.
 */

import { ChromaClient, type IncludeEnum } from 'chromadb';
import { DEFAULT_COLLECTION_NAME } from './types.js';
import type { DrawerMetadata, SearchResult } from './types.js';

/** ChromaDB include fields — cast once to avoid scattered `as any` throughout the codebase */
export const INCLUDE_METADATAS = 'metadatas' as IncludeEnum;
export const INCLUDE_DOCUMENTS = 'documents' as IncludeEnum;
export const INCLUDE_DISTANCES = 'distances' as IncludeEnum;

/**
 * Inferred Collection type from ChromaClient.getOrCreateCollection return.
 * The chromadb package declares Collection locally but doesn't export the type.
 */
type ChromaCollection = Awaited<ReturnType<ChromaClient['getOrCreateCollection']>>;

/** Cached client instance */
let clientInstance: ChromaClient | null = null;

/**
 * Get or create the ChromaDB client (singleton).
 *
 * Python: miner.py get_collection() — ChromaDB client setup
 */
function getClient(): ChromaClient {
  if (!clientInstance) {
    clientInstance = new ChromaClient();
  }
  return clientInstance;
}

/**
 * Get or create the mempalace drawers collection.
 *
 * Python: miner.py get_collection()
 *
 * @param collectionName - Name of the ChromaDB collection
 * @returns The ChromaDB collection for drawer storage
 */
export async function getCollection(
  collectionName: string = DEFAULT_COLLECTION_NAME,
): Promise<ChromaCollection> {
  const client = getClient();
  return client.getOrCreateCollection({ name: collectionName });
}

/**
 * Check if a source file has already been mined into the collection.
 *
 * Python: miner.py file_already_mined()
 *
 * @param collection - ChromaDB collection
 * @param sourceFile - Path of the source file
 * @returns true if any drawers from this file exist
 */
export async function fileAlreadyMined(
  collection: ChromaCollection,
  sourceFile: string,
): Promise<boolean> {
  const results = await collection.get({
    where: { source_file: sourceFile },
    limit: 1,
  });
  return results.ids.length > 0;
}

/**
 * Add a drawer (chunk) to the ChromaDB collection.
 *
 * Python: miner.py add_drawer()
 *
 * @param collection - ChromaDB collection
 * @param id - Unique drawer ID
 * @param content - Text content of the drawer
 * @param metadata - Drawer metadata (wing, room, source_file, etc.)
 * @returns true if added successfully
 */
export async function addDrawer(
  collection: ChromaCollection,
  id: string,
  content: string,
  metadata: DrawerMetadata,
): Promise<boolean> {
  // Convert DrawerMetadata to a flat Record for ChromaDB
  const flatMeta: Record<string, string | number> = {
    wing: metadata.wing,
    room: metadata.room,
    source_file: metadata.source_file,
    chunk_index: metadata.chunk_index,
    added_by: metadata.added_by,
    filed_at: metadata.filed_at,
    ingest_mode: metadata.ingest_mode,
  };
  if (metadata.extract_mode) flatMeta.extract_mode = metadata.extract_mode;
  if (metadata.importance !== undefined) flatMeta.importance = metadata.importance;
  if (metadata.emotional_weight !== undefined) flatMeta.emotional_weight = metadata.emotional_weight;

  await collection.add({
    ids: [id],
    documents: [content],
    metadatas: [flatMeta],
  });
  return true;
}

/**
 * Delete a drawer by ID.
 *
 * Python: mcp_server.py mempalace_delete_drawer tool
 *
 * @param collection - ChromaDB collection
 * @param id - Drawer ID to delete
 */
export async function deleteDrawer(collection: ChromaCollection, id: string): Promise<void> {
  await collection.delete({ ids: [id] });
}

/**
 * Semantic search over drawers.
 *
 * Python: searcher.py search_memories()
 *
 * @param collection - ChromaDB collection
 * @param query - Search query text
 * @param wing - Optional wing filter
 * @param room - Optional room filter
 * @param nResults - Number of results to return
 * @returns Array of search results with similarity scores
 */
export async function searchDrawers(
  collection: ChromaCollection,
  query: string,
  wing?: string,
  room?: string,
  nResults: number = 5,
): Promise<SearchResult[]> {
  const where: Record<string, string> = {};
  if (wing) where.wing = wing;
  if (room) where.room = room;

  const results = await collection.query({
    queryTexts: [query],
    nResults,
    ...(Object.keys(where).length > 0 ? { where } : {}),
  });

  if (!results.documents?.[0]) return [];

  const docs = results.documents[0];
  return docs.map((doc: string | null, i: number) => {
    const metaArr = results.metadatas?.[0];
    const meta = (metaArr?.[i] ?? {}) as Record<string, string>;
    const distArr = results.distances?.[0];
    const distance = distArr?.[i] ?? 1;
    return {
      text: doc ?? '',
      wing: meta.wing ?? '',
      room: meta.room ?? '',
      source_file: meta.source_file ?? '',
      similarity: 1 - Number(distance),
    };
  });
}

/**
 * Get all drawers with optional filtering.
 *
 * Python: layers.py — used by Layer1 and Layer2 for retrieval
 *
 * @param collection - ChromaDB collection
 * @param wing - Optional wing filter
 * @param room - Optional room filter
 * @param limit - Maximum number of drawers to return
 * @param offset - Offset for pagination
 * @returns Array of drawer objects with content and metadata
 */
export async function getDrawers(
  collection: ChromaCollection,
  wing?: string,
  room?: string,
  limit: number = 1000,
  offset: number = 0,
): Promise<Array<{ id: string; content: string; metadata: Record<string, string | number> }>> {
  const where: Record<string, string> = {};
  if (wing) where.wing = wing;
  if (room) where.room = room;

  const results = await collection.get({
    ...(Object.keys(where).length > 0 ? { where } : {}),
    limit,
    offset,
    include: [INCLUDE_DOCUMENTS, INCLUDE_METADATAS],
  });

  return results.ids.map((id: string, i: number) => ({
    id,
    content: (results.documents as Array<string | null>)?.[i] ?? '',
    metadata: ((results.metadatas as Array<Record<string, unknown> | null>)?.[i] ?? {}) as Record<string, string | number>,
  }));
}

/**
 * Get the total count of drawers.
 *
 * Python: mcp_server.py mempalace_status tool
 */
export async function drawerCount(collection: ChromaCollection): Promise<number> {
  return collection.count();
}

/**
 * List all unique wings in the collection.
 *
 * Python: mcp_server.py mempalace_list_wings tool
 */
export async function listWings(collection: ChromaCollection): Promise<Record<string, number>> {
  const all = await collection.get({ include: [INCLUDE_METADATAS] });
  const wings: Record<string, number> = {};
  for (const meta of (all.metadatas ?? []) as Array<Record<string, unknown> | null>) {
    const wing = String(meta?.wing ?? 'unknown');
    wings[wing] = (wings[wing] ?? 0) + 1;
  }
  return wings;
}

/**
 * List all rooms within a wing.
 *
 * Python: mcp_server.py mempalace_list_rooms tool
 */
export async function listRooms(
  collection: ChromaCollection,
  wing: string,
): Promise<Record<string, number>> {
  const results = await collection.get({
    where: { wing },
    include: [INCLUDE_METADATAS],
  });
  const rooms: Record<string, number> = {};
  for (const meta of (results.metadatas ?? []) as Array<Record<string, unknown> | null>) {
    const room = String(meta?.room ?? 'general');
    rooms[room] = (rooms[room] ?? 0) + 1;
  }
  return rooms;
}

/**
 * Get full taxonomy: wing → room → count.
 *
 * Python: mcp_server.py mempalace_get_taxonomy tool
 */
export async function getTaxonomy(
  collection: ChromaCollection,
): Promise<Record<string, Record<string, number>>> {
  const all = await collection.get({ include: [INCLUDE_METADATAS] });
  const taxonomy: Record<string, Record<string, number>> = {};
  for (const meta of (all.metadatas ?? []) as Array<Record<string, unknown> | null>) {
    const wing = String(meta?.wing ?? 'unknown');
    const room = String(meta?.room ?? 'general');
    if (!taxonomy[wing]) taxonomy[wing] = {};
    taxonomy[wing][room] = (taxonomy[wing][room] ?? 0) + 1;
  }
  return taxonomy;
}

/**
 * Check if content is likely a duplicate of existing drawers.
 *
 * Python: mcp_server.py mempalace_check_duplicate tool
 *
 * @param collection - ChromaDB collection
 * @param content - Content to check
 * @param threshold - Similarity threshold (default: 0.9)
 * @returns The closest match if above threshold, or null
 */
export async function checkDuplicate(
  collection: ChromaCollection,
  content: string,
  threshold: number = 0.9,
): Promise<SearchResult | null> {
  const results = await searchDrawers(collection, content, undefined, undefined, 1);
  if (results.length > 0 && results[0].similarity >= threshold) {
    return results[0];
  }
  return null;
}

/** Re-export the inferred ChromaDB collection type. */
export type { ChromaCollection };
