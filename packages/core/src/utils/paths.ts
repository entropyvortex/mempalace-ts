/**
 * @module utils/paths
 * Path resolution utilities.
 */

import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync, existsSync } from 'node:fs';

/**
 * Expand ~ to home directory.
 */
export function expandHome(p: string): string {
  if (p.startsWith('~/') || p === '~') {
    return resolve(homedir(), p.slice(2));
  }
  return p;
}

/**
 * Resolve and expand a path.
 */
export function resolvePath(p: string): string {
  return resolve(expandHome(p));
}

/**
 * Ensure a directory exists, creating it recursively if needed.
 */
export function ensureDir(dirPath: string): void {
  const resolved = resolvePath(dirPath);
  if (!existsSync(resolved)) {
    mkdirSync(resolved, { recursive: true });
  }
}
