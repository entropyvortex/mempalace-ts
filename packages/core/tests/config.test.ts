/**
 * Config tests -- parity with original test_config.py.
 *
 * Tests:
 *   - Default configuration values
 *   - Config from file
 *   - Environment variable override
 *   - init() creates config directory and file
 */

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MempalaceConfig } from '../src/config.js';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mempalace-test-config-'));
}

describe('MempalaceConfig', () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    // Clean up env vars
    delete process.env.MEMPALACE_PALACE_PATH;
    delete process.env.MEMPAL_PALACE_PATH;
    // Clean up temp dirs
    for (const d of tmpDirs) {
      fs.rmSync(d, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  it('should have default palacePath containing palace', () => {
    const tmpDir = makeTmpDir();
    tmpDirs.push(tmpDir);
    const cfg = new MempalaceConfig(tmpDir);
    expect(cfg.palacePath).toContain('palace');
  });

  it('should have default collectionName of mempalace_drawers', () => {
    const tmpDir = makeTmpDir();
    tmpDirs.push(tmpDir);
    const cfg = new MempalaceConfig(tmpDir);
    expect(cfg.collectionName).toBe('mempalace_drawers');
  });

  it('should read palace_path from config file', () => {
    const tmpDir = makeTmpDir();
    tmpDirs.push(tmpDir);
    const configFile = path.join(tmpDir, 'config.json');
    fs.writeFileSync(configFile, JSON.stringify({ palace_path: '/custom/palace/path' }));

    const cfg = new MempalaceConfig(tmpDir);
    expect(cfg.palacePath).toBe('/custom/palace/path');
  });

  it('should prioritize MEMPALACE_PALACE_PATH env over config file', () => {
    const tmpDir = makeTmpDir();
    tmpDirs.push(tmpDir);
    const configFile = path.join(tmpDir, 'config.json');
    fs.writeFileSync(configFile, JSON.stringify({ palace_path: '/from/file' }));

    process.env.MEMPALACE_PALACE_PATH = '/from/env';
    const cfg = new MempalaceConfig(tmpDir);
    expect(cfg.palacePath).toBe('/from/env');
  });

  it('should prioritize MEMPAL_PALACE_PATH env as fallback', () => {
    const tmpDir = makeTmpDir();
    tmpDirs.push(tmpDir);

    process.env.MEMPAL_PALACE_PATH = '/from/mempal/env';
    const cfg = new MempalaceConfig(tmpDir);
    expect(cfg.palacePath).toBe('/from/mempal/env');
  });

  it('should create config.json on init()', () => {
    const tmpDir = makeTmpDir();
    const configDir = path.join(tmpDir, 'newdir');
    tmpDirs.push(tmpDir);

    const cfg = new MempalaceConfig(configDir);
    const configFile = cfg.init();

    expect(fs.existsSync(configFile)).toBe(true);
    const content = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
    expect(content).toHaveProperty('palace_path');
    expect(content).toHaveProperty('collection_name');
  });

  it('should not overwrite existing config on init()', () => {
    const tmpDir = makeTmpDir();
    tmpDirs.push(tmpDir);
    const configFile = path.join(tmpDir, 'config.json');
    fs.writeFileSync(configFile, JSON.stringify({ palace_path: '/my/custom' }));

    const cfg = new MempalaceConfig(tmpDir);
    cfg.init();

    const content = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
    expect(content.palace_path).toBe('/my/custom');
  });
});
