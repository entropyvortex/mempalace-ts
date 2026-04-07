/**
 * Search performance benchmarks.
 *
 * Measures query latency, recall@k, and concurrent search behavior
 * as palace size grows. Uses planted needles for recall measurement.
 *
 * NOTE: These benchmarks require a running ChromaDB server.
 * They will skip gracefully if ChromaDB is unavailable.
 *
 * Port of Python test_search_bench.py
 */

import { describe, bench, beforeAll, afterAll } from 'vitest';
import { PalaceDataGenerator } from './data-generator.js';
import { recordMetric } from './report.js';

let chromaAvailable = false;

// ── Search Latency vs Size ───────────────────────────────────────────────

describe('Search Latency vs Size', () => {
  const SIZES = [500, 1_000, 2_500, 5_000];

  beforeAll(async () => {
    try {
      const { searchMemories } = await import('../../src/searcher.js');
      // Quick connectivity check
      await searchMemories({ query: 'test', nResults: 1 });
      chromaAvailable = true;
    } catch {
      chromaAvailable = false;
      console.warn('ChromaDB not available -- search benchmarks will record skipped metrics');
    }
  });

  for (const nDrawers of SIZES) {
    bench(`search latency at ${nDrawers} drawers`, async () => {
      if (!chromaAvailable) {
        recordMetric('search', `avg_latency_ms_at_${nDrawers}`, 'skipped');
        return;
      }

      try {
        const { searchMemories } = await import('../../src/searcher.js');

        const queries = [
          'authentication middleware',
          'database optimization',
          'error handling patterns',
          'deployment configuration',
          'testing strategy',
        ];

        const latencies: number[] = [];
        for (const q of queries) {
          const start = performance.now();
          await searchMemories({ query: q, nResults: 5 });
          latencies.push(performance.now() - start);
        }

        const avgMs = latencies.reduce((a, b) => a + b, 0) / latencies.length;
        const sorted = latencies.slice().sort((a, b) => a - b);
        const p50Ms = sorted[Math.floor(sorted.length / 2)];
        const p95Ms = sorted[Math.floor(sorted.length * 0.95)];

        recordMetric('search', `avg_latency_ms_at_${nDrawers}`, Math.round(avgMs * 10) / 10);
        recordMetric('search', `p50_ms_at_${nDrawers}`, Math.round(p50Ms * 10) / 10);
        recordMetric('search', `p95_ms_at_${nDrawers}`, Math.round(p95Ms * 10) / 10);
      } catch (err) {
        recordMetric('search', `avg_latency_ms_at_${nDrawers}`, 'error');
      }
    }, { iterations: 1, warmupIterations: 0 });
  }
});

// ── Search Recall at Scale ───────────────────────────────────────────────

describe('Search Recall at Scale', () => {
  const SIZES = [500, 1_000, 2_500, 5_000];

  for (const nDrawers of SIZES) {
    bench(`recall@k at ${nDrawers} drawers`, async () => {
      if (!chromaAvailable) {
        recordMetric('search_recall', `recall_at_5_at_${nDrawers}`, 'skipped');
        recordMetric('search_recall', `recall_at_10_at_${nDrawers}`, 'skipped');
        return;
      }

      try {
        const { searchMemories } = await import('../../src/searcher.js');
        const gen = new PalaceDataGenerator(42, 'small');

        let hitsAt5 = 0;
        let hitsAt10 = 0;
        const totalNeedleQueries = Math.min(10, gen.needles.length);

        for (const needle of gen.needles.slice(0, totalNeedleQueries)) {
          const result = await searchMemories({ query: needle.query, nResults: 10 });
          const texts = result.results.map((r) => r.text);

          if (texts.slice(0, 5).some((t) => t.includes('NEEDLE_'))) hitsAt5++;
          if (texts.slice(0, 10).some((t) => t.includes('NEEDLE_'))) hitsAt10++;
        }

        const recallAt5 = hitsAt5 / Math.max(totalNeedleQueries, 1);
        const recallAt10 = hitsAt10 / Math.max(totalNeedleQueries, 1);

        recordMetric('search_recall', `recall_at_5_at_${nDrawers}`, Math.round(recallAt5 * 1000) / 1000);
        recordMetric('search_recall', `recall_at_10_at_${nDrawers}`, Math.round(recallAt10 * 1000) / 1000);
      } catch {
        recordMetric('search_recall', `recall_at_5_at_${nDrawers}`, 'error');
      }
    }, { iterations: 1, warmupIterations: 0 });
  }
});

// ── Filtered vs Unfiltered Search ────────────────────────────────────────

describe('Search Filtered vs Unfiltered', () => {
  bench('filter impact on latency and recall', async () => {
    if (!chromaAvailable) {
      recordMetric('search_filter', 'avg_unfiltered_ms', 'skipped');
      return;
    }

    try {
      const { searchMemories } = await import('../../src/searcher.js');
      const gen = new PalaceDataGenerator(42, 'small');

      const filteredLatencies: number[] = [];
      const unfilteredLatencies: number[] = [];
      let filteredHits = 0;
      let unfilteredHits = 0;
      const nQueries = Math.min(10, gen.needles.length);

      for (const needle of gen.needles.slice(0, nQueries)) {
        // Unfiltered
        let start = performance.now();
        const resultUnfiltered = await searchMemories({ query: needle.query, nResults: 5 });
        unfilteredLatencies.push(performance.now() - start);
        if (resultUnfiltered.results.slice(0, 5).some((r) => r.text.includes('NEEDLE_'))) {
          unfilteredHits++;
        }

        // Filtered by wing
        start = performance.now();
        const resultFiltered = await searchMemories({
          query: needle.query,
          wing: needle.wing,
          nResults: 5,
        });
        filteredLatencies.push(performance.now() - start);
        if (resultFiltered.results.slice(0, 5).some((r) => r.text.includes('NEEDLE_'))) {
          filteredHits++;
        }
      }

      const avgUnfiltered = unfilteredLatencies.reduce((a, b) => a + b, 0) / Math.max(unfilteredLatencies.length, 1);
      const avgFiltered = filteredLatencies.reduce((a, b) => a + b, 0) / Math.max(filteredLatencies.length, 1);
      const latencyImprovement = ((avgUnfiltered - avgFiltered) / Math.max(avgUnfiltered, 0.01)) * 100;

      recordMetric('search_filter', 'avg_unfiltered_ms', Math.round(avgUnfiltered * 10) / 10);
      recordMetric('search_filter', 'avg_filtered_ms', Math.round(avgFiltered * 10) / 10);
      recordMetric('search_filter', 'latency_improvement_pct', Math.round(latencyImprovement * 10) / 10);
      recordMetric('search_filter', 'unfiltered_recall_at_5', Math.round((unfilteredHits / Math.max(nQueries, 1)) * 1000) / 1000);
      recordMetric('search_filter', 'filtered_recall_at_5', Math.round((filteredHits / Math.max(nQueries, 1)) * 1000) / 1000);
    } catch {
      recordMetric('search_filter', 'avg_unfiltered_ms', 'error');
    }
  }, { iterations: 1, warmupIterations: 0 });
});

// ── Concurrent Search ────────────────────────────────────────────────────

describe('Concurrent Search', () => {
  bench('concurrent queries p50/p95/p99', async () => {
    if (!chromaAvailable) {
      recordMetric('concurrent_search', 'p50_ms', 'skipped');
      return;
    }

    try {
      const { searchMemories } = await import('../../src/searcher.js');

      const baseQueries = [
        'authentication',
        'database',
        'deployment',
        'error handling',
        'testing',
        'monitoring',
        'caching',
        'middleware',
        'serialization',
        'validation',
      ];
      // 30 total queries
      const queries = [...baseQueries, ...baseQueries, ...baseQueries];

      const runSearch = async (query: string): Promise<{ elapsed: number; success: boolean }> => {
        const start = performance.now();
        try {
          await searchMemories({ query, nResults: 5 });
          return { elapsed: performance.now() - start, success: true };
        } catch {
          return { elapsed: performance.now() - start, success: false };
        }
      };

      // Concurrent execution (4 at a time)
      const latencies: number[] = [];
      let errors = 0;
      const concurrency = 4;

      for (let i = 0; i < queries.length; i += concurrency) {
        const batch = queries.slice(i, i + concurrency);
        const results = await Promise.all(batch.map(runSearch));
        for (const r of results) {
          latencies.push(r.elapsed);
          if (!r.success) errors++;
        }
      }

      const sorted = latencies.slice().sort((a, b) => a - b);
      const n = sorted.length;

      recordMetric('concurrent_search', 'p50_ms', Math.round(sorted[Math.floor(n / 2)] * 10) / 10);
      recordMetric('concurrent_search', 'p95_ms', Math.round(sorted[Math.floor(n * 0.95)] * 10) / 10);
      recordMetric('concurrent_search', 'p99_ms', Math.round(sorted[Math.floor(n * 0.99)] * 10) / 10);
      recordMetric('concurrent_search', 'avg_ms', Math.round((sorted.reduce((a, b) => a + b, 0) / n) * 10) / 10);
      recordMetric('concurrent_search', 'error_count', errors);
      recordMetric('concurrent_search', 'total_queries', queries.length);
      recordMetric('concurrent_search', 'workers', concurrency);
    } catch {
      recordMetric('concurrent_search', 'p50_ms', 'error');
    }
  }, { iterations: 1, warmupIterations: 0 });
});

// ── Search N Results Scaling ─────────────────────────────────────────────

describe('Search N Results Scaling', () => {
  for (const nResults of [1, 5, 10, 25, 50]) {
    bench(`n_results=${nResults} latency`, async () => {
      if (!chromaAvailable) {
        recordMetric('search_n_results', `avg_ms_at_n_${nResults}`, 'skipped');
        return;
      }

      try {
        const { searchMemories } = await import('../../src/searcher.js');

        const latencies: number[] = [];
        for (let i = 0; i < 5; i++) {
          const start = performance.now();
          await searchMemories({ query: 'authentication middleware', nResults });
          latencies.push(performance.now() - start);
        }

        const avgMs = latencies.reduce((a, b) => a + b, 0) / latencies.length;
        recordMetric('search_n_results', `avg_ms_at_n_${nResults}`, Math.round(avgMs * 10) / 10);
      } catch {
        recordMetric('search_n_results', `avg_ms_at_n_${nResults}`, 'error');
      }
    }, { iterations: 1, warmupIterations: 0 });
  }
});
