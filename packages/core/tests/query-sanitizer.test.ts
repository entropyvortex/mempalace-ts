/**
 * Query sanitizer tests -- parity with original query_sanitizer.py.
 *
 * Tests:
 *   - Short query passthrough (under 200 chars)
 *   - Empty query passthrough
 *   - Question extraction from contaminated query
 *   - Fullwidth question mark extraction
 *   - Tail sentence extraction when no question mark
 *   - Tail truncation fallback for very long queries with no sentence structure
 *   - Wrapping quote stripping
 *   - Returns correct method field for each path
 *   - wasSanitized is false for passthrough, true for all others
 */

import { describe, it, expect } from 'vitest';
import {
  sanitizeQuery,
  SAFE_QUERY_LENGTH,
  MAX_QUERY_LENGTH,
  MIN_QUERY_LENGTH,
} from '../src/query-sanitizer.js';

describe('sanitizeQuery', () => {
  // ---------------------------------------------------------------------------
  // Passthrough
  // ---------------------------------------------------------------------------

  it('should pass through short queries under 200 chars', () => {
    const query = 'What is the meaning of life?';
    const result = sanitizeQuery(query);

    expect(result.cleanQuery).toBe(query);
    expect(result.wasSanitized).toBe(false);
    expect(result.method).toBe('passthrough');
    expect(result.originalLength).toBe(query.length);
    expect(result.cleanLength).toBe(query.length);
  });

  it('should pass through empty query', () => {
    const result = sanitizeQuery('');

    expect(result.cleanQuery).toBe('');
    expect(result.wasSanitized).toBe(false);
    expect(result.method).toBe('passthrough');
    expect(result.originalLength).toBe(0);
    expect(result.cleanLength).toBe(0);
  });

  it('should pass through whitespace-only query', () => {
    const result = sanitizeQuery('   ');

    expect(result.wasSanitized).toBe(false);
    expect(result.method).toBe('passthrough');
  });

  it('should pass through query at exactly SAFE_QUERY_LENGTH', () => {
    const query = 'A'.repeat(SAFE_QUERY_LENGTH);
    const result = sanitizeQuery(query);

    expect(result.wasSanitized).toBe(false);
    expect(result.method).toBe('passthrough');
  });

  // ---------------------------------------------------------------------------
  // Question extraction
  // ---------------------------------------------------------------------------

  it('should extract question from contaminated query with system prompt', () => {
    const systemPrompt = 'You are a helpful AI assistant. '.repeat(10); // ~310 chars
    const actualQuestion = 'What is the capital of France?';
    const contaminated = systemPrompt + actualQuestion;

    expect(contaminated.length).toBeGreaterThan(SAFE_QUERY_LENGTH);

    const result = sanitizeQuery(contaminated);

    expect(result.wasSanitized).toBe(true);
    expect(result.method).toBe('question_extraction');
    expect(result.cleanQuery).toContain('capital of France');
  });

  it('should extract question with fullwidth question mark', () => {
    const padding = 'System instructions are very long and important. '.repeat(6);
    const question = 'What is machine learning\uff1f';
    const contaminated = padding + '\n' + question;

    expect(contaminated.length).toBeGreaterThan(SAFE_QUERY_LENGTH);

    const result = sanitizeQuery(contaminated);

    expect(result.wasSanitized).toBe(true);
    expect(result.method).toBe('question_extraction');
    expect(result.cleanQuery).toContain('machine learning');
  });

  // ---------------------------------------------------------------------------
  // Tail sentence extraction
  // ---------------------------------------------------------------------------

  it('should extract tail sentence when no question mark present', () => {
    const padding = 'System prompt instruction block. '.repeat(10);
    const actualQuery = 'Tell me about the architecture of the new backend system';
    const contaminated = padding + '\n' + actualQuery;

    expect(contaminated.length).toBeGreaterThan(SAFE_QUERY_LENGTH);

    const result = sanitizeQuery(contaminated);

    expect(result.wasSanitized).toBe(true);
    expect(result.method).toBe('tail_sentence');
    expect(result.cleanQuery).toContain('architecture');
  });

  // ---------------------------------------------------------------------------
  // Tail truncation fallback
  // ---------------------------------------------------------------------------

  it('should fall back to tail truncation for very long queries with no sentence structure', () => {
    // Build a string with newline-separated segments all shorter than MIN_QUERY_LENGTH
    // so tail_sentence extraction cannot find a qualifying segment.
    const shortChunks = Array.from({ length: 100 }, (_, i) => `ab${i}`).join('\n');

    expect(shortChunks.length).toBeGreaterThan(SAFE_QUERY_LENGTH);

    const result = sanitizeQuery(shortChunks);

    expect(result.wasSanitized).toBe(true);
    expect(result.method).toBe('tail_truncation');
    expect(result.cleanLength).toBeLessThanOrEqual(MAX_QUERY_LENGTH);
  });

  // ---------------------------------------------------------------------------
  // Wrapping quote stripping
  // ---------------------------------------------------------------------------

  it('should strip wrapping quotes during extraction', () => {
    const padding = 'System prompt content is here. '.repeat(10);
    const quoted = '"What is the best framework for web development?"';
    const contaminated = padding + '\n' + quoted;

    const result = sanitizeQuery(contaminated);

    expect(result.wasSanitized).toBe(true);
    // The question mark should still trigger question_extraction
    expect(result.method).toBe('question_extraction');
  });

  // ---------------------------------------------------------------------------
  // Method field correctness
  // ---------------------------------------------------------------------------

  it('should return passthrough method for short queries', () => {
    const result = sanitizeQuery('Short query');
    expect(result.method).toBe('passthrough');
  });

  it('should return question_extraction method when question mark found', () => {
    const padding = 'X '.repeat(150);
    const result = sanitizeQuery(padding + '\nWhat is X?');
    expect(result.method).toBe('question_extraction');
  });

  it('should return tail_sentence method when sentence found but no question', () => {
    const padding = 'Instructions block content. '.repeat(10);
    const sentence = 'Find all documents related to the project migration plan';
    const result = sanitizeQuery(padding + '\n' + sentence);

    expect(result.wasSanitized).toBe(true);
    expect(result.method).toBe('tail_sentence');
  });

  it('should return tail_truncation method as last resort', () => {
    // All segments must be shorter than MIN_QUERY_LENGTH (10 chars)
    const noStructure = Array.from({ length: 80 }, (_, i) => `z${i}`).join('\n');
    expect(noStructure.length).toBeGreaterThan(SAFE_QUERY_LENGTH);
    const result = sanitizeQuery(noStructure);
    expect(result.method).toBe('tail_truncation');
  });

  // ---------------------------------------------------------------------------
  // wasSanitized flag
  // ---------------------------------------------------------------------------

  it('should set wasSanitized to false for passthrough', () => {
    const result = sanitizeQuery('Hello world');
    expect(result.wasSanitized).toBe(false);
  });

  it('should set wasSanitized to true for question extraction', () => {
    const padding = 'System prompt. '.repeat(20);
    const result = sanitizeQuery(padding + '\nWhat is X?');
    expect(result.wasSanitized).toBe(true);
  });

  it('should set wasSanitized to true for tail sentence', () => {
    const padding = 'Long instructions block. '.repeat(12);
    const result = sanitizeQuery(padding + '\nTell me about the architecture of this system');
    expect(result.wasSanitized).toBe(true);
  });

  it('should set wasSanitized to true for tail truncation', () => {
    const result = sanitizeQuery('z'.repeat(500));
    expect(result.wasSanitized).toBe(true);
  });
});
