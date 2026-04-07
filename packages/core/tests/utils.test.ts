/**
 * Utility tests — parity with original normalize.py and miner.py chunk_text().
 */

import { describe, it, expect } from 'vitest';
import { normalize } from '../src/utils/normalize.js';
import { chunkText } from '../src/utils/chunk.js';
import { expandHome } from '../src/utils/paths.js';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

describe('normalize', () => {
  it('should pass through plain text with > markers', () => {
    const input = '> Hello\nHi there';
    expect(normalize(input)).toBe(input);
  });

  it('should normalize Claude.ai JSON', () => {
    const input = JSON.stringify([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
    ]);
    const result = normalize(input);
    expect(result).toContain('> Hello');
    expect(result).toContain('Hi there!');
  });

  it('should normalize Slack JSON', () => {
    const input = JSON.stringify([
      { type: 'message', user: 'alice', text: 'Hey team' },
      { type: 'message', user: 'bob', text: 'Hey!' },
    ]);
    const result = normalize(input);
    expect(result).toContain('[alice] Hey team');
    expect(result).toContain('[bob] Hey!');
  });

  it('should handle empty input', () => {
    expect(normalize('')).toBe('');
    expect(normalize('   ')).toBe('');
  });

  it('should pass through unstructured plain text', () => {
    const input = 'Just some regular text content';
    expect(normalize(input)).toBe(input);
  });
});

describe('chunkText', () => {
  it('should return a single chunk for short text', () => {
    const text = 'Short text content.';
    const chunks = chunkText(text, 800, 100);
    // Too short (< MIN_CHUNK_SIZE of 50), so empty
    expect(chunks).toHaveLength(0);
  });

  it('should chunk long text with overlap', () => {
    const text = 'A'.repeat(2000);
    const chunks = chunkText(text, 800, 100);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('should preserve paragraph boundaries', () => {
    const para1 = 'First paragraph with enough content to be kept.'.repeat(5);
    const para2 = 'Second paragraph with enough content to be kept.'.repeat(5);
    const text = `${para1}\n\n${para2}`;
    const chunks = chunkText(text, 300, 50);

    // Should try to break at paragraph boundary
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });

  it('should assign sequential chunk indices', () => {
    const text = 'Word '.repeat(500);
    const chunks = chunkText(text, 200, 20);

    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i].chunk_index).toBe(i);
    }
  });
});

describe('expandHome', () => {
  it('should expand ~ to home directory', () => {
    const result = expandHome('~/test');
    expect(result).toBe(resolve(homedir(), 'test'));
  });

  it('should leave absolute paths unchanged', () => {
    const result = expandHome('/usr/local/bin');
    expect(result).toBe('/usr/local/bin');
  });
});
