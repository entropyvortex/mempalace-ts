/**
 * @module utils/gitignore
 * Lightweight .gitignore pattern matching.
 *
 * 1:1 PORT from original miner.py GitignoreMatcher class
 *
 * Supports:
 *   - Standard .gitignore patterns (glob, **, negation with !)
 *   - Anchored patterns (starting with /)
 *   - Directory-only patterns (ending with /)
 *   - Comment lines (starting with #)
 *   - Escaped characters (\# and \!)
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Simple glob pattern matching (fnmatch-style).
 * Supports: *, ?, [abc], [!abc]
 * Does NOT handle ** (that's handled separately in matchFromRoot).
 */
function fnmatch(name: string, pattern: string): boolean {
  // Convert glob pattern to regex
  let regex = '^';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') {
      regex += '[^/]*';
    } else if (c === '?') {
      regex += '[^/]';
    } else if (c === '[') {
      const close = pattern.indexOf(']', i + 1);
      if (close === -1) {
        regex += '\\[';
      } else {
        let bracket = pattern.slice(i + 1, close);
        if (bracket.startsWith('!')) bracket = '^' + bracket.slice(1);
        regex += '[' + bracket + ']';
        i = close;
      }
    } else if ('.+^${}()|\\'.includes(c)) {
      regex += '\\' + c;
    } else {
      regex += c;
    }
  }
  regex += '$';
  try {
    return new RegExp(regex).test(name);
  } catch {
    return name === pattern;
  }
}

export interface GitignoreRule {
  pattern: string;
  anchored: boolean;
  dirOnly: boolean;
  negated: boolean;
}

/**
 * Lightweight matcher for one directory's .gitignore patterns.
 * Python: miner.py GitignoreMatcher class
 */
export class GitignoreMatcher {
  readonly baseDir: string;
  readonly rules: GitignoreRule[];

  constructor(baseDir: string, rules: GitignoreRule[]) {
    this.baseDir = baseDir;
    this.rules = rules;
  }

  /**
   * Parse a .gitignore file from a directory.
   * Returns null if no .gitignore exists or it has no rules.
   */
  static fromDir(dirPath: string): GitignoreMatcher | null {
    const gitignorePath = join(dirPath, '.gitignore');
    if (!existsSync(gitignorePath)) return null;

    let lines: string[];
    try {
      lines = readFileSync(gitignorePath, 'utf-8').split('\n');
    } catch {
      return null;
    }

    const rules: GitignoreRule[] = [];
    for (let line of lines) {
      line = line.trim();
      if (!line) continue;

      if (line.startsWith('\\#') || line.startsWith('\\!')) {
        line = line.slice(1);
      } else if (line.startsWith('#')) {
        continue;
      }

      const negated = line.startsWith('!');
      if (negated) line = line.slice(1);

      const anchored = line.startsWith('/');
      if (anchored) line = line.replace(/^\/+/, '');

      const dirOnly = line.endsWith('/');
      if (dirOnly) line = line.replace(/\/+$/, '');

      if (!line) continue;

      rules.push({ pattern: line, anchored, dirOnly, negated });
    }

    if (rules.length === 0) return null;
    return new GitignoreMatcher(dirPath, rules);
  }

  /**
   * Check if a path matches this .gitignore.
   * Returns true (ignored), false (explicitly not-ignored via negation), or null (no match).
   */
  matches(path: string, isDir: boolean = false): boolean | null {
    let rel: string;
    try {
      rel = relative(this.baseDir, path).split('\\').join('/').replace(/^\/+|\/+$/g, '');
    } catch {
      return null;
    }
    if (!rel) return null;

    let ignored: boolean | null = null;
    for (const rule of this.rules) {
      if (this.ruleMatches(rule, rel, isDir)) {
        ignored = !rule.negated;
      }
    }
    return ignored;
  }

  private ruleMatches(rule: GitignoreRule, relativePath: string, isDir: boolean): boolean {
    const pattern = rule.pattern;
    const parts = relativePath.split('/');
    const patternParts = pattern.split('/');

    if (rule.dirOnly) {
      const targetParts = isDir ? parts : parts.slice(0, -1);
      if (targetParts.length === 0) return false;
      if (rule.anchored || patternParts.length > 1) {
        return this.matchFromRoot(targetParts, patternParts);
      }
      return targetParts.some((part) => fnmatch(part, pattern));
    }

    if (rule.anchored || patternParts.length > 1) {
      return this.matchFromRoot(parts, patternParts);
    }

    return parts.some((part) => fnmatch(part, pattern));
  }

  private matchFromRoot(targetParts: string[], patternParts: string[]): boolean {
    const matches = (pathIdx: number, patIdx: number): boolean => {
      if (patIdx === patternParts.length) return true;
      if (pathIdx === targetParts.length) {
        return patternParts.slice(patIdx).every((p) => p === '**');
      }

      const patternPart = patternParts[patIdx];
      if (patternPart === '**') {
        return matches(pathIdx, patIdx + 1) || matches(pathIdx + 1, patIdx);
      }

      if (!fnmatch(targetParts[pathIdx], patternPart)) return false;
      return matches(pathIdx + 1, patIdx + 1);
    };

    return matches(0, 0);
  }
}

/**
 * Load and cache one directory's .gitignore matcher.
 * Python: miner.py load_gitignore_matcher(dir_path, cache)
 */
export function loadGitignoreMatcher(
  dirPath: string,
  cache: Map<string, GitignoreMatcher | null>,
): GitignoreMatcher | null {
  if (!cache.has(dirPath)) {
    cache.set(dirPath, GitignoreMatcher.fromDir(dirPath));
  }
  return cache.get(dirPath) ?? null;
}

/**
 * Apply active .gitignore matchers in ancestor order; last match wins.
 * Python: miner.py is_gitignored(path, matchers, is_dir=False)
 */
export function isGitignored(
  path: string,
  matchers: GitignoreMatcher[],
  isDir: boolean = false,
): boolean {
  let ignored = false;
  for (const matcher of matchers) {
    const decision = matcher.matches(path, isDir);
    if (decision !== null) {
      ignored = decision;
    }
  }
  return ignored;
}
