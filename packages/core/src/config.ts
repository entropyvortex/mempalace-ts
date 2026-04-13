/**
 * @module config
 * MemPalace configuration system.
 *
 * 1:1 PORT from original config.py
 *
 * Priority: env vars > config file (~/.mempalace/config.json) > defaults
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { expandHome } from './utils/paths.js';
import {
  DEFAULT_PALACE_PATH,
  DEFAULT_COLLECTION_NAME,
  DEFAULT_TOPIC_WINGS,
} from './types.js';

// ---------------------------------------------------------------------------
// Input validation — 1:1 PORT from config.py sanitize_name / sanitize_content
// ---------------------------------------------------------------------------

/**
 * Maximum length for wing/room/entity names.
 * Python: config.py MAX_NAME_LENGTH
 */
export const MAX_NAME_LENGTH = 128;

/**
 * Safe-name regex. Accepts Unicode letters/digits, spaces, dots, apostrophes,
 * and hyphens. Must NOT start or end with underscore. Single characters are
 * valid.
 *
 * Python: config.py _SAFE_NAME_RE  (uses \w which is Unicode-aware in Python 3;
 * in TS we use \p{L}\p{N} with the `u` flag for equivalent behaviour.)
 */
const _SAFE_NAME_RE = /^(?:[\p{L}\p{N}](?:[\p{L}\p{N} .'\-]{0,126}[\p{L}\p{N}])?)$/u;

/**
 * Validate and sanitize a wing/room/entity name.
 *
 * Python: config.py sanitize_name(value, field_name)
 *
 * @throws {Error} If the name is invalid.
 */
export function sanitizeName(value: string, fieldName = 'name'): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }
  value = value.trim();
  if (value.length > MAX_NAME_LENGTH) {
    throw new Error(`${fieldName} exceeds maximum length of ${MAX_NAME_LENGTH} characters`);
  }
  if (value.includes('..') || value.includes('/') || value.includes('\\')) {
    throw new Error(`${fieldName} contains invalid path characters`);
  }
  if (value.includes('\x00')) {
    throw new Error(`${fieldName} contains null bytes`);
  }
  if (!_SAFE_NAME_RE.test(value)) {
    throw new Error(`${fieldName} contains invalid characters`);
  }
  return value;
}

/**
 * Validate drawer/diary content length.
 *
 * Python: config.py sanitize_content(value, max_length)
 *
 * @throws {Error} If the content is invalid.
 */
export function sanitizeContent(value: string, maxLength = 100_000): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('content must be a non-empty string');
  }
  if (value.length > maxLength) {
    throw new Error(`content exceeds maximum length of ${maxLength} characters`);
  }
  if (value.includes('\x00')) {
    throw new Error('content contains null bytes');
  }
  return value;
}

const FileConfigSchema = z.object({
  palace_path: z.string().optional(),
  collection_name: z.string().optional(),
  people_map: z.record(z.string(), z.string()).optional(),
  topic_wings: z.array(z.string()).optional(),
  hall_keywords: z.record(z.string(), z.array(z.string())).optional(),
}).passthrough();

/**
 * Default hall keywords mapping.
 * Python: config.py DEFAULT_HALL_KEYWORDS
 */
export const CONFIG_HALL_KEYWORDS: Record<string, string[]> = {
  emotions: [
    'scared', 'afraid', 'worried', 'happy', 'sad', 'love',
    'hate', 'feel', 'cry', 'tears',
  ],
  consciousness: [
    'consciousness', 'conscious', 'aware', 'real', 'genuine',
    'soul', 'exist', 'alive',
  ],
  memory: ['memory', 'remember', 'forget', 'recall', 'archive', 'palace', 'store'],
  technical: [
    'code', 'python', 'script', 'bug', 'error', 'function',
    'api', 'database', 'server',
  ],
  identity: ['identity', 'name', 'who am i', 'persona', 'self'],
  family: ['family', 'kids', 'children', 'daughter', 'son', 'parent', 'mother', 'father'],
  creative: ['game', 'gameplay', 'player', 'app', 'design', 'art', 'music', 'story'],
};

/**
 * Configuration manager for MemPalace.
 *
 * Load order: env vars > config file > defaults.
 *
 * Python: config.py MempalaceConfig class
 */
export class MempalaceConfig {
  private _configDir: string;
  private _configFile: string;
  private _peopleMapFile: string;
  private _fileConfig: z.infer<typeof FileConfigSchema>;

  constructor(configDir?: string) {
    this._configDir = configDir ?? expandHome('~/.mempalace');
    this._configFile = join(this._configDir, 'config.json');
    this._peopleMapFile = join(this._configDir, 'people_map.json');
    this._fileConfig = {};

    if (existsSync(this._configFile)) {
      try {
        const raw = JSON.parse(readFileSync(this._configFile, 'utf-8'));
        this._fileConfig = FileConfigSchema.parse(raw);
      } catch {
        this._fileConfig = {};
      }
    }
  }

  /** Path to the memory palace data directory. */
  get palacePath(): string {
    const envVal = process.env.MEMPALACE_PALACE_PATH ?? process.env.MEMPAL_PALACE_PATH;
    if (envVal) return envVal;
    return this._fileConfig.palace_path ?? expandHome(DEFAULT_PALACE_PATH);
  }

  /** ChromaDB collection name. */
  get collectionName(): string {
    return this._fileConfig.collection_name ?? DEFAULT_COLLECTION_NAME;
  }

  /** Mapping of name variants to canonical names. */
  get peopleMap(): Record<string, string> {
    if (existsSync(this._peopleMapFile)) {
      try {
        return JSON.parse(readFileSync(this._peopleMapFile, 'utf-8'));
      } catch {
        // fall through
      }
    }
    return this._fileConfig.people_map ?? {};
  }

  /** List of topic wing names. */
  get topicWings(): readonly string[] {
    return this._fileConfig.topic_wings ?? DEFAULT_TOPIC_WINGS;
  }

  /** Mapping of hall names to keyword lists. */
  get hallKeywords(): Record<string, string[]> {
    return this._fileConfig.hall_keywords ?? CONFIG_HALL_KEYWORDS;
  }

  /**
   * Whether the stop hook saves directly (true) or blocks for MCP calls (false).
   * Python: config.py MempalaceConfig.hook_silent_save
   */
  get hookSilentSave(): boolean {
    const hooks = (this._fileConfig as Record<string, unknown>).hooks as
      | Record<string, unknown>
      | undefined;
    return (hooks?.silent_save as boolean) ?? true;
  }

  /**
   * Whether the stop hook shows a desktop notification via notify-send.
   * Python: config.py MempalaceConfig.hook_desktop_toast
   */
  get hookDesktopToast(): boolean {
    const hooks = (this._fileConfig as Record<string, unknown>).hooks as
      | Record<string, unknown>
      | undefined;
    return (hooks?.desktop_toast as boolean) ?? false;
  }

  /**
   * Update a hook setting and write config to disk.
   * Python: config.py MempalaceConfig.set_hook_setting(key, value)
   */
  setHookSetting(key: string, value: boolean): void {
    const fc = this._fileConfig as Record<string, unknown>;
    if (!fc.hooks || typeof fc.hooks !== 'object') {
      fc.hooks = {};
    }
    (fc.hooks as Record<string, unknown>)[key] = value;
    try {
      writeFileSync(this._configFile, JSON.stringify(this._fileConfig, null, 2));
    } catch {
      // Ignore write errors (e.g. read-only filesystem)
    }
  }

  /** Create config directory and write default config.json if it doesn't exist. */
  init(): string {
    mkdirSync(this._configDir, { recursive: true });
    if (!existsSync(this._configFile)) {
      const defaultConfig = {
        palace_path: expandHome(DEFAULT_PALACE_PATH),
        collection_name: DEFAULT_COLLECTION_NAME,
        topic_wings: DEFAULT_TOPIC_WINGS,
        hall_keywords: CONFIG_HALL_KEYWORDS,
      };
      writeFileSync(this._configFile, JSON.stringify(defaultConfig, null, 2));
    }
    return this._configFile;
  }

  /** Write people_map.json to config directory. */
  savePeopleMap(peopleMap: Record<string, string>): string {
    mkdirSync(this._configDir, { recursive: true });
    writeFileSync(this._peopleMapFile, JSON.stringify(peopleMap, null, 2));
    return this._peopleMapFile;
  }
}
