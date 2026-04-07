/**
 * Miner tests -- parity with original test_miner.py.
 *
 * Tests:
 *   - scanProject: respects .gitignore
 *   - scanProject: respects nested .gitignore
 *   - scanProject: allows nested gitignore override
 *   - scanProject: can disable gitignore
 *   - scanProject: include_ignored overrides gitignore
 *   - detectRoom: path-based detection
 *   - loadConfig: default config and yaml config
 */

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanProject, detectRoom, loadConfig } from '../src/miner.js';
import type { RoomConfig } from '../src/types.js';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mempalace-test-miner-'));
}

/** Write a file with some content (enough to not be skipped). */
function writeFile(filePath: string, content: string = 'some meaningful content here'): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

describe('scanProject', () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const d of tmpDirs) {
      fs.rmSync(d, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  it('should find readable files', () => {
    const tmpDir = makeTmpDir();
    tmpDirs.push(tmpDir);
    writeFile(path.join(tmpDir, 'main.ts'), 'console.log("hello");');
    writeFile(path.join(tmpDir, 'lib.js'), 'module.exports = {};');

    const files = scanProject(tmpDir, false);
    expect(files.length).toBe(2);
  });

  it('should skip files in SKIP_DIRS like node_modules', () => {
    const tmpDir = makeTmpDir();
    tmpDirs.push(tmpDir);
    writeFile(path.join(tmpDir, 'main.ts'), 'console.log("hello");');
    writeFile(path.join(tmpDir, 'node_modules', 'pkg', 'index.js'), 'module.exports = {};');

    const files = scanProject(tmpDir, false);
    expect(files.length).toBe(1);
    expect(files[0]).toContain('main.ts');
  });

  it('should skip hidden directories', () => {
    const tmpDir = makeTmpDir();
    tmpDirs.push(tmpDir);
    writeFile(path.join(tmpDir, 'main.ts'), 'console.log("hello");');
    writeFile(path.join(tmpDir, '.hidden', 'secret.ts'), 'export const x = 1;');

    const files = scanProject(tmpDir, false);
    expect(files.length).toBe(1);
  });

  it('should respect .gitignore', () => {
    const tmpDir = makeTmpDir();
    tmpDirs.push(tmpDir);
    writeFile(path.join(tmpDir, 'main.ts'), 'console.log("hello");');
    writeFile(path.join(tmpDir, 'build', 'output.js'), 'compiled output');
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), 'build/\n');

    const files = scanProject(tmpDir, true);
    expect(files.length).toBe(1);
    expect(files[0]).toContain('main.ts');
  });

  it('should respect nested .gitignore', () => {
    const tmpDir = makeTmpDir();
    tmpDirs.push(tmpDir);
    writeFile(path.join(tmpDir, 'main.ts'), 'console.log("hello");');
    writeFile(path.join(tmpDir, 'sub', 'kept.ts'), 'export const a = 1;');
    writeFile(path.join(tmpDir, 'sub', 'ignored.js'), 'ignored file');
    fs.mkdirSync(path.join(tmpDir, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'sub', '.gitignore'), '*.js\n');

    const files = scanProject(tmpDir, true);
    const basenames = files.map((f) => path.basename(f)).sort();
    expect(basenames).toContain('main.ts');
    expect(basenames).toContain('kept.ts');
    expect(basenames).not.toContain('ignored.js');
  });

  it('should allow includeIgnored to override gitignore', () => {
    const tmpDir = makeTmpDir();
    tmpDirs.push(tmpDir);
    writeFile(path.join(tmpDir, 'main.ts'), 'console.log("hello");');
    // Use a directory name NOT in SKIP_DIRS (dist/build are in SKIP_DIRS)
    writeFile(path.join(tmpDir, 'generated', 'output.js'), 'generated output');
    writeFile(path.join(tmpDir, 'generated', 'types.ts'), 'type X = string;');
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), 'generated/\n');

    // Without includeIgnored, generated/ is ignored
    const withoutOverride = scanProject(tmpDir, true);
    expect(withoutOverride.map((f) => path.basename(f))).not.toContain('output.js');

    // With includeIgnored, generated/ is included
    const files = scanProject(tmpDir, true, ['generated']);
    const basenames = files.map((f) => path.basename(f)).sort();
    expect(basenames).toContain('output.js');
    expect(basenames).toContain('types.ts');
  });

  it('should disable gitignore when respectGitignore is false', () => {
    const tmpDir = makeTmpDir();
    tmpDirs.push(tmpDir);
    writeFile(path.join(tmpDir, 'main.ts'), 'console.log("hello");');
    // Use a directory name NOT in SKIP_DIRS
    writeFile(path.join(tmpDir, 'generated', 'output.js'), 'compiled output');
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), 'generated/\n');

    const files = scanProject(tmpDir, false);
    expect(files.length).toBe(2);
  });

  it('should only include files with readable extensions', () => {
    const tmpDir = makeTmpDir();
    tmpDirs.push(tmpDir);
    writeFile(path.join(tmpDir, 'main.ts'), 'console.log("hello");');
    writeFile(path.join(tmpDir, 'image.png'), 'binary data');
    writeFile(path.join(tmpDir, 'data.bin'), 'binary data');

    const files = scanProject(tmpDir, false);
    expect(files.length).toBe(1);
    expect(files[0]).toContain('main.ts');
  });
});

describe('detectRoom', () => {
  const rooms: RoomConfig[] = [
    { name: 'auth', description: 'Authentication', keywords: ['login', 'password', 'token'] },
    { name: 'api', description: 'API layer', keywords: ['endpoint', 'route', 'handler'] },
    { name: 'general', description: 'General files', keywords: [] },
  ];

  it('should detect room from folder path', () => {
    const result = detectRoom('/project/src/auth/login.ts', 'some content', rooms);
    expect(result).toBe('auth');
  });

  it('should detect room from filename', () => {
    const result = detectRoom('/project/src/auth-service.ts', 'some content', rooms);
    expect(result).toBe('auth');
  });

  it('should detect room from content keywords', () => {
    const result = detectRoom(
      '/project/src/service.ts',
      'This handles the login flow with password validation and token refresh',
      rooms,
    );
    expect(result).toBe('auth');
  });

  it('should fall back to general when no match', () => {
    const result = detectRoom(
      '/project/src/utils.ts',
      'utility functions for string manipulation',
      rooms,
    );
    expect(result).toBe('general');
  });
});

describe('loadConfig', () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const d of tmpDirs) {
      fs.rmSync(d, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  it('should return default config when no yaml file exists', () => {
    const tmpDir = makeTmpDir();
    tmpDirs.push(tmpDir);

    const config = loadConfig(tmpDir);
    expect(config.wing).toContain('wing_');
    expect(config.rooms).toHaveLength(1);
    expect(config.rooms[0].name).toBe('general');
  });

  it('should load config from mempalace.yaml', () => {
    const tmpDir = makeTmpDir();
    tmpDirs.push(tmpDir);
    const yaml = `wing: wing_myproject
rooms:
  - name: auth
    description: Authentication
    keywords:
      - login
      - password
  - name: api
    description: API layer
    keywords:
      - endpoint
`;
    fs.writeFileSync(path.join(tmpDir, 'mempalace.yaml'), yaml);

    const config = loadConfig(tmpDir);
    expect(config.wing).toBe('wing_myproject');
    expect(config.rooms.length).toBe(2);
    expect(config.rooms[0].name).toBe('auth');
    expect(config.rooms[1].name).toBe('api');
  });
});
