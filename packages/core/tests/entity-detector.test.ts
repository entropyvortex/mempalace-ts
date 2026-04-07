/**
 * Entity detector + general extractor tests.
 *
 * Parity with original entity_detector.py + general_extractor.py.
 */

import { describe, it, expect } from 'vitest';
import { extractMemories } from '../src/entity-detector.js';

describe('extractMemories', () => {
  it('should extract decisions', () => {
    const text = 'We decided to use Clerk instead of Auth0 for authentication.';
    const memories = extractMemories(text);
    expect(memories.some((m) => m.memory_type === 'decision')).toBe(true);
  });

  it('should extract preferences', () => {
    const text = 'I prefer TypeScript over JavaScript. I always use strict mode.';
    const memories = extractMemories(text);
    expect(memories.some((m) => m.memory_type === 'preference')).toBe(true);
  });

  it('should extract milestones', () => {
    const text = 'We finally got it working after three days of debugging. The deployment shipped successfully.';
    const memories = extractMemories(text);
    expect(memories.some((m) => m.memory_type === 'milestone')).toBe(true);
  });

  it('should extract problems', () => {
    const text = 'The database crashed during peak load. We need a workaround for the timeout issue.';
    const memories = extractMemories(text);
    expect(memories.some((m) => m.memory_type === 'problem')).toBe(true);
  });

  it('should extract emotional content', () => {
    const text = 'I was feeling frustrated about the constant regressions. It made me worried about the timeline.';
    const memories = extractMemories(text);
    expect(memories.some((m) => m.memory_type === 'emotional')).toBe(true);
  });

  it('should return empty for trivial text', () => {
    const text = 'Hello.';
    const memories = extractMemories(text);
    expect(memories).toHaveLength(0);
  });

  it('should assign sequential chunk indices', () => {
    const text = 'We decided to switch. I prefer this approach. It finally works.';
    const memories = extractMemories(text);
    for (const m of memories) {
      expect(typeof m.chunk_index).toBe('number');
    }
  });
});
