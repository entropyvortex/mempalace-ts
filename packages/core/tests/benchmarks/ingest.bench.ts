/**
 * Ingestion throughput benchmarks.
 *
 * Measures mining performance at scale:
 *   - Files/sec and drawers/sec through the full mine() pipeline
 *   - Peak RSS during mining
 *   - Chunking throughput isolated from ChromaDB
 *   - Re-ingest skip overhead
 *
 * Port of Python test_ingest_bench.py
 */

import { describe, bench, beforeAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PalaceDataGenerator } from './data-generator.js';
import { recordMetric } from './report.js';

function getRssMb(): number {
  return process.memoryUsage().rss / (1024 * 1024);
}

let chromaAvailable = false;

// ── Mine Throughput ──────────────────────────────────────────────────────

describe('Mine Throughput', () => {
  beforeAll(async () => {
    try {
      const { getCollection } = await import('../../src/chroma.js');
      await getCollection();
      chromaAvailable = true;
    } catch {
      chromaAvailable = false;
      console.warn('ChromaDB not available -- mine throughput benchmarks will record skipped metrics');
    }
  });

  for (const nFiles of [20, 50, 100]) {
    bench(`mine ${nFiles} files`, async () => {
      if (!chromaAvailable) {
        recordMetric('ingest', `files_per_sec_at_${nFiles}`, 'skipped');
        return;
      }

      const tmpDir = mkdtempSync(join(tmpdir(), 'ingest-mine-'));
      try {
        const gen = new PalaceDataGenerator(42, 'small');
        const { projectPath, wing, rooms, filesWritten } = gen.generateProjectTree(
          join(tmpDir, 'project'),
          { nFiles },
        );

        const { mine } = await import('../../src/miner.js');

        const start = performance.now();
        const result = await mine({ projectDir: projectPath });
        const elapsed = (performance.now() - start) / 1000;

        const filesPerSec = filesWritten / Math.max(elapsed, 0.001);
        const drawersPerSec = result.drawersAdded / Math.max(elapsed, 0.001);

        recordMetric('ingest', `files_per_sec_at_${nFiles}`, Math.round(filesPerSec * 10) / 10);
        recordMetric('ingest', `drawers_per_sec_at_${nFiles}`, Math.round(drawersPerSec * 10) / 10);
        recordMetric('ingest', `elapsed_sec_at_${nFiles}`, Math.round(elapsed * 100) / 100);
        recordMetric('ingest', `drawers_created_at_${nFiles}`, result.drawersAdded);
      } catch (err) {
        recordMetric('ingest', `files_per_sec_at_${nFiles}`, 'error');
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    }, { iterations: 1, warmupIterations: 0 });
  }

  bench('mine peak RSS', async () => {
    if (!chromaAvailable) {
      recordMetric('ingest', 'peak_rss_mb', 'skipped');
      return;
    }

    const tmpDir = mkdtempSync(join(tmpdir(), 'ingest-rss-'));
    try {
      const gen = new PalaceDataGenerator(42, 'small');
      const { projectPath } = gen.generateProjectTree(join(tmpDir, 'project'), { nFiles: 100 });

      const { mine } = await import('../../src/miner.js');

      const rssBefore = getRssMb();
      const rssSamples: number[] = [];

      // Sample RSS periodically using setInterval
      const interval = setInterval(() => rssSamples.push(getRssMb()), 100);

      await mine({ projectDir: projectPath });

      clearInterval(interval);
      rssSamples.push(getRssMb());

      const peakRss = rssSamples.length > 0 ? Math.max(...rssSamples) : getRssMb();
      const rssDelta = peakRss - rssBefore;

      recordMetric('ingest', 'peak_rss_mb', Math.round(peakRss * 10) / 10);
      recordMetric('ingest', 'rss_delta_mb', Math.round(rssDelta * 10) / 10);
    } catch {
      recordMetric('ingest', 'peak_rss_mb', 'error');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }, { iterations: 1, warmupIterations: 0 });
});

// ── Chunk Throughput ─────────────────────────────────────────────────────

describe('Chunk Throughput', () => {
  for (const contentSizeKb of [1, 10, 100]) {
    bench(`chunk text at ${contentSizeKb}KB`, async () => {
      const { chunkText } = await import('../../src/utils/chunk.js');
      const gen = new PalaceDataGenerator(42);

      // Generate content of target size
      let content = gen.randomText(contentSizeKb * 500, contentSizeKb * 1200);
      // Pad to approximate target KB
      while (content.length < contentSizeKb * 1024) {
        content += '\n' + gen.randomText(200, 500);
      }

      const nIterations = 50;
      const start = performance.now();
      let totalChunks = 0;
      for (let i = 0; i < nIterations; i++) {
        const chunks = chunkText(content);
        totalChunks += chunks.length;
      }
      const elapsed = (performance.now() - start) / 1000;

      const chunksPerSec = totalChunks / Math.max(elapsed, 0.001);
      const kbPerSec = ((content.length * nIterations) / 1024) / Math.max(elapsed, 0.001);

      recordMetric('chunking', `chunks_per_sec_at_${contentSizeKb}kb`, Math.round(chunksPerSec * 10) / 10);
      recordMetric('chunking', `kb_per_sec_at_${contentSizeKb}kb`, Math.round(kbPerSec * 10) / 10);
    }, { iterations: 1, warmupIterations: 0 });
  }
});

// ── Re-ingest Skip Overhead ──────────────────────────────────────────────

describe('Re-ingest Skip Overhead', () => {
  bench('skip check cost', async () => {
    if (!chromaAvailable) {
      recordMetric('reingest', 'skip_check_elapsed_sec', 'skipped');
      return;
    }

    const tmpDir = mkdtempSync(join(tmpdir(), 'reingest-'));
    try {
      const gen = new PalaceDataGenerator(42, 'small');
      const { projectPath, filesWritten } = gen.generateProjectTree(
        join(tmpDir, 'project'),
        { nFiles: 50 },
      );

      const { mine } = await import('../../src/miner.js');

      // First mine
      await mine({ projectDir: projectPath });

      // Re-mine (all files should be skipped)
      const start = performance.now();
      const result = await mine({ projectDir: projectPath });
      const skipElapsed = (performance.now() - start) / 1000;

      recordMetric('reingest', 'skip_check_elapsed_sec', Math.round(skipElapsed * 100) / 100);
      recordMetric('reingest', 'files_checked', filesWritten);
      recordMetric(
        'reingest',
        'skip_check_per_file_ms',
        Math.round((skipElapsed * 1000) / Math.max(filesWritten, 1) * 10) / 10,
      );
    } catch {
      recordMetric('reingest', 'skip_check_elapsed_sec', 'error');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }, { iterations: 1, warmupIterations: 0 });
});
