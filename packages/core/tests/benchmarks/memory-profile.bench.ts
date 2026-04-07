/**
 * Memory profiling benchmarks -- detect leaks and measure RSS growth.
 *
 * Uses process.memoryUsage() for RSS and heap snapshots.
 * Targets the highest-risk code paths:
 *   - Repeated search() calls (PersistentClient re-instantiation)
 *   - Repeated tool_status() calls (unbounded metadata fetch)
 *   - Layer1.generate() (fetches all drawers)
 *
 * Port of Python test_memory_profile.py
 */

import { describe, bench, beforeAll } from 'vitest';
import { PalaceDataGenerator } from './data-generator.js';
import { recordMetric } from './report.js';

function getRssMb(): number {
  return process.memoryUsage().rss / (1024 * 1024);
}

function getHeapUsedMb(): number {
  return process.memoryUsage().heapUsed / (1024 * 1024);
}

let chromaAvailable = false;

// ── Search Memory Profile ────────────────────────────────────────────────

describe('Search Memory Profile', () => {
  beforeAll(async () => {
    try {
      const { getCollection } = await import('../../src/chroma.js');
      await getCollection();
      chromaAvailable = true;
    } catch {
      chromaAvailable = false;
      console.warn('ChromaDB not available -- memory profile benchmarks will record skipped metrics');
    }
  });

  bench('search RSS growth over 200 calls', async () => {
    if (!chromaAvailable) {
      recordMetric('memory_search', 'rss_growth_mb', 'skipped');
      return;
    }

    try {
      const { searchMemories } = await import('../../src/searcher.js');

      const nCalls = 200;
      const checkInterval = 50;
      const queries = ['authentication', 'database', 'deployment', 'error handling', 'testing'];
      const rssReadings: Array<[string, number]> = [];
      rssReadings.push(['start', getRssMb()]);

      for (let i = 0; i < nCalls; i++) {
        const q = queries[i % queries.length];
        await searchMemories({ query: q, nResults: 5 });
        if ((i + 1) % checkInterval === 0) {
          rssReadings.push([`after_${i + 1}`, getRssMb()]);
        }
      }

      const startRss = rssReadings[0][1];
      const endRss = rssReadings[rssReadings.length - 1][1];
      const growth = endRss - startRss;

      recordMetric('memory_search', 'rss_start_mb', Math.round(startRss * 100) / 100);
      recordMetric('memory_search', 'rss_end_mb', Math.round(endRss * 100) / 100);
      recordMetric('memory_search', 'rss_growth_mb', Math.round(growth * 100) / 100);
      recordMetric('memory_search', 'n_calls', nCalls);
      recordMetric('memory_search', 'growth_per_100_calls_mb', Math.round((growth / (nCalls / 100)) * 100) / 100);
    } catch {
      recordMetric('memory_search', 'rss_growth_mb', 'error');
    }
  }, { iterations: 1, warmupIterations: 0 });
});

// ── Tool Status Memory Profile ───────────────────────────────────────────

describe('Tool Status Memory Profile', () => {
  bench('tool_status repeated calls RSS', async () => {
    if (!chromaAvailable) {
      recordMetric('memory_tool_status', 'rss_growth_mb', 'skipped');
      return;
    }

    try {
      const { getCollection } = await import('../../src/chroma.js');
      const col = await getCollection();

      const nCalls = 50;
      const rssReadings: Array<[string, number]> = [];
      rssReadings.push(['start', getRssMb()]);

      for (let i = 0; i < nCalls; i++) {
        // Simulate tool_status: fetches all metadatas
        await col.get({ include: ['metadatas'] as any });
        if ((i + 1) % 10 === 0) {
          rssReadings.push([`after_${i + 1}`, getRssMb()]);
        }
      }

      const startRss = rssReadings[0][1];
      const endRss = rssReadings[rssReadings.length - 1][1];
      const growth = endRss - startRss;

      recordMetric('memory_tool_status', 'rss_start_mb', Math.round(startRss * 100) / 100);
      recordMetric('memory_tool_status', 'rss_end_mb', Math.round(endRss * 100) / 100);
      recordMetric('memory_tool_status', 'rss_growth_mb', Math.round(growth * 100) / 100);
      recordMetric('memory_tool_status', 'n_calls', nCalls);
      recordMetric('memory_tool_status', 'palace_size', 2_000);
    } catch {
      recordMetric('memory_tool_status', 'rss_growth_mb', 'error');
    }
  }, { iterations: 1, warmupIterations: 0 });
});

// ── Layer1 Memory Profile ────────────────────────────────────────────────

describe('Layer1 Memory Profile', () => {
  bench('Layer1 repeated generate RSS', async () => {
    if (!chromaAvailable) {
      recordMetric('memory_layer1', 'rss_growth_mb', 'skipped');
      return;
    }

    try {
      const { Layer1 } = await import('../../src/layers.js');
      const layer = new Layer1();

      const nCalls = 30;
      const rssReadings: Array<[string, number]> = [];
      rssReadings.push(['start', getRssMb()]);

      for (let i = 0; i < nCalls; i++) {
        await layer.generate();
        if ((i + 1) % 10 === 0) {
          rssReadings.push([`after_${i + 1}`, getRssMb()]);
        }
      }

      const startRss = rssReadings[0][1];
      const endRss = rssReadings[rssReadings.length - 1][1];
      const growth = endRss - startRss;

      recordMetric('memory_layer1', 'rss_start_mb', Math.round(startRss * 100) / 100);
      recordMetric('memory_layer1', 'rss_end_mb', Math.round(endRss * 100) / 100);
      recordMetric('memory_layer1', 'rss_growth_mb', Math.round(growth * 100) / 100);
      recordMetric('memory_layer1', 'n_calls', nCalls);
    } catch {
      recordMetric('memory_layer1', 'rss_growth_mb', 'error');
    }
  }, { iterations: 1, warmupIterations: 0 });
});

// ── Heap Snapshot ────────────────────────────────────────────────────────

describe('Heap Snapshot', () => {
  bench('search heap growth over 100 calls', async () => {
    if (!chromaAvailable) {
      recordMetric('heap_search', 'top_10_growth_kb', 'skipped');
      return;
    }

    try {
      const { searchMemories } = await import('../../src/searcher.js');

      // Force GC if available
      if (global.gc) global.gc();
      const heapBefore = getHeapUsedMb();

      for (let i = 0; i < 100; i++) {
        await searchMemories({ query: 'test query', nResults: 5 });
      }

      // Force GC if available
      if (global.gc) global.gc();
      const heapAfter = getHeapUsedMb();

      const growthKb = (heapAfter - heapBefore) * 1024;

      recordMetric('heap_search', 'top_10_growth_kb', Math.round(growthKb * 10) / 10);
      recordMetric('heap_search', 'n_searches', 100);
      recordMetric('heap_search', 'heap_before_mb', Math.round(heapBefore * 100) / 100);
      recordMetric('heap_search', 'heap_after_mb', Math.round(heapAfter * 100) / 100);
    } catch {
      recordMetric('heap_search', 'top_10_growth_kb', 'error');
    }
  }, { iterations: 1, warmupIterations: 0 });
});
