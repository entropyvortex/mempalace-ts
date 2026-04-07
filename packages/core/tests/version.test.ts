/**
 * Version consistency tests -- parity with original test_version_consistency.py.
 *
 * Tests:
 *   - package.json version field exists and matches semver pattern
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('version consistency', () => {
  it('should have a valid version in package.json', () => {
    const pkgPath = path.resolve(__dirname, '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

    expect(pkg.version).toBeDefined();
    expect(typeof pkg.version).toBe('string');
    // Semver pattern: major.minor.patch with optional pre-release
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('should have a package name', () => {
    const pkgPath = path.resolve(__dirname, '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

    expect(pkg.name).toBe('@mempalace-ts/core');
  });
});
