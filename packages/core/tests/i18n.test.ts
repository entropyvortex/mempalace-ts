/**
 * i18n tests -- parity with original i18n/__init__.py.
 *
 * Tests:
 *   - loadLang('en') loads English
 *   - t() returns key for missing translations
 *   - t() interpolates variables
 *   - availableLanguages includes 'en'
 *   - currentLang returns current language
 *   - getRegex returns object
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { loadLang, t, availableLanguages, currentLang, getRegex } from '../src/i18n.js';

describe('i18n', () => {
  beforeEach(() => {
    // Reset to English before each test
    loadLang('en');
  });

  // ---------------------------------------------------------------------------
  // loadLang
  // ---------------------------------------------------------------------------

  it('loadLang("en") should load English', () => {
    const lang = loadLang('en');

    expect(lang.lang).toBe('en');
    expect(lang.terms).toBeDefined();
    expect(lang.cli).toBeDefined();
    expect(lang.aaak).toBeDefined();
  });

  it('loadLang with unknown language should fall back to English', () => {
    const lang = loadLang('xx_nonexistent');

    expect(currentLang()).toBe('en');
    expect(lang.terms).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // t() translation function
  // ---------------------------------------------------------------------------

  it('t() should return key for missing translations', () => {
    const result = t('nonexistent.key_that_does_not_exist');
    expect(result).toBe('nonexistent.key_that_does_not_exist');
  });

  it('t() should return known translations', () => {
    const result = t('terms.palace');
    expect(result).toBe('palace');
  });

  it('t() should interpolate variables', () => {
    const result = t('cli.mine_start', { path: '/my/docs' });
    expect(result).toContain('/my/docs');
  });

  it('t() should interpolate numeric variables', () => {
    const result = t('cli.mine_complete', { closets: 5, drawers: 20 });
    expect(result).toContain('5');
    expect(result).toContain('20');
  });

  it('t() should leave unmatched placeholders intact', () => {
    const result = t('cli.mine_start', {});
    expect(result).toContain('{path}');
  });

  it('t() should handle top-level key lookup', () => {
    const result = t('lang');
    expect(result).toBe('en');
  });

  // ---------------------------------------------------------------------------
  // availableLanguages
  // ---------------------------------------------------------------------------

  it('availableLanguages should include "en"', () => {
    const languages = availableLanguages();
    expect(languages).toContain('en');
  });

  it('availableLanguages should return a sorted array', () => {
    const languages = availableLanguages();
    const sorted = [...languages].sort();
    expect(languages).toEqual(sorted);
  });

  // ---------------------------------------------------------------------------
  // currentLang
  // ---------------------------------------------------------------------------

  it('currentLang should return current language code', () => {
    loadLang('en');
    expect(currentLang()).toBe('en');
  });

  // ---------------------------------------------------------------------------
  // getRegex
  // ---------------------------------------------------------------------------

  it('getRegex should return an object', () => {
    const regex = getRegex();
    expect(typeof regex).toBe('object');
    expect(regex).not.toBeNull();
  });

  it('getRegex should have topic_pattern key', () => {
    const regex = getRegex();
    expect(regex.topic_pattern).toBeDefined();
    expect(typeof regex.topic_pattern).toBe('string');
  });

  it('getRegex should have stop_words key', () => {
    const regex = getRegex();
    expect(regex.stop_words).toBeDefined();
    expect(typeof regex.stop_words).toBe('string');
  });
});
