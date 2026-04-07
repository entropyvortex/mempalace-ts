/**
 * Dialect (AAAK) tests — parity with original dialect.py behavior.
 *
 * Tests:
 *   - Entity encoding (name → 3-letter code)
 *   - Emotion detection from text
 *   - Flag detection from text
 *   - Text compression
 *   - Compression statistics
 *   - Token estimation
 *   - Config save/load
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Dialect } from '../src/dialect.js';

describe('Dialect', () => {
  let dialect: Dialect;

  beforeEach(() => {
    dialect = new Dialect({ Alice: 'ALC', Bob: 'BOB', Driftwood: 'DFT' });
  });

  // -------------------------------------------------------------------------
  // Entity Encoding
  // Python: Dialect.encode_entity()
  // -------------------------------------------------------------------------

  describe('encodeEntity', () => {
    it('should return existing entity codes', () => {
      expect(dialect.encodeEntity('Alice')).toBe('ALC');
      expect(dialect.encodeEntity('Bob')).toBe('BOB');
    });

    it('should be case-insensitive for lookup', () => {
      expect(dialect.encodeEntity('alice')).toBe('ALC');
      expect(dialect.encodeEntity('ALICE')).toBe('ALC');
    });

    it('should auto-generate codes for unknown entities', () => {
      const code = dialect.encodeEntity('Charlie');
      expect(code).toBe('CHA');
    });

    it('should return null for skipped names', () => {
      const d = new Dialect({}, ['the', 'a']);
      expect(d.encodeEntity('the')).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Emotion Detection
  // Python: Dialect.compress() → emotion signal detection
  // -------------------------------------------------------------------------

  describe('detectEmotions', () => {
    it('should detect emotions from text', () => {
      const emotions = dialect.detectEmotions('I was excited and grateful');
      expect(emotions).toContain('excite');
      expect(emotions).toContain('grat');
    });

    it('should detect multiple emotions', () => {
      const emotions = dialect.detectEmotions('I felt happy but also worried');
      expect(emotions).toContain('joy');
      expect(emotions).toContain('anx');
    });

    it('should return empty for neutral text', () => {
      const emotions = dialect.detectEmotions('The function returns a value');
      expect(emotions).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Emotion Encoding
  // Python: Dialect.encode_emotions()
  // -------------------------------------------------------------------------

  describe('encodeEmotions', () => {
    it('should encode emotion names to codes', () => {
      const result = dialect.encodeEmotions(['vulnerability', 'joy']);
      expect(result).toBe('vul,joy');
    });

    it('should pass through already-coded emotions', () => {
      const result = dialect.encodeEmotions(['vul', 'joy']);
      expect(result).toBe('vul,joy');
    });
  });

  // -------------------------------------------------------------------------
  // Flag Detection
  // Python: Dialect.get_flags()
  // -------------------------------------------------------------------------

  describe('getFlags', () => {
    it('should detect ORIGIN flags', () => {
      const flags = dialect.getFlags('We founded the company in 2020');
      expect(flags).toContain('ORIGIN');
    });

    it('should detect DECISION flags', () => {
      const flags = dialect.getFlags('We decided to switch to Clerk instead of Auth0');
      expect(flags).toContain('DECISION');
    });

    it('should detect TECHNICAL flags', () => {
      const flags = dialect.getFlags('The API architecture uses a microservices pattern');
      expect(flags).toContain('TECHNICAL');
    });

    it('should detect PIVOT flags', () => {
      const flags = dialect.getFlags('It was a turning point when I realized the truth');
      expect(flags).toContain('PIVOT');
    });

    it('should detect multiple flags', () => {
      const flags = dialect.getFlags('We decided to create the API architecture from scratch');
      expect(flags).toContain('DECISION');
      expect(flags).toContain('TECHNICAL');
    });

    it('should not detect SENSITIVE (manual only)', () => {
      const flags = dialect.getFlags('This is very sensitive information');
      expect(flags).not.toContain('SENSITIVE');
    });
  });

  // -------------------------------------------------------------------------
  // Compression
  // Python: Dialect.compress()
  // -------------------------------------------------------------------------

  describe('compress', () => {
    it('should replace entity names with codes', () => {
      const result = dialect.compress('Alice told Bob about Driftwood');
      expect(result).toContain('ALC');
      expect(result).toContain('BOB');
      expect(result).toContain('DFT');
    });

    it('should strip filler words', () => {
      const result = dialect.compress('The very important decision was actually quite basic');
      expect(result).not.toContain(' the ');
      expect(result).not.toContain(' very ');
      expect(result).not.toContain(' actually ');
      expect(result).not.toContain(' quite ');
    });

    it('should append emotion codes when detected', () => {
      const result = dialect.compress('I was excited and happy about the decision');
      expect(result).toContain('excite');
      expect(result).toContain('joy');
    });

    it('should append flags when detected', () => {
      const result = dialect.compress('We decided to switch the API architecture');
      expect(result).toContain('DECISION');
      expect(result).toContain('TECHNICAL');
    });

    it('should add metadata header when provided', () => {
      const result = dialect.compress('Some content', { wing: 'wing_app', room: 'auth' });
      expect(result).toContain('[wing_app/auth]');
    });
  });

  // -------------------------------------------------------------------------
  // Compression Statistics
  // Python: Dialect.compression_stats()
  // -------------------------------------------------------------------------

  describe('compressionStats', () => {
    it('should calculate compression ratio', () => {
      const original = 'This is a very long text that contains many words and filler content.';
      const compressed = dialect.compress(original);
      const stats = dialect.compressionStats(original, compressed);

      expect(stats.original_tokens).toBeGreaterThan(0);
      expect(stats.compressed_tokens).toBeGreaterThan(0);
      expect(stats.ratio).toBeGreaterThan(0);
      expect(stats.savings_percent).toBeGreaterThan(0);
    });

    it('should show savings as a percentage', () => {
      // 100 chars → 25 tokens, 25 chars → 7 tokens → (25-7)/25*100 = 72%
      const stats = dialect.compressionStats('a'.repeat(100), 'a'.repeat(25));
      expect(stats.savings_percent).toBeGreaterThan(50);
      expect(stats.original_tokens).toBeGreaterThan(stats.compressed_tokens);
    });
  });

  // -------------------------------------------------------------------------
  // Token Counting
  // Python: Dialect.count_tokens()
  // -------------------------------------------------------------------------

  describe('countTokens', () => {
    it('should estimate ~4 chars per token', () => {
      expect(Dialect.countTokens('hello world')).toBe(3); // 11 chars / 4 ≈ 3
    });

    it('should return 0 for empty string', () => {
      expect(Dialect.countTokens('')).toBe(0);
    });
  });
});
