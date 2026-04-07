/**
 * Memory stack (layers.ts) benchmarks.
 *
 * Tests MemoryStack.wakeUp(), Layer1.generate(), and Layer2/L3
 * at scale. Layer1 has the same unbounded col.get() as tool_status.
 *
 * Port of Python test_layers_bench.py
 */

import { describe, bench, beforeAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PalaceDataGenerator } from './data-generator.js';
import { recordMetric } from './report.js';

function getRssMb(): number {
  return process.memoryUsage().rss / (1024 * 1024);
}

let chromaAvailable = false;

// ── Wake-up Cost ─────────────────────────────────────────────────────────

describe('Wake-up Cost', () => {
  const SIZES = [500, 1_000, 2_500, 5_000];

  beforeAll(async () => {
    try {
      const { getCollection } = await import('../../src/chroma.js');
      await getCollection();
      chromaAvailable = true;
    } catch {
      chromaAvailable = false;
      console.warn('ChromaDB not available -- layers benchmarks will record skipped metrics');
    }
  });

  for (const nDrawers of SIZES) {
    bench(`wakeUp latency at ${nDrawers} drawers`, async () => {
      if (!chromaAvailable) {
        recordMetric('layers_wakeup', `avg_ms_at_${nDrawers}`, 'skipped');
        return;
      }

      const tmpDir = mkdtempSync(join(tmpdir(), 'layers-wakeup-'));
      try {
        const identityPath = join(tmpDir, 'identity.txt');
        writeFileSync(identityPath, 'I am a test AI. Traits: precise, fast.\n');

        const { MemoryStack } = await import('../../src/layers.js');
        const stack = new MemoryStack(undefined, identityPath);

        const latencies: number[] = [];
        for (let i = 0; i < 5; i++) {
          const start = performance.now();
          const text = await stack.wakeUp();
          latencies.push(performance.now() - start);
        }

        const avgMs = latencies.reduce((a, b) => a + b, 0) / latencies.length;
        recordMetric('layers_wakeup', `avg_ms_at_${nDrawers}`, Math.round(avgMs * 10) / 10);
      } catch {
        recordMetric('layers_wakeup', `avg_ms_at_${nDrawers}`, 'error');
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    }, { iterations: 1, warmupIterations: 0 });
  }
});

// ── Layer1 Unbounded Fetch ───────────────────────────────────────────────

describe('Layer1 Unbounded Fetch', () => {
  const SIZES = [500, 1_000, 2_500, 5_000];

  for (const nDrawers of SIZES) {
    bench(`Layer1 RSS growth at ${nDrawers} drawers`, async () => {
      if (!chromaAvailable) {
        recordMetric('layer1', `latency_ms_at_${nDrawers}`, 'skipped');
        return;
      }

      try {
        const { Layer1 } = await import('../../src/layers.js');
        const layer = new Layer1();

        const rssBefore = getRssMb();
        const start = performance.now();
        const text = await layer.generate();
        const elapsedMs = performance.now() - start;
        const rssAfter = getRssMb();

        const rssDelta = rssAfter - rssBefore;

        recordMetric('layer1', `latency_ms_at_${nDrawers}`, Math.round(elapsedMs * 10) / 10);
        recordMetric('layer1', `rss_delta_mb_at_${nDrawers}`, Math.round(rssDelta * 100) / 100);
      } catch {
        recordMetric('layer1', `latency_ms_at_${nDrawers}`, 'error');
      }
    }, { iterations: 1, warmupIterations: 0 });
  }

  bench('Layer1 wing-filtered vs unfiltered', async () => {
    if (!chromaAvailable) {
      recordMetric('layer1_filter', 'unfiltered_ms', 'skipped');
      return;
    }

    try {
      const gen = new PalaceDataGenerator(42, 'small');
      const wing = gen.wings[0];

      const { Layer1 } = await import('../../src/layers.js');

      // Unfiltered
      const layerAll = new Layer1();
      let start = performance.now();
      await layerAll.generate();
      const unfilteredMs = performance.now() - start;

      // Wing-filtered
      const layerWing = new Layer1(undefined, wing);
      start = performance.now();
      await layerWing.generate();
      const filteredMs = performance.now() - start;

      recordMetric('layer1_filter', 'unfiltered_ms', Math.round(unfilteredMs * 10) / 10);
      recordMetric('layer1_filter', 'filtered_ms', Math.round(filteredMs * 10) / 10);
      if (unfilteredMs > 0) {
        recordMetric(
          'layer1_filter',
          'speedup_pct',
          Math.round((1 - filteredMs / unfilteredMs) * 1000) / 10,
        );
      }
    } catch {
      recordMetric('layer1_filter', 'unfiltered_ms', 'error');
    }
  }, { iterations: 1, warmupIterations: 0 });
});

// ── Wake-up Token Budget ─────────────────────────────────────────────────

describe('Wake-up Token Budget', () => {
  const SIZES = [500, 1_000, 2_500, 5_000];

  for (const nDrawers of SIZES) {
    bench(`token budget at ${nDrawers} drawers`, async () => {
      if (!chromaAvailable) {
        recordMetric('wakeup_budget', `tokens_at_${nDrawers}`, 'skipped');
        return;
      }

      const tmpDir = mkdtempSync(join(tmpdir(), 'layers-budget-'));
      try {
        const identityPath = join(tmpDir, 'identity.txt');
        writeFileSync(identityPath, 'I am a benchmark AI.\n');

        const { MemoryStack } = await import('../../src/layers.js');
        const stack = new MemoryStack(undefined, identityPath);
        const text = await stack.wakeUp();
        const tokenEstimate = Math.floor(text.length / 4);

        recordMetric('wakeup_budget', `tokens_at_${nDrawers}`, tokenEstimate);
        recordMetric('wakeup_budget', `chars_at_${nDrawers}`, text.length);
      } catch {
        recordMetric('wakeup_budget', `tokens_at_${nDrawers}`, 'error');
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    }, { iterations: 1, warmupIterations: 0 });
  }
});

// ── Layer2 Retrieval ─────────────────────────────────────────────────────

describe('Layer2 Retrieval', () => {
  bench('Layer2 retrieval latency', async () => {
    if (!chromaAvailable) {
      recordMetric('layer2', 'avg_retrieval_ms', 'skipped');
      return;
    }

    try {
      const gen = new PalaceDataGenerator(42, 'small');
      const wing = gen.wings[0];

      const { Layer2 } = await import('../../src/layers.js');
      const layer = new Layer2();

      const latencies: number[] = [];
      for (let i = 0; i < 10; i++) {
        const start = performance.now();
        await layer.retrieve(wing, undefined, 10);
        latencies.push(performance.now() - start);
      }

      const avgMs = latencies.reduce((a, b) => a + b, 0) / latencies.length;
      recordMetric('layer2', 'avg_retrieval_ms', Math.round(avgMs * 10) / 10);
    } catch {
      recordMetric('layer2', 'avg_retrieval_ms', 'error');
    }
  }, { iterations: 1, warmupIterations: 0 });
});

// ── Layer3 Search ────────────────────────────────────────────────────────

describe('Layer3 Search', () => {
  bench('Layer3 search latency', async () => {
    if (!chromaAvailable) {
      recordMetric('layer3', 'avg_search_ms', 'skipped');
      return;
    }

    const tmpDir = mkdtempSync(join(tmpdir(), 'layers-l3-'));
    try {
      const identityPath = join(tmpDir, 'identity.txt');
      writeFileSync(identityPath, 'I am a benchmark AI.\n');

      const { MemoryStack } = await import('../../src/layers.js');
      const stack = new MemoryStack(undefined, identityPath);

      const queries = ['authentication', 'database', 'deployment', 'testing', 'monitoring'];
      const latencies: number[] = [];
      for (const q of queries) {
        const start = performance.now();
        await stack.search(q);
        latencies.push(performance.now() - start);
      }

      const avgMs = latencies.reduce((a, b) => a + b, 0) / latencies.length;
      recordMetric('layer3', 'avg_search_ms', Math.round(avgMs * 10) / 10);
    } catch {
      recordMetric('layer3', 'avg_search_ms', 'error');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }, { iterations: 1, warmupIterations: 0 });
});
