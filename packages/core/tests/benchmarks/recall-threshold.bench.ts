/**
 * Recall threshold test -- find the per-bucket size where retrieval breaks.
 *
 * The palace_boost tests showed room-filtered recall of 1.0, but only because
 * each room had ~333 drawers. This test concentrates ALL drawers into a single
 * wing+room to find the actual embedding model limit.
 *
 * Port of Python test_recall_threshold.py
 */

import { describe, bench, beforeAll } from 'vitest';
import { PalaceDataGenerator } from './data-generator.js';
import { recordMetric } from './report.js';

const NEEDLE_TOPICS = [
  'Fibonacci sequence optimization uses memoization with O(n) space complexity',
  'PostgreSQL vacuum autovacuum threshold set to 50 percent for table users',
  'Redis cluster failover timeout configured at 30 seconds with sentinel monitoring',
  'Kubernetes horizontal pod autoscaler targets 70 percent CPU utilization',
  'GraphQL subscription uses WebSocket transport with heartbeat interval 25 seconds',
  'JWT token rotation policy requires refresh every 15 minutes with sliding window',
  'Elasticsearch index sharding strategy uses 5 primary shards with 1 replica each',
  'Docker multi-stage build reduces image size from 1.2GB to 180MB for production',
  'Apache Kafka consumer group rebalance timeout set to 45 seconds',
  'MongoDB change streams resume token persisted every 100 operations',
];

const NEEDLE_QUERIES = [
  'Fibonacci sequence optimization memoization',
  'PostgreSQL vacuum autovacuum threshold',
  'Redis cluster failover timeout sentinel',
  'Kubernetes horizontal pod autoscaler CPU',
  'GraphQL subscription WebSocket heartbeat',
  'JWT token rotation policy refresh',
  'Elasticsearch index sharding primary replica',
  'Docker multi-stage build image size production',
  'Apache Kafka consumer group rebalance',
  'MongoDB change streams resume token',
];

let chromaAvailable = false;

// ── Single Room Recall Threshold ─────────────────────────────────────────

describe('Recall Threshold: Single Room', () => {
  const SIZES = [250, 500, 1_000, 2_000, 3_000, 5_000];

  beforeAll(async () => {
    try {
      const { getCollection } = await import('../../src/chroma.js');
      await getCollection();
      chromaAvailable = true;
    } catch {
      chromaAvailable = false;
      console.warn('ChromaDB not available -- recall threshold benchmarks will record skipped metrics');
    }
  });

  for (const nDrawers of SIZES) {
    bench(`single room recall at ${nDrawers} drawers`, async () => {
      if (!chromaAvailable) {
        recordMetric('single_room_recall', `recall_at_5_at_${nDrawers}`, 'skipped');
        return;
      }

      try {
        const { searchMemories } = await import('../../src/searcher.js');

        let hitsAt5 = 0;
        let hitsAt10 = 0;
        const nQueries = NEEDLE_QUERIES.length;

        for (let i = 0; i < nQueries; i++) {
          const result = await searchMemories({
            query: NEEDLE_QUERIES[i],
            wing: 'concentrated',
            room: 'single_room',
            nResults: 10,
          });

          const texts = result.results.map((r) => r.text);
          const needleId = `NEEDLE_${String(i).padStart(4, '0')}`;

          if (texts.slice(0, 5).some((t) => t.includes(needleId))) hitsAt5++;
          if (texts.slice(0, 10).some((t) => t.includes(needleId))) hitsAt10++;
        }

        const recall5 = hitsAt5 / nQueries;
        const recall10 = hitsAt10 / nQueries;

        recordMetric('single_room_recall', `recall_at_5_at_${nDrawers}`, Math.round(recall5 * 1000) / 1000);
        recordMetric('single_room_recall', `recall_at_10_at_${nDrawers}`, Math.round(recall10 * 1000) / 1000);
      } catch {
        recordMetric('single_room_recall', `recall_at_5_at_${nDrawers}`, 'error');
      }
    }, { iterations: 1, warmupIterations: 0 });
  }
});

// ── Single Room No Filter Recall ─────────────────────────────────────────

describe('Recall Threshold: Single Room Unfiltered', () => {
  const SIZES = [250, 500, 1_000, 2_000, 3_000, 5_000];

  for (const nDrawers of SIZES) {
    bench(`single room unfiltered recall at ${nDrawers} drawers`, async () => {
      if (!chromaAvailable) {
        recordMetric('single_room_unfiltered', `recall_at_5_at_${nDrawers}`, 'skipped');
        return;
      }

      try {
        const { searchMemories } = await import('../../src/searcher.js');

        let hitsAt5 = 0;
        let hitsAt10 = 0;
        const nQueries = NEEDLE_QUERIES.length;

        for (let i = 0; i < nQueries; i++) {
          const result = await searchMemories({
            query: NEEDLE_QUERIES[i],
            nResults: 10,
          });

          const texts = result.results.map((r) => r.text);
          const needleId = `NEEDLE_${String(i).padStart(4, '0')}`;

          if (texts.slice(0, 5).some((t) => t.includes(needleId))) hitsAt5++;
          if (texts.slice(0, 10).some((t) => t.includes(needleId))) hitsAt10++;
        }

        const recall5 = hitsAt5 / nQueries;
        const recall10 = hitsAt10 / nQueries;

        recordMetric('single_room_unfiltered', `recall_at_5_at_${nDrawers}`, Math.round(recall5 * 1000) / 1000);
        recordMetric('single_room_unfiltered', `recall_at_10_at_${nDrawers}`, Math.round(recall10 * 1000) / 1000);
      } catch {
        recordMetric('single_room_unfiltered', `recall_at_5_at_${nDrawers}`, 'error');
      }
    }, { iterations: 1, warmupIterations: 0 });
  }
});
