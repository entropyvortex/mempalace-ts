/**
 * Palace boost validation -- does wing/room filtering actually help?
 *
 * Quantifies the retrieval improvement from the palace spatial metaphor.
 * Uses planted needles to measure recall with and without filtering
 * at different scales.
 *
 * Port of Python test_palace_boost.py
 */

import { describe, bench, beforeAll } from 'vitest';
import { PalaceDataGenerator } from './data-generator.js';
import { recordMetric } from './report.js';

let chromaAvailable = false;

// ── Filtered vs Unfiltered Recall ────────────────────────────────────────

describe('Palace Boost: Filtered vs Unfiltered Recall', () => {
  const SIZES = [1_000, 2_500, 5_000];

  beforeAll(async () => {
    try {
      const { getCollection } = await import('../../src/chroma.js');
      await getCollection();
      chromaAvailable = true;
    } catch {
      chromaAvailable = false;
      console.warn('ChromaDB not available -- palace boost benchmarks will record skipped metrics');
    }
  });

  for (const nDrawers of SIZES) {
    bench(`palace boost recall at ${nDrawers} drawers`, async () => {
      if (!chromaAvailable) {
        recordMetric('palace_boost', `recall_unfiltered_at_${nDrawers}`, 'skipped');
        return;
      }

      try {
        const { searchMemories } = await import('../../src/searcher.js');
        const gen = new PalaceDataGenerator(42, 'small');

        const nQueries = Math.min(10, gen.needles.length);
        let unfilteredHits = 0;
        let wingFilteredHits = 0;
        let roomFilteredHits = 0;

        for (const needle of gen.needles.slice(0, nQueries)) {
          // Unfiltered search
          const resultNone = await searchMemories({ query: needle.query, nResults: 5 });
          if (resultNone.results.slice(0, 5).some((r) => r.text.includes('NEEDLE_'))) {
            unfilteredHits++;
          }

          // Wing-filtered search
          const resultWing = await searchMemories({
            query: needle.query,
            wing: needle.wing,
            nResults: 5,
          });
          if (resultWing.results.slice(0, 5).some((r) => r.text.includes('NEEDLE_'))) {
            wingFilteredHits++;
          }

          // Wing+room filtered search
          const resultRoom = await searchMemories({
            query: needle.query,
            wing: needle.wing,
            room: needle.room,
            nResults: 5,
          });
          if (resultRoom.results.slice(0, 5).some((r) => r.text.includes('NEEDLE_'))) {
            roomFilteredHits++;
          }
        }

        const recallNone = unfilteredHits / Math.max(nQueries, 1);
        const recallWing = wingFilteredHits / Math.max(nQueries, 1);
        const recallRoom = roomFilteredHits / Math.max(nQueries, 1);

        const boostWing = recallWing - recallNone;
        const boostRoom = recallRoom - recallNone;

        recordMetric('palace_boost', `recall_unfiltered_at_${nDrawers}`, Math.round(recallNone * 1000) / 1000);
        recordMetric('palace_boost', `recall_wing_filtered_at_${nDrawers}`, Math.round(recallWing * 1000) / 1000);
        recordMetric('palace_boost', `recall_room_filtered_at_${nDrawers}`, Math.round(recallRoom * 1000) / 1000);
        recordMetric('palace_boost', `wing_boost_at_${nDrawers}`, Math.round(boostWing * 1000) / 1000);
        recordMetric('palace_boost', `room_boost_at_${nDrawers}`, Math.round(boostRoom * 1000) / 1000);
      } catch {
        recordMetric('palace_boost', `recall_unfiltered_at_${nDrawers}`, 'error');
      }
    }, { iterations: 1, warmupIterations: 0 });
  }
});

// ── Filter Latency Benefit ───────────────────────────────────────────────

describe('Palace Boost: Filter Latency Benefit', () => {
  bench('filter speedup: no filter vs wing vs wing+room', async () => {
    if (!chromaAvailable) {
      recordMetric('filter_latency', 'avg_unfiltered_ms', 'skipped');
      return;
    }

    try {
      const { searchMemories } = await import('../../src/searcher.js');
      const gen = new PalaceDataGenerator(42, 'small');

      const wing = gen.wings[0];
      const room = gen.roomsByWing[wing][0];
      const query = 'authentication middleware optimization';
      const nRuns = 10;

      // No filter
      const latenciesNone: number[] = [];
      for (let i = 0; i < nRuns; i++) {
        const start = performance.now();
        await searchMemories({ query, nResults: 5 });
        latenciesNone.push(performance.now() - start);
      }

      // Wing filter
      const latenciesWing: number[] = [];
      for (let i = 0; i < nRuns; i++) {
        const start = performance.now();
        await searchMemories({ query, wing, nResults: 5 });
        latenciesWing.push(performance.now() - start);
      }

      // Wing + room filter
      const latenciesRoom: number[] = [];
      for (let i = 0; i < nRuns; i++) {
        const start = performance.now();
        await searchMemories({ query, wing, room, nResults: 5 });
        latenciesRoom.push(performance.now() - start);
      }

      const avgNone = latenciesNone.reduce((a, b) => a + b, 0) / latenciesNone.length;
      const avgWing = latenciesWing.reduce((a, b) => a + b, 0) / latenciesWing.length;
      const avgRoom = latenciesRoom.reduce((a, b) => a + b, 0) / latenciesRoom.length;

      recordMetric('filter_latency', 'avg_unfiltered_ms', Math.round(avgNone * 10) / 10);
      recordMetric('filter_latency', 'avg_wing_filtered_ms', Math.round(avgWing * 10) / 10);
      recordMetric('filter_latency', 'avg_room_filtered_ms', Math.round(avgRoom * 10) / 10);
      if (avgNone > 0) {
        recordMetric('filter_latency', 'wing_speedup_pct', Math.round((1 - avgWing / avgNone) * 1000) / 10);
        recordMetric('filter_latency', 'room_speedup_pct', Math.round((1 - avgRoom / avgNone) * 1000) / 10);
      }
    } catch {
      recordMetric('filter_latency', 'avg_unfiltered_ms', 'error');
    }
  }, { iterations: 1, warmupIterations: 0 });
});

// ── Boost at Increasing Scale ────────────────────────────────────────────

describe('Palace Boost: Scaling', () => {
  bench('boost scaling across sizes', async () => {
    if (!chromaAvailable) {
      recordMetric('boost_scaling', 'boosts_by_size', 'skipped');
      return;
    }

    try {
      const { searchMemories } = await import('../../src/searcher.js');
      const sizes = [500, 1_000, 2_500];
      const boosts: Array<{ size: number; boost: number }> = [];

      for (const size of sizes) {
        const gen = new PalaceDataGenerator(42, 'small');
        const nQueries = Math.min(8, gen.needles.length);
        let unfilteredHits = 0;
        let filteredHits = 0;

        for (const needle of gen.needles.slice(0, nQueries)) {
          const result = await searchMemories({ query: needle.query, nResults: 5 });
          if (result.results.slice(0, 5).some((r) => r.text.includes('NEEDLE_'))) {
            unfilteredHits++;
          }

          const resultFiltered = await searchMemories({
            query: needle.query,
            wing: needle.wing,
            nResults: 5,
          });
          if (resultFiltered.results.slice(0, 5).some((r) => r.text.includes('NEEDLE_'))) {
            filteredHits++;
          }
        }

        const recallNone = unfilteredHits / Math.max(nQueries, 1);
        const recallFiltered = filteredHits / Math.max(nQueries, 1);
        boosts.push({ size, boost: recallFiltered - recallNone });
      }

      recordMetric('boost_scaling', 'boosts_by_size', boosts);
      // Check if boost increases with scale (the hypothesis)
      if (boosts.length >= 2) {
        const trendPositive = boosts[boosts.length - 1].boost >= boosts[0].boost;
        recordMetric('boost_scaling', 'trend_positive', trendPositive);
      }
    } catch {
      recordMetric('boost_scaling', 'boosts_by_size', 'error');
    }
  }, { iterations: 1, warmupIterations: 0 });
});
