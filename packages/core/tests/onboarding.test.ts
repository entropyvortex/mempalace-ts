/**
 * Onboarding tests -- parity with original onboarding.py.
 *
 * Tests:
 *   - DEFAULT_WINGS has work/personal/combo keys
 *   - quickSetup creates EntityRegistry with seeded data
 *   - quickSetup accepts custom config directory
 */

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_WINGS, quickSetup } from '../src/onboarding.js';
import type { PersonEntry, PalaceMode } from '../src/onboarding.js';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mempalace-test-onboarding-'));
}

describe('DEFAULT_WINGS', () => {
  it('should have work key with project-related wings', () => {
    expect(DEFAULT_WINGS.work).toBeDefined();
    expect(Array.isArray(DEFAULT_WINGS.work)).toBe(true);
    expect(DEFAULT_WINGS.work.length).toBeGreaterThan(0);
    expect(DEFAULT_WINGS.work).toContain('projects');
  });

  it('should have personal key with personal wings', () => {
    expect(DEFAULT_WINGS.personal).toBeDefined();
    expect(Array.isArray(DEFAULT_WINGS.personal)).toBe(true);
    expect(DEFAULT_WINGS.personal.length).toBeGreaterThan(0);
    expect(DEFAULT_WINGS.personal).toContain('family');
  });

  it('should have combo key with mixed wings', () => {
    expect(DEFAULT_WINGS.combo).toBeDefined();
    expect(Array.isArray(DEFAULT_WINGS.combo)).toBe(true);
    expect(DEFAULT_WINGS.combo.length).toBeGreaterThan(0);
    expect(DEFAULT_WINGS.combo).toContain('family');
    expect(DEFAULT_WINGS.combo).toContain('work');
  });

  it('should only have work, personal, and combo keys', () => {
    const keys = Object.keys(DEFAULT_WINGS);
    expect(keys.sort()).toEqual(['combo', 'personal', 'work']);
  });
});

describe('quickSetup', () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const d of tmpDirs) {
      fs.rmSync(d, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  it('should create EntityRegistry with seeded data', () => {
    const tmpDir = makeTmpDir();
    tmpDirs.push(tmpDir);

    const people: PersonEntry[] = [
      { name: 'Alice', relationship: 'colleague', context: 'work' },
      { name: 'Bob', relationship: 'friend', context: 'personal' },
    ];
    const projects = ['Driftwood', 'Lantern'];

    const registry = quickSetup('combo', people, projects, {}, tmpDir);

    expect(registry).toBeDefined();
    expect(registry.mode).toBe('combo');
    expect(registry.people).toHaveProperty('Alice');
    expect(registry.people).toHaveProperty('Bob');
    expect(registry.projects).toEqual(['Driftwood', 'Lantern']);
  });

  it('should accept custom config directory', () => {
    const tmpDir = makeTmpDir();
    const customDir = path.join(tmpDir, 'custom-config');
    tmpDirs.push(tmpDir);

    const registry = quickSetup('work', [], [], {}, customDir);

    // Registry file should be created in custom dir
    const registryFile = path.join(customDir, 'entity_registry.json');
    expect(fs.existsSync(registryFile)).toBe(true);
    expect(registry.mode).toBe('work');
  });

  it('should seed aliases correctly', () => {
    const tmpDir = makeTmpDir();
    tmpDirs.push(tmpDir);

    const people: PersonEntry[] = [
      { name: 'Maxwell', relationship: 'friend', context: 'personal' },
    ];
    const aliases = { Max: 'Maxwell' };

    const registry = quickSetup('personal', people, [], aliases, tmpDir);

    expect(registry.people).toHaveProperty('Maxwell');
    expect(registry.people).toHaveProperty('Max');
    expect(registry.people.Max.canonical).toBe('Maxwell');
  });

  it('should handle empty people and projects', () => {
    const tmpDir = makeTmpDir();
    tmpDirs.push(tmpDir);

    const registry = quickSetup('personal', [], [], {}, tmpDir);

    expect(registry.mode).toBe('personal');
    expect(Object.keys(registry.people)).toHaveLength(0);
    expect(registry.projects).toHaveLength(0);
  });

  it('should work with all three modes', () => {
    const modes: PalaceMode[] = ['work', 'personal', 'combo'];

    for (const mode of modes) {
      const tmpDir = makeTmpDir();
      tmpDirs.push(tmpDir);

      const registry = quickSetup(mode, [], [], {}, tmpDir);
      expect(registry.mode).toBe(mode);
    }
  });
});
