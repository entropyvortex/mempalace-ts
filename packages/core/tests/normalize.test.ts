/**
 * Normalize tests -- parity with original test_normalize.py.
 *
 * Tests:
 *   - Plain text pass-through
 *   - Claude AI JSON format normalization
 *   - Empty string handling
 */

import { describe, it, expect } from 'vitest';
import { normalize } from '../src/utils/normalize.js';

describe('normalize', () => {
  it('should pass through plain text', () => {
    const result = normalize('Hello world\nSecond line\n');
    expect(result).toContain('Hello world');
    expect(result).toContain('Second line');
  });

  it('should normalize Claude AI JSON format', () => {
    const json = JSON.stringify([
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello' },
    ]);
    const result = normalize(json);
    expect(result).toContain('Hi');
    expect(result).toContain('Hello');
  });

  it('should return empty string for empty input', () => {
    expect(normalize('')).toBe('');
  });

  it('should return empty string for whitespace-only input', () => {
    expect(normalize('   \n  \t  ')).toBe('');
  });

  it('should pass through text with > markers', () => {
    const input = '> What is the weather?\nIt is sunny today.';
    const result = normalize(input);
    expect(result).toContain('> What is the weather?');
    expect(result).toContain('It is sunny today.');
  });

  it('should handle Claude Code JSONL format', () => {
    const lines = [
      JSON.stringify({ type: 'human', message: { role: 'user', content: 'Hello there' } }),
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'Hi back' } }),
    ].join('\n');
    const result = normalize(lines);
    expect(result).toContain('Hello there');
    expect(result).toContain('Hi back');
  });

  // Issue #327: newer Claude Code uses type: "user" instead of "human"
  it('should handle Claude Code JSONL with type: "user" messages', () => {
    const lines = [
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'New format hello' } }),
      JSON.stringify({ type: 'ai', message: { role: 'assistant', content: 'New format reply' } }),
    ].join('\n');
    const result = normalize(lines);
    expect(result).toContain('New format hello');
    expect(result).toContain('New format reply');
  });

  it('should handle mixed old and new Claude Code JSONL types', () => {
    const lines = [
      JSON.stringify({ type: 'human', message: { role: 'user', content: 'Old format' } }),
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'Reply one' } }),
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'New format' } }),
      JSON.stringify({ type: 'ai', message: { role: 'assistant', content: 'Reply two' } }),
    ].join('\n');
    const result = normalize(lines);
    expect(result).toContain('Old format');
    expect(result).toContain('New format');
    expect(result).toContain('Reply one');
    expect(result).toContain('Reply two');
  });
});
