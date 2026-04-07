/**
 * Benchmark report utilities -- JSON output and regression detection.
 *
 * Each benchmark records metrics via recordMetric(). Results are persisted
 * to a JSON file on disk for cross-run comparison.
 *
 * Port of Python report.py
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

export const RESULTS_FILE = join(tmpdir(), 'mempalace_bench_results.json');

/**
 * Append a metric to the session results file (JSON on disk).
 */
export function recordMetric(category: string, metric: string, value: unknown): void {
  let results: Record<string, Record<string, unknown>> = {};

  if (existsSync(RESULTS_FILE)) {
    try {
      results = JSON.parse(readFileSync(RESULTS_FILE, 'utf-8'));
    } catch {
      results = {};
    }
  }

  if (!results[category]) {
    results[category] = {};
  }
  results[category][metric] = value;

  mkdirSync(dirname(RESULTS_FILE), { recursive: true });
  writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2), 'utf-8');
}

/**
 * Compare current benchmark results against a baseline.
 *
 * Returns a list of regression descriptions. Empty list = no regressions.
 *
 * @param currentReport - Path to current results JSON
 * @param baselineReport - Path to baseline results JSON
 * @param threshold - Fractional degradation allowed (0.2 = 20% worse is OK)
 */
export function checkRegression(
  currentReport: string,
  baselineReport: string,
  threshold = 0.2,
): string[] {
  const current = JSON.parse(readFileSync(currentReport, 'utf-8'));
  const baseline = JSON.parse(readFileSync(baselineReport, 'utf-8'));

  const regressions: string[] = [];

  // Keywords for metric direction -- checked in order, first match wins.
  // "improvement" is checked before "latency" so that composite names
  // like "latency_improvement_pct" are classified correctly.
  const higherIsBetterKw = [
    'improvement',
    'recall',
    'throughput',
    'per_sec',
    'files_per_sec',
    'drawers_per_sec',
    'triples_per_sec',
    'speedup',
  ];
  const higherIsWorseKw = [
    'latency',
    'rss',
    'memory',
    'oom',
    'lock_failures',
    'elapsed',
    'p50_ms',
    'p95_ms',
    'p99_ms',
    'rss_delta_mb',
    'peak_rss_mb',
    'errors',
    'failures',
  ];

  function metricDirection(name: string): 'higher_better' | 'higher_worse' | 'unknown' {
    const low = name.toLowerCase();
    for (const kw of higherIsBetterKw) {
      if (low.includes(kw)) return 'higher_better';
    }
    for (const kw of higherIsWorseKw) {
      if (low.includes(kw)) return 'higher_worse';
    }
    return 'unknown';
  }

  const baseResults = baseline.results ?? baseline;
  const currResults = current.results ?? current;

  for (const category of Object.keys(baseResults)) {
    if (!currResults[category]) continue;
    for (const [metric, baseVal] of Object.entries(baseResults[category])) {
      if (!(metric in currResults[category])) continue;
      const currVal = currResults[category][metric];
      if (typeof baseVal !== 'number' || typeof currVal !== 'number') continue;
      if (baseVal === 0) continue;

      const direction = metricDirection(metric);

      if (direction === 'higher_worse') {
        // Higher is worse -- check if current exceeds baseline by threshold
        if (currVal > baseVal * (1 + threshold)) {
          const pct = ((currVal - baseVal) / baseVal) * 100;
          regressions.push(
            `${category}/${metric}: ${baseVal.toFixed(2)} -> ${currVal.toFixed(2)} (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%, threshold ${(threshold * 100).toFixed(0)}%)`,
          );
        }
      } else if (direction === 'higher_better') {
        // Lower is worse -- check if current is below baseline by threshold
        if (currVal < baseVal * (1 - threshold)) {
          const pct = ((currVal - baseVal) / baseVal) * 100;
          regressions.push(
            `${category}/${metric}: ${baseVal.toFixed(2)} -> ${currVal.toFixed(2)} (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%, threshold ${(threshold * 100).toFixed(0)}%)`,
          );
        }
      }
    }
  }

  return regressions;
}
