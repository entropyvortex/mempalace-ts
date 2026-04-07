/**
 * Split mega-files tests -- parity with original test_split_mega_files.py.
 *
 * Tests:
 *   - findSessionBoundaries: detects true session starts
 *   - extractTimestamp: extracts timestamp from lines
 *   - extractPeople: detects known names in text
 *   - extractSubject: finds first meaningful user prompt
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  findSessionBoundaries,
  extractTimestamp,
  extractPeople,
  extractSubject,
} from '../src/split-mega-files.js';

describe('findSessionBoundaries', () => {
  it('should detect lines with Claude Code v as session starts', () => {
    const lines = [
      'some preamble',
      'Claude Code v1.0.0',
      'some content here',
      'more content',
      'Claude Code v1.1.0',
      'another session',
    ];
    const boundaries = findSessionBoundaries(lines);
    expect(boundaries).toContain(1);
    expect(boundaries).toContain(4);
    expect(boundaries).toHaveLength(2);
  });

  it('should exclude context-restore lines (Ctrl+E nearby)', () => {
    // isTrueSessionStart looks at lines[idx..idx+6], so Ctrl+E must NOT be
    // near the first header but MUST be near the second one.
    const lines = [
      'Claude Code v1.0.0',
      'real session content line 1',
      'real session content line 2',
      'real session content line 3',
      'real session content line 4',
      'real session content line 5',
      'real session content line 6',
      'Claude Code v1.1.0',
      'something',
      'Ctrl+E to restore',
      'more stuff',
    ];
    const boundaries = findSessionBoundaries(lines);
    // First is a true session start, second has Ctrl+E within 6 lines
    expect(boundaries).toContain(0);
    expect(boundaries).not.toContain(7);
    expect(boundaries).toHaveLength(1);
  });

  it('should exclude context-restore lines with previous messages', () => {
    const lines = [
      'Claude Code v1.0.0',
      'real session line 1',
      'real session line 2',
      'real session line 3',
      'real session line 4',
      'real session line 5',
      'real session line 6',
      'Claude Code v1.1.0',
      'loading previous messages',
      'content',
    ];
    const boundaries = findSessionBoundaries(lines);
    expect(boundaries).toContain(0);
    expect(boundaries).not.toContain(7);
    expect(boundaries).toHaveLength(1);
  });

  it('should return empty array when no session headers exist', () => {
    const lines = ['just normal content', 'no headers here'];
    expect(findSessionBoundaries(lines)).toHaveLength(0);
  });
});

describe('extractTimestamp', () => {
  it('should extract timestamp from lines with correct format', () => {
    const lines = [
      'Claude Code v1.0.0',
      '\u23FA 2:30 PM Wednesday, March 15, 2025',
      'Some content',
    ];
    const [human, iso] = extractTimestamp(lines);
    expect(human).not.toBeNull();
    expect(iso).not.toBeNull();
    expect(human).toContain('2025');
    expect(human).toContain('03');
    expect(iso).toBe('2025-03-15');
  });

  it('should return nulls when no timestamp is found', () => {
    const lines = ['No timestamp here', 'Just regular text'];
    const [human, iso] = extractTimestamp(lines);
    expect(human).toBeNull();
    expect(iso).toBeNull();
  });
});

describe('extractPeople', () => {
  it('should detect known people from content', () => {
    // Uses FALLBACK_KNOWN_PEOPLE: Alice, Ben, Riley, Max, Sam, Devon, Jordan
    // extractPeople joins lines with no separator, so ensure word boundaries
    // are preserved by adding spaces.
    const lines = [
      'Alice reviewed the change with Ben ',
      'They discussed the plan',
    ];
    const people = extractPeople(lines);
    expect(people).toContain('Alice');
    expect(people).toContain('Ben');
  });

  it('should return sorted results', () => {
    const lines = ['Sam and Alice talked about the project'];
    const people = extractPeople(lines);
    expect(people).toEqual([...people].sort());
  });

  it('should return empty array when no known names found', () => {
    const lines = ['No known people mentioned here at all'];
    const people = extractPeople(lines);
    expect(people).toHaveLength(0);
  });
});

describe('extractSubject', () => {
  it('should find first meaningful user prompt', () => {
    const lines = [
      'Claude Code v1.0.0',
      '> help me fix the authentication bug in the login page',
      'Sure, let me look at that.',
    ];
    const subject = extractSubject(lines);
    expect(subject.length).toBeGreaterThan(0);
    expect(subject).toContain('help');
    expect(subject).toContain('authentication');
  });

  it('should skip shell command prompts', () => {
    const lines = [
      '> cd /some/path',
      '> git status',
      '> python main.py',
      '> refactor the database module to use connection pooling',
    ];
    const subject = extractSubject(lines);
    expect(subject).toContain('refactor');
  });

  it('should return session when no meaningful prompt found', () => {
    const lines = ['No prompt lines here', 'Just regular text'];
    const subject = extractSubject(lines);
    expect(subject).toBe('session');
  });

  it('should truncate long subjects to 60 chars', () => {
    const lines = [
      '> ' + 'a'.repeat(100) + ' meaningful content here',
    ];
    const subject = extractSubject(lines);
    expect(subject.length).toBeLessThanOrEqual(60);
  });
});
