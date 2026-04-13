/**
 * Config sanitization tests -- parity with original config.py sanitize_name / sanitize_content.
 *
 * Tests:
 *   - sanitizeName: valid names, Unicode, rejections
 *   - sanitizeContent: valid content, rejections, custom max length
 *   - MempalaceConfig hook settings
 */

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sanitizeName, sanitizeContent, MAX_NAME_LENGTH, MempalaceConfig } from '../src/config.js';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mempalace-test-sanitize-'));
}

// ---------------------------------------------------------------------------
// sanitizeName
// ---------------------------------------------------------------------------

describe('sanitizeName', () => {
  it('should accept a valid ASCII name', () => {
    expect(sanitizeName('Alice')).toBe('Alice');
  });

  it('should accept a valid name with spaces and hyphens', () => {
    expect(sanitizeName('Mary-Jane Watson')).toBe('Mary-Jane Watson');
  });

  it('should accept valid Unicode: CJK characters', () => {
    expect(sanitizeName('\u5317\u4EAC')).toBe('\u5317\u4EAC');
  });

  it('should accept valid Unicode: Cyrillic characters', () => {
    expect(sanitizeName('\u041C\u043E\u0441\u043A\u0432\u0430')).toBe('\u041C\u043E\u0441\u043A\u0432\u0430');
  });

  it('should accept valid Unicode: accented Latin characters', () => {
    expect(sanitizeName('R\u012Bga')).toBe('R\u012Bga');
  });

  it('should accept a single character name', () => {
    expect(sanitizeName('A')).toBe('A');
  });

  it('should reject empty string', () => {
    expect(() => sanitizeName('')).toThrow('non-empty');
  });

  it('should reject whitespace-only string', () => {
    expect(() => sanitizeName('   ')).toThrow('non-empty');
  });

  it('should reject name exceeding MAX_NAME_LENGTH', () => {
    const longName = 'A'.repeat(MAX_NAME_LENGTH + 1);
    expect(() => sanitizeName(longName)).toThrow('maximum length');
  });

  it('should reject path traversal (..)', () => {
    expect(() => sanitizeName('some..path')).toThrow('invalid path characters');
  });

  it('should reject forward slash', () => {
    expect(() => sanitizeName('some/path')).toThrow('invalid path characters');
  });

  it('should reject backslash', () => {
    expect(() => sanitizeName('some\\path')).toThrow('invalid path characters');
  });

  it('should reject null byte', () => {
    expect(() => sanitizeName('some\x00name')).toThrow('null bytes');
  });

  it('should reject name starting with underscore', () => {
    expect(() => sanitizeName('_private')).toThrow('invalid characters');
  });

  it('should reject special characters (< > |)', () => {
    expect(() => sanitizeName('test<name')).toThrow('invalid characters');
    expect(() => sanitizeName('test>name')).toThrow('invalid characters');
    expect(() => sanitizeName('test|name')).toThrow('invalid characters');
  });
});

// ---------------------------------------------------------------------------
// sanitizeContent
// ---------------------------------------------------------------------------

describe('sanitizeContent', () => {
  it('should accept valid content', () => {
    const content = 'This is valid content with multiple sentences.';
    expect(sanitizeContent(content)).toBe(content);
  });

  it('should reject empty content', () => {
    expect(() => sanitizeContent('')).toThrow('non-empty');
  });

  it('should reject whitespace-only content', () => {
    expect(() => sanitizeContent('   ')).toThrow('non-empty');
  });

  it('should reject content over default max length', () => {
    const longContent = 'A'.repeat(100_001);
    expect(() => sanitizeContent(longContent)).toThrow('maximum length');
  });

  it('should reject content containing null bytes', () => {
    expect(() => sanitizeContent('hello\x00world')).toThrow('null bytes');
  });

  it('should respect custom max length', () => {
    const content = 'A'.repeat(51);
    expect(() => sanitizeContent(content, 50)).toThrow('maximum length');
    expect(sanitizeContent(content, 100)).toBe(content);
  });
});

// ---------------------------------------------------------------------------
// MempalaceConfig hook settings
// ---------------------------------------------------------------------------

describe('MempalaceConfig hook settings', () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const d of tmpDirs) {
      fs.rmSync(d, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  it('hookSilentSave should default to true', () => {
    const tmpDir = makeTmpDir();
    tmpDirs.push(tmpDir);
    const cfg = new MempalaceConfig(tmpDir);
    expect(cfg.hookSilentSave).toBe(true);
  });

  it('hookDesktopToast should default to false', () => {
    const tmpDir = makeTmpDir();
    tmpDirs.push(tmpDir);
    const cfg = new MempalaceConfig(tmpDir);
    expect(cfg.hookDesktopToast).toBe(false);
  });

  it('setHookSetting should write to config', () => {
    const tmpDir = makeTmpDir();
    tmpDirs.push(tmpDir);

    // Create config directory and file first
    const configFile = path.join(tmpDir, 'config.json');
    fs.writeFileSync(configFile, JSON.stringify({}));

    const cfg = new MempalaceConfig(tmpDir);
    cfg.setHookSetting('silent_save', false);

    // Re-read the config to verify persistence
    const raw = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
    expect(raw.hooks.silent_save).toBe(false);
  });

  it('setHookSetting should update hookSilentSave value', () => {
    const tmpDir = makeTmpDir();
    tmpDirs.push(tmpDir);

    const configFile = path.join(tmpDir, 'config.json');
    fs.writeFileSync(configFile, JSON.stringify({}));

    const cfg = new MempalaceConfig(tmpDir);
    cfg.setHookSetting('silent_save', false);
    expect(cfg.hookSilentSave).toBe(false);
  });

  it('hookSilentSave should read from config file', () => {
    const tmpDir = makeTmpDir();
    tmpDirs.push(tmpDir);

    const configFile = path.join(tmpDir, 'config.json');
    fs.writeFileSync(configFile, JSON.stringify({
      hooks: { silent_save: false },
    }));

    const cfg = new MempalaceConfig(tmpDir);
    expect(cfg.hookSilentSave).toBe(false);
  });

  it('hookDesktopToast should read from config file', () => {
    const tmpDir = makeTmpDir();
    tmpDirs.push(tmpDir);

    const configFile = path.join(tmpDir, 'config.json');
    fs.writeFileSync(configFile, JSON.stringify({
      hooks: { desktop_toast: true },
    }));

    const cfg = new MempalaceConfig(tmpDir);
    expect(cfg.hookDesktopToast).toBe(true);
  });
});
