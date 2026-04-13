/**
 * @module i18n
 * Language dictionaries for MemPalace.
 *
 * 1:1 PORT from original i18n/__init__.py
 *
 * Maps directly to:
 *   Python file: i18n/__init__.py — available_languages(), load_lang(), t(), current_lang(), get_regex()
 *
 * Usage:
 *   import { loadLang, t } from './i18n.js';
 *
 *   loadLang('fr');                             // load French
 *   t('cli.mine_start', { path: '/docs' });     // "Extraction de /docs..."
 *   t('terms.wing');                             // "aile"
 *   t('aaak.instruction');                       // AAAK compression instruction in French
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Structure of a language section (flat key-value). */
type LangSection = Record<string, string>;

/** Top-level structure of a language JSON file. */
interface LangFile {
  lang: string;
  label: string;
  terms: LangSection;
  cli: LangSection;
  aaak: LangSection;
  regex: LangSection;
  [section: string]: string | LangSection;
}

/** Regex patterns extracted from the current language. */
interface RegexPatterns {
  topic_pattern?: string;
  stop_words?: string;
  quote_pattern?: string;
  action_pattern?: string;
  [key: string]: string | undefined;
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

const _LANG_DIR = join(dirname(fileURLToPath(import.meta.url)), 'lang');

let _strings: LangFile | null = null;
let _currentLang = 'en';

// ---------------------------------------------------------------------------
// Inline English fallback (used when lang/ directory is missing)
// ---------------------------------------------------------------------------

const _ENGLISH_FALLBACK: LangFile = {
  lang: 'en',
  label: 'English',
  terms: {
    palace: 'palace',
    wing: 'wing',
    hall: 'hall',
    closet: 'closet',
    drawer: 'drawer',
    mine: 'mine',
    search: 'search',
    status: 'status',
    init: 'init',
    repair: 'repair',
    migrate: 'migrate',
    entity: 'entity',
    topic: 'topic',
  },
  cli: {
    mine_start: 'Mining {path}...',
    mine_complete: 'Done. {closets} closets, {drawers} drawers created.',
    mine_skip: 'Already mined. Use --force to re-mine.',
    search_no_results: 'No results for: {query}',
    search_results: 'Found {count} results:',
    status_palace: 'Palace: {path}',
    status_wings: '{count} wings',
    status_closets: '{count} closets',
    status_drawers: '{count} drawers',
    init_complete: 'Palace initialized at {path}',
    init_exists: 'Palace already exists at {path}',
    repair_complete: 'Repair complete. {fixed} issues fixed.',
    migrate_complete: 'Migration complete.',
    no_palace: 'No palace found. Run: mempalace init <dir>',
  },
  aaak: {
    instruction:
      'Compress to index format. Hyphens between words, pipes between concepts. Drop articles and filler. Keep names and numbers exact.',
  },
  regex: {
    topic_pattern: '[A-Z][a-z]{2,}|[A-Za-z][A-Za-z0-9_]{2,}',
    stop_words:
      'the this that these those some many most each every other only such very will would could should must shall yeah okay also even then now already still back done make take give know think want need going come find work added saved session summary conversation topics source about once just really actually here there where good great better thank please sorry right wrong true false',
    quote_pattern: '"([^"]{20,200})"',
    action_pattern:
      '(?:built|fixed|wrote|added|pushed|measured|tested|reviewed|created|deleted|updated|configured|deployed|migrated)\\s+[\\w\\s]{3,30}',
  },
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Return list of available language codes.
 * Python: i18n/__init__.py — available_languages()
 */
export function availableLanguages(): string[] {
  try {
    const files = readdirSync(_LANG_DIR);
    return files
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''))
      .sort();
  } catch {
    // lang/ directory missing — only embedded English is available
    return ['en'];
  }
}

/**
 * Load a language dictionary. Falls back to English if not found.
 * Python: i18n/__init__.py — load_lang()
 */
export function loadLang(lang: string = 'en'): LangFile {
  let loaded = false;

  try {
    const langFile = join(_LANG_DIR, `${lang}.json`);
    const raw = readFileSync(langFile, 'utf-8');
    _strings = JSON.parse(raw) as LangFile;
    _currentLang = lang;
    loaded = true;
  } catch {
    // Requested language not found — try English from disk
    if (lang !== 'en') {
      try {
        const enFile = join(_LANG_DIR, 'en.json');
        const raw = readFileSync(enFile, 'utf-8');
        _strings = JSON.parse(raw) as LangFile;
        _currentLang = 'en';
        loaded = true;
      } catch {
        // fall through to inline fallback
      }
    }
  }

  if (!loaded) {
    _strings = _ENGLISH_FALLBACK;
    _currentLang = 'en';
  }

  return _strings!;
}

/**
 * Get a translated string by dotted key. Supports {var} interpolation.
 * Python: i18n/__init__.py — t()
 *
 * @example
 *   t('cli.mine_complete', { closets: 5, drawers: 20 })
 *   // => "Done. 5 closets, 20 drawers created."
 */
export function t(key: string, kwargs?: Record<string, string | number>): string {
  if (!_strings) {
    loadLang('en');
  }
  const strings = _strings!;

  const parts = key.split('.', 2);
  let val: string;

  if (parts.length === 2) {
    const [section, name] = parts;
    const sectionData = strings[section];
    if (typeof sectionData === 'object' && sectionData !== null) {
      val = (sectionData as LangSection)[name] ?? key;
    } else {
      val = key;
    }
  } else {
    const topLevel = strings[key];
    val = typeof topLevel === 'string' ? topLevel : key;
  }

  if (kwargs) {
    try {
      val = val.replace(/\{(\w+)\}/g, (_match, varName: string) => {
        return varName in kwargs ? String(kwargs[varName]) : `{${varName}}`;
      });
    } catch {
      // interpolation failed — return raw string
    }
  }

  return val;
}

/**
 * Return current language code.
 * Python: i18n/__init__.py — current_lang()
 */
export function currentLang(): string {
  return _currentLang;
}

/**
 * Return the regex patterns for the current language.
 * Python: i18n/__init__.py — get_regex()
 *
 * Keys: topic_pattern, stop_words, quote_pattern, action_pattern.
 * Returns empty object if no regex section in the language file.
 */
export function getRegex(): RegexPatterns {
  if (!_strings) {
    loadLang('en');
  }
  const regex = _strings!.regex;
  if (typeof regex === 'object' && regex !== null) {
    return regex as RegexPatterns;
  }
  return {};
}

// ---------------------------------------------------------------------------
// Auto-load English on import
// ---------------------------------------------------------------------------

loadLang('en');
