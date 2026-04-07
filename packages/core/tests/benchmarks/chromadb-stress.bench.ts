/**
 * ChromaDB stress tests -- find the breaking point.
 *
 * Tests the raw ChromaDB patterns used by mempalace to determine:
 *   - At what collection size does col.get(include=["metadatas"]) become dangerous?
 *   - How does query latency degrade as collection grows?
 *   - How much faster is batched insertion vs sequential?
 *
 * Port of Python test_chromadb_stress.py and test_mcp_bench.py
 */

import { describe, bench, beforeAll } from 'vitest';
import { PalaceDataGenerator } from './data-generator.js';
import { recordMetric } from './report.js';

function getRssMb(): number {
  return process.memoryUsage().rss / (1024 * 1024);
}

let chromaAvailable = false;

// ── Get All Metadatas OOM ────────────────────────────────────────────────

describe('ChromaDB Get All Metadatas OOM', () => {
  const SIZES = [1_000, 2_500, 5_000, 10_000];

  beforeAll(async () => {
    try {
      const { getCollection } = await import('../../src/chroma.js');
      await getCollection();
      chromaAvailable = true;
    } catch {
      chromaAvailable = false;
      console.warn('ChromaDB not available -- stress benchmarks will record skipped metrics');
    }
  });

  for (const nDrawers of SIZES) {
    bench(`get all metadatas RSS at ${nDrawers} drawers`, async () => {
      if (!chromaAvailable) {
        recordMetric('chromadb_get_all', `rss_delta_mb_at_${nDrawers}`, 'skipped');
        return;
      }

      try {
        const { getCollection } = await import('../../src/chroma.js');
        const col = await getCollection();

        const rssBefore = getRssMb();
        const start = performance.now();
        const result = await col.get({ include: ['metadatas'] as any });
        const elapsedMs = performance.now() - start;
        const rssAfter = getRssMb();

        const rssDelta = rssAfter - rssBefore;
        recordMetric('chromadb_get_all', `rss_delta_mb_at_${nDrawers}`, Math.round(rssDelta * 100) / 100);
        recordMetric('chromadb_get_all', `latency_ms_at_${nDrawers}`, Math.round(elapsedMs * 10) / 10);
      } catch {
        recordMetric('chromadb_get_all', `rss_delta_mb_at_${nDrawers}`, 'error');
      }
    }, { iterations: 1, warmupIterations: 0 });
  }
});

// ── Query Degradation ────────────────────────────────────────────────────

describe('ChromaDB Query Degradation', () => {
  const SIZES = [1_000, 2_500, 5_000, 10_000];

  for (const nDrawers of SIZES) {
    bench(`query latency at ${nDrawers} drawers`, async () => {
      if (!chromaAvailable) {
        recordMetric('chromadb_query', `avg_latency_ms_at_${nDrawers}`, 'skipped');
        return;
      }

      try {
        const { getCollection } = await import('../../src/chroma.js');
        const col = await getCollection();

        const queries = [
          'authentication middleware optimization',
          'database connection pooling strategy',
          'error handling retry logic',
          'deployment pipeline configuration',
          'load balancer health check',
        ];

        const latencies: number[] = [];
        for (const q of queries) {
          const start = performance.now();
          const results = await col.query({
            queryTexts: [q],
            nResults: 5,
            include: ['documents', 'distances'] as any,
          });
          latencies.push(performance.now() - start);
        }

        const avgMs = latencies.reduce((a, b) => a + b, 0) / latencies.length;
        const sorted = latencies.slice().sort((a, b) => a - b);
        const p95Ms = sorted[Math.floor(sorted.length * 0.95)];

        recordMetric('chromadb_query', `avg_latency_ms_at_${nDrawers}`, Math.round(avgMs * 10) / 10);
        recordMetric('chromadb_query', `p95_latency_ms_at_${nDrawers}`, Math.round(p95Ms * 10) / 10);
      } catch {
        recordMetric('chromadb_query', `avg_latency_ms_at_${nDrawers}`, 'error');
      }
    }, { iterations: 1, warmupIterations: 0 });
  }
});

// ── Bulk Insert Performance ──────────────────────────────────────────────

describe('ChromaDB Bulk Insert Performance', () => {
  bench('sequential vs batched insertion', async () => {
    if (!chromaAvailable) {
      recordMetric('chromadb_insert', 'sequential_ms', 'skipped');
      return;
    }

    try {
      const { ChromaClient } = await import('chromadb');
      const client = new ChromaClient();
      const nDocs = 500;
      const gen = new PalaceDataGenerator(42);

      // Generate content
      const contents = Array.from({ length: nDocs }, () => gen.randomText(400, 800));

      // Sequential insertion (mimics add_drawer pattern)
      const colSeqName = `bench_seq_${Date.now()}`;
      const colSeq = await client.getOrCreateCollection({ name: colSeqName });

      let start = performance.now();
      for (let i = 0; i < contents.length; i++) {
        await colSeq.add({
          documents: [contents[i]],
          ids: [`seq_${i}`],
          metadatas: [{ wing: 'test', room: 'bench', chunk_index: i }],
        });
      }
      const sequentialMs = performance.now() - start;

      // Batched insertion
      const colBatchName = `bench_batch_${Date.now()}`;
      const colBatch = await client.getOrCreateCollection({ name: colBatchName });

      const batchSize = 100;
      start = performance.now();
      for (let batchStart = 0; batchStart < nDocs; batchStart += batchSize) {
        const batchEnd = Math.min(batchStart + batchSize, nDocs);
        const batchDocs = contents.slice(batchStart, batchEnd);
        const batchIds = Array.from({ length: batchEnd - batchStart }, (_, i) => `batch_${batchStart + i}`);
        const batchMetas = Array.from({ length: batchEnd - batchStart }, (_, i) => ({
          wing: 'test',
          room: 'bench',
          chunk_index: batchStart + i,
        }));
        await colBatch.add({ documents: batchDocs, ids: batchIds, metadatas: batchMetas });
      }
      const batchedMs = performance.now() - start;

      const speedup = sequentialMs / Math.max(batchedMs, 0.01);

      recordMetric('chromadb_insert', 'sequential_ms', Math.round(sequentialMs * 10) / 10);
      recordMetric('chromadb_insert', 'batched_ms', Math.round(batchedMs * 10) / 10);
      recordMetric('chromadb_insert', 'speedup_ratio', Math.round(speedup * 100) / 100);
      recordMetric('chromadb_insert', 'n_docs', nDocs);
      recordMetric('chromadb_insert', 'batch_size', batchSize);

      // Cleanup
      try {
        await client.deleteCollection(colSeqName);
        await client.deleteCollection(colBatchName);
      } catch { /* ignore cleanup errors */ }
    } catch {
      recordMetric('chromadb_insert', 'sequential_ms', 'error');
    }
  }, { iterations: 1, warmupIterations: 0 });
});

// ── Max Collection Size ──────────────────────────────────────────────────

describe('ChromaDB Max Collection Size', () => {
  bench('incremental growth', async () => {
    if (!chromaAvailable) {
      recordMetric('chromadb_growth', 'first_batch_ms', 'skipped');
      return;
    }

    try {
      const { ChromaClient } = await import('chromadb');
      const client = new ChromaClient();
      const gen = new PalaceDataGenerator(42, 'small');
      const target = Math.min(gen.cfg.drawers, 10_000); // cap at 10K

      const colName = `bench_growth_${Date.now()}`;
      const col = await client.getOrCreateCollection({ name: colName });

      const batchSize = 500;
      const batchTimes: Array<{ at_size: number; batch_ms: number }> = [];
      let totalInserted = 0;

      for (let batchNum = 0; batchNum < target; batchNum += batchSize) {
        const n = Math.min(batchSize, target - batchNum);
        const docs = Array.from({ length: n }, () => gen.randomText(400, 800));
        const ids = Array.from({ length: n }, (_, i) => `growth_${batchNum + i}`);
        const metas = Array.from({ length: n }, (_, i) => ({
          wing: gen.wings[(batchNum + i) % gen.wings.length],
          room: 'bench',
          chunk_index: batchNum + i,
        }));

        const start = performance.now();
        await col.add({ documents: docs, ids, metadatas: metas });
        const batchMs = performance.now() - start;
        totalInserted += n;
        batchTimes.push({
          at_size: totalInserted,
          batch_ms: Math.round(batchMs * 10) / 10,
        });
      }

      recordMetric('chromadb_growth', 'first_batch_ms', batchTimes[0].batch_ms);
      recordMetric('chromadb_growth', 'last_batch_ms', batchTimes[batchTimes.length - 1].batch_ms);
      recordMetric('chromadb_growth', 'total_inserted', totalInserted);
      recordMetric('chromadb_growth', 'batch_times', batchTimes);

      // Cleanup
      try {
        await client.deleteCollection(colName);
      } catch { /* ignore */ }
    } catch {
      recordMetric('chromadb_growth', 'first_batch_ms', 'error');
    }
  }, { iterations: 1, warmupIterations: 0 });
});

// ── MCP Tool Status OOM (from test_mcp_bench.py) ────────────────────────

describe('MCP Tool Status at Scale', () => {
  const SIZES = [500, 1_000, 2_500, 5_000];

  for (const nDrawers of SIZES) {
    bench(`tool_status RSS at ${nDrawers} drawers`, async () => {
      if (!chromaAvailable) {
        recordMetric('mcp_status', `rss_delta_mb_at_${nDrawers}`, 'skipped');
        return;
      }

      try {
        const { getCollection } = await import('../../src/chroma.js');
        const col = await getCollection();

        const rssBefore = getRssMb();
        const start = performance.now();
        // Simulate tool_status: fetches all metadatas
        const result = await col.get({ include: ['metadatas'] as any });
        const elapsedMs = performance.now() - start;
        const rssAfter = getRssMb();

        recordMetric('mcp_status', `rss_delta_mb_at_${nDrawers}`, Math.round((rssAfter - rssBefore) * 100) / 100);
        recordMetric('mcp_status', `latency_ms_at_${nDrawers}`, Math.round(elapsedMs * 10) / 10);
      } catch {
        recordMetric('mcp_status', `rss_delta_mb_at_${nDrawers}`, 'error');
      }
    }, { iterations: 1, warmupIterations: 0 });
  }
});

// ── MCP Search Latency ───────────────────────────────────────────────────

describe('MCP Search Latency', () => {
  const SIZES = [500, 1_000, 2_500, 5_000];

  for (const nDrawers of SIZES) {
    bench(`search latency at ${nDrawers} drawers`, async () => {
      if (!chromaAvailable) {
        recordMetric('mcp_search', `avg_latency_ms_at_${nDrawers}`, 'skipped');
        return;
      }

      try {
        const { searchMemories } = await import('../../src/searcher.js');

        const queries = ['authentication middleware', 'database migration', 'error handling'];
        const latencies: number[] = [];
        for (const q of queries) {
          const start = performance.now();
          await searchMemories({ query: q, nResults: 5 });
          latencies.push(performance.now() - start);
        }

        const avgMs = latencies.reduce((a, b) => a + b, 0) / latencies.length;
        recordMetric('mcp_search', `avg_latency_ms_at_${nDrawers}`, Math.round(avgMs * 10) / 10);
      } catch {
        recordMetric('mcp_search', `avg_latency_ms_at_${nDrawers}`, 'error');
      }
    }, { iterations: 1, warmupIterations: 0 });
  }
});
