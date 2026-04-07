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
