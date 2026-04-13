/**
 * @module dedup
 * Detect and remove near-duplicate drawers from the palace.
 *
 * When the same files are mined multiple times, near-identical drawers
 * accumulate. This module finds drawers from the same source_file that
 * are too similar (cosine distance < threshold), keeps the longest/richest
 * version, and deletes the rest.
 *
 * No API calls — uses ChromaDB's built-in embedding similarity.
 *
 * 1:1 PORT from original dedup.py
 */

import {
  getCollection,
  searchDrawers,
  getDrawers,
  deleteDrawer,
  drawerCount,
  INCLUDE_METADATAS,
  INCLUDE_DOCUMENTS,
  INCLUDE_DISTANCES,
} from './chroma.js';
import type { ChromaCollection } from './chroma.js';

/**
 * Cosine DISTANCE threshold (not similarity). Lower = stricter.
 * 0.15 = ~85% cosine similarity — catches near-identical chunks.
 * For looser dedup of paraphrased content, try 0.3-0.4.
 *
 * Python: dedup.py DEFAULT_THRESHOLD
 */
export const DEFAULT_THRESHOLD = 0.15;

/**
 * Minimum number of drawers from a source before we bother checking for duplicates.
 *
 * Python: dedup.py MIN_DRAWERS_TO_CHECK
 */
export const MIN_DRAWERS_TO_CHECK = 5;

/**
 * Group drawers by source_file, return groups with `minCount`+ entries.
 *
 * Streams drawers in paginated batches so memory stays bounded.
 * If `wing` is specified, only considers drawers in that wing.
 * If `sourcePattern` is specified, only includes sources containing that substring (case-insensitive).
 *
 * Python: dedup.py get_source_groups()
 *
 * @param collection - ChromaDB collection
 * @param minCount - Minimum drawer count to include a source group
 * @param sourcePattern - Optional case-insensitive substring filter on source_file
 * @param wing - Optional wing filter
 * @returns Map of source_file to array of drawer IDs
 */
export async function getSourceGroups(
  collection: ChromaCollection,
  minCount: number = MIN_DRAWERS_TO_CHECK,
  sourcePattern?: string,
  wing?: string,
): Promise<Record<string, string[]>> {
  const total = await collection.count();
  const groups: Record<string, string[]> = {};

  let offset = 0;
  const batchSize = 1000;

  while (offset < total) {
    const where: Record<string, string> = {};
    if (wing) where.wing = wing;

    const batch = await collection.get({
      limit: batchSize,
      offset,
      include: [INCLUDE_METADATAS],
      ...(Object.keys(where).length > 0 ? { where } : {}),
    });

    if (!batch.ids.length) break;

    const metadatas = batch.metadatas as Array<Record<string, unknown> | null>;

    for (let i = 0; i < batch.ids.length; i++) {
      const did = batch.ids[i];
      const meta = metadatas?.[i] ?? {};
      const src = String(meta.source_file ?? 'unknown');

      if (sourcePattern && !src.toLowerCase().includes(sourcePattern.toLowerCase())) {
        continue;
      }

      if (!groups[src]) groups[src] = [];
      groups[src].push(did);
    }

    offset += batch.ids.length;
  }

  // Filter to groups meeting minimum count
  const result: Record<string, string[]> = {};
  for (const [src, ids] of Object.entries(groups)) {
    if (ids.length >= minCount) {
      result[src] = ids;
    }
  }
  return result;
}

/**
 * Dedup drawers within one source_file group.
 *
 * Greedy: sort by doc length (longest first), keep if not too similar
 * to any already-kept drawer. Returns tuple of [keptIds, deletedIds].
 *
 * Python: dedup.py dedup_source_group()
 *
 * @param collection - ChromaDB collection
 * @param drawerIds - IDs of drawers to consider
 * @param threshold - Cosine distance threshold for duplicate detection
 * @param dryRun - If true, do not actually delete drawers
 * @returns Tuple of [kept IDs, deleted IDs]
 */
export async function dedupSourceGroup(
  collection: ChromaCollection,
  drawerIds: string[],
  threshold: number = DEFAULT_THRESHOLD,
  dryRun: boolean = true,
): Promise<[string[], string[]]> {
  const data = await collection.get({
    ids: drawerIds,
    include: [INCLUDE_DOCUMENTS, INCLUDE_METADATAS],
  });

  const docs = data.documents as Array<string | null>;
  const metas = data.metadatas as Array<Record<string, unknown> | null>;

  // Build items array and sort by document length (longest first)
  const items: Array<{ id: string; doc: string | null; meta: Record<string, unknown> | null }> = [];
  for (let i = 0; i < data.ids.length; i++) {
    items.push({ id: data.ids[i], doc: docs?.[i] ?? null, meta: metas?.[i] ?? null });
  }
  items.sort((a, b) => (b.doc?.length ?? 0) - (a.doc?.length ?? 0));

  const kept: Array<{ id: string; doc: string }> = [];
  const toDelete: string[] = [];

  for (const { id: did, doc } of items) {
    if (!doc || doc.length < 20) {
      toDelete.push(did);
      continue;
    }

    if (kept.length === 0) {
      kept.push({ id: did, doc });
      continue;
    }

    try {
      const results = await collection.query({
        queryTexts: [doc],
        nResults: Math.min(kept.length, 5),
        include: [INCLUDE_DISTANCES],
      });

      const dists = results.distances?.[0] ?? [];
      const resultIds = results.ids?.[0] ?? [];
      const keptIdSet = new Set(kept.map((k) => k.id));

      let isDup = false;
      for (let j = 0; j < resultIds.length; j++) {
        if (keptIdSet.has(resultIds[j]) && (dists[j] ?? 1) < threshold) {
          isDup = true;
          break;
        }
      }

      if (isDup) {
        toDelete.push(did);
      } else {
        kept.push({ id: did, doc });
      }
    } catch {
      kept.push({ id: did, doc });
    }
  }

  if (toDelete.length > 0 && !dryRun) {
    // Delete in batches of 500
    for (let i = 0; i < toDelete.length; i += 500) {
      const batch = toDelete.slice(i, i + 500);
      for (const id of batch) {
        await deleteDrawer(collection, id);
      }
    }
  }

  return [kept.map((k) => k.id), toDelete];
}

/**
 * Show duplication statistics without making changes.
 *
 * Python: dedup.py show_stats()
 *
 * @param collectionName - Optional collection name override
 */
export async function showStats(collectionName?: string): Promise<void> {
  const col = await getCollection(collectionName);
  const groups = await getSourceGroups(col);

  const totalDrawers = Object.values(groups).reduce((sum, ids) => sum + ids.length, 0);
  console.log(`\n  Sources with ${MIN_DRAWERS_TO_CHECK}+ drawers: ${Object.keys(groups).length}`);
  console.log(`  Total drawers in those sources: ${totalDrawers.toLocaleString()}`);

  console.log('\n  Top 15 by drawer count:');
  const sortedGroups = Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
  for (const [src, ids] of sortedGroups.slice(0, 15)) {
    const count = String(ids.length).padStart(4);
    console.log(`    ${count}  ${src.slice(0, 65)}`);
  }

  let estimatedDups = 0;
  for (const ids of Object.values(groups)) {
    if (ids.length > 20) {
      estimatedDups += Math.floor(ids.length * 0.4);
    }
  }
  console.log(`\n  Estimated duplicates (groups > 20): ~${estimatedDups.toLocaleString()}`);
}

/**
 * Main entry point: deduplicate near-identical drawers across the palace.
 *
 * Python: dedup.py dedup_palace()
 *
 * @param options - Deduplication options
 * @param options.collectionName - Optional collection name override
 * @param options.threshold - Cosine distance threshold (default: 0.15)
 * @param options.dryRun - Preview without deleting (default: true)
 * @param options.sourcePattern - Optional source file pattern filter
 * @param options.minCount - Minimum drawers per source to check
 * @param options.wing - Optional wing filter
 */
export async function dedupPalace(options: {
  collectionName?: string;
  threshold?: number;
  dryRun?: boolean;
  sourcePattern?: string;
  minCount?: number;
  wing?: string;
} = {}): Promise<void> {
  const {
    collectionName,
    threshold = DEFAULT_THRESHOLD,
    dryRun = true,
    sourcePattern,
    minCount = MIN_DRAWERS_TO_CHECK,
    wing,
  } = options;

  console.log(`\n${'='.repeat(55)}`);
  console.log('  MemPalace Deduplicator');
  console.log(`${'='.repeat(55)}`);

  const col = await getCollection(collectionName);
  const total = await drawerCount(col);

  console.log(`  Drawers: ${total.toLocaleString()}`);
  console.log(`  Threshold: ${threshold}`);
  console.log(`  Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`${'─'.repeat(55)}`);

  if (wing) {
    console.log(`  Wing: ${wing}`);
  }

  const groups = await getSourceGroups(col, minCount, sourcePattern, wing);
  console.log(`\n  Sources to check: ${Object.keys(groups).length}`);

  const t0 = Date.now();
  let totalKept = 0;
  let totalDeleted = 0;

  const sortedGroups = Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
  const groupCount = sortedGroups.length;

  for (let i = 0; i < sortedGroups.length; i++) {
    const [src, drawerIds] = sortedGroups[i];
    const [kept, deleted] = await dedupSourceGroup(col, drawerIds, threshold, dryRun);
    totalKept += kept.length;
    totalDeleted += deleted.length;

    if (deleted.length > 0) {
      const idx = String(i + 1).padStart(3);
      const srcTrunc = src.slice(0, 50).padEnd(50);
      const before = String(drawerIds.length).padStart(4);
      const after = String(kept.length).padStart(4);
      console.log(
        `  [${idx}/${groupCount}] ${srcTrunc} ${before} → ${after}  (-${deleted.length})`,
      );
    }
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const totalBefore = totalKept + totalDeleted;

  console.log(`\n${'─'.repeat(55)}`);
  console.log(`  Done in ${elapsed}s`);
  console.log(
    `  Drawers: ${totalBefore.toLocaleString()} → ${totalKept.toLocaleString()}  (-${totalDeleted.toLocaleString()} removed)`,
  );

  const afterCount = await drawerCount(col);
  console.log(`  Palace after: ${afterCount.toLocaleString()} drawers`);

  if (dryRun) {
    console.log('\n  [DRY RUN] No changes written. Re-run without --dry-run to apply.');
  }

  console.log(`${'='.repeat(55)}\n`);
}
