/**
 * @module entity-registry
 * Persistent personal entity registry for MemPalace.
 *
 * 1:1 PORT from original entity_registry.py
 *
 * Knows the difference between Riley (a person) and ever (an adverb).
 * Built from three sources, in priority order:
 *   1. Onboarding — what the user explicitly told us
 *   2. Learned — what we inferred from session history with high confidence
 *   3. Researched — what we looked up via Wikipedia for unknown words
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { z } from 'zod';
import { expandHome } from './utils/paths.js';

// ---------------------------------------------------------------------------
// Common English words that could be confused with names
// These get flagged as AMBIGUOUS and require context disambiguation
// ---------------------------------------------------------------------------

export const COMMON_ENGLISH_WORDS: ReadonlySet<string> = new Set([
  // Words that are also common personal names
  'ever', 'grace', 'will', 'bill', 'mark', 'april', 'may', 'june',
  'joy', 'hope', 'faith', 'chance', 'chase', 'hunter', 'dash',
  'flash', 'star', 'sky', 'river', 'brook', 'lane', 'art', 'clay',
  'gil', 'nat', 'max', 'rex', 'ray', 'jay', 'rose', 'violet',
  'lily', 'ivy', 'ash', 'reed', 'sage',
  // Words that look like names at start of sentence
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'january', 'february', 'march', 'july', 'august', 'september',
  'october', 'november', 'december',
]);

// ---------------------------------------------------------------------------
// Context patterns that indicate a word is being used as a PERSON name
// ---------------------------------------------------------------------------

export const PERSON_CONTEXT_PATTERNS: readonly string[] = [
  '\\b{name}\\s+said\\b',
  '\\b{name}\\s+told\\b',
  '\\b{name}\\s+asked\\b',
  '\\b{name}\\s+laughed\\b',
  '\\b{name}\\s+smiled\\b',
  '\\b{name}\\s+was\\b',
  '\\b{name}\\s+is\\b',
  '\\b{name}\\s+called\\b',
  '\\b{name}\\s+texted\\b',
  '\\bwith\\s+{name}\\b',
  '\\bsaw\\s+{name}\\b',
  '\\bcalled\\s+{name}\\b',
  '\\btook\\s+{name}\\b',
  '\\bpicked\\s+up\\s+{name}\\b',
  '\\bdrop(?:ped)?\\s+(?:off\\s+)?{name}\\b',
  "\\b{name}(?:'s|s')\\b",  // Riley's, Max's
  '\\bhey\\s+{name}\\b',
  '\\bthanks?\\s+{name}\\b',
  '^{name}[:\\s]',  // dialogue: "Riley: ..."
  '\\bmy\\s+(?:son|daughter|kid|child|brother|sister|friend|partner|colleague|coworker)\\s+{name}\\b',
];

// ---------------------------------------------------------------------------
// Context patterns that indicate a word is NOT being used as a name
// ---------------------------------------------------------------------------

export const CONCEPT_CONTEXT_PATTERNS: readonly string[] = [
  '\\bhave\\s+you\\s+{name}\\b',   // "have you ever"
  '\\bif\\s+you\\s+{name}\\b',     // "if you ever"
  '\\b{name}\\s+since\\b',         // "ever since"
  '\\b{name}\\s+again\\b',         // "ever again"
  '\\bnot\\s+{name}\\b',           // "not ever"
  '\\b{name}\\s+more\\b',          // "ever more"
  '\\bwould\\s+{name}\\b',         // "would ever"
  '\\bcould\\s+{name}\\b',         // "could ever"
  '\\bwill\\s+{name}\\b',          // "will ever"
  '(?:the\\s+)?{name}\\s+(?:of|in|at|for|to)\\b',  // "the grace of", "the mark of"
];

// ---------------------------------------------------------------------------
// Wikipedia lookup indicators
// ---------------------------------------------------------------------------

const NAME_INDICATOR_PHRASES: readonly string[] = [
  'given name', 'personal name', 'first name', 'forename',
  'masculine name', 'feminine name', "boy's name", "girl's name",
  'male name', 'female name', 'irish name', 'welsh name',
  'scottish name', 'gaelic name', 'hebrew name', 'arabic name',
  'norse name', 'old english name', 'is a name', 'as a name',
  'name meaning', 'name derived from', 'legendary irish',
  'legendary welsh', 'legendary scottish',
];

const PLACE_INDICATOR_PHRASES: readonly string[] = [
  'city in', 'town in', 'village in', 'municipality',
  'capital of', 'district of', 'county', 'province',
  'region of', 'island of', 'mountain in', 'river in',
];

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface PersonEntry {
  source: 'onboarding' | 'learned' | 'wiki';
  contexts: string[];
  aliases: string[];
  relationship: string;
  confidence: number;
  canonical?: string;
  seen_count?: number;
}

export interface LookupResult {
  type: 'person' | 'project' | 'concept' | 'unknown';
  confidence: number;
  source: string;
  name: string;
  context?: string[];
  needs_disambiguation: boolean;
  disambiguated_by?: string;
}

export interface WikiLookupResult {
  inferred_type: 'person' | 'place' | 'concept' | 'ambiguous' | 'unknown';
  confidence: number;
  wiki_summary: string | null;
  wiki_title?: string | null;
  note?: string;
  word?: string;
  confirmed?: boolean;
  confirmed_type?: string;
}

export interface LearnedEntity {
  type: string;
  confidence: number;
  name?: string;
}

// ---------------------------------------------------------------------------
// Zod schema for persisted JSON
// ---------------------------------------------------------------------------

const PersonEntrySchema = z.object({
  source: z.enum(['onboarding', 'learned', 'wiki']),
  contexts: z.array(z.string()),
  aliases: z.array(z.string()),
  relationship: z.string(),
  confidence: z.number(),
  canonical: z.string().optional(),
  seen_count: z.number().optional(),
});

const WikiCacheEntrySchema = z.object({
  inferred_type: z.enum(['person', 'place', 'concept', 'ambiguous', 'unknown']),
  confidence: z.number(),
  wiki_summary: z.string().nullable(),
  wiki_title: z.string().nullable().optional(),
  note: z.string().optional(),
  word: z.string().optional(),
  confirmed: z.boolean().optional(),
  confirmed_type: z.string().optional(),
});

const RegistryDataSchema = z.object({
  version: z.number(),
  mode: z.string(),
  people: z.record(z.string(), PersonEntrySchema),
  projects: z.array(z.string()),
  ambiguous_flags: z.array(z.string()),
  wiki_cache: z.record(z.string(), WikiCacheEntrySchema),
}).passthrough();

type RegistryData = z.infer<typeof RegistryDataSchema>;

// ---------------------------------------------------------------------------
// Wikipedia lookup
// ---------------------------------------------------------------------------

/**
 * Look up a word via Wikipedia REST API.
 * Returns inferred type (person/place/concept/unknown) + confidence + summary.
 * Free, no API key, handles disambiguation pages.
 */
async function wikipediaLookup(word: string): Promise<WikiLookupResult> {
  try {
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(word)}`;
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'MemPalace/1.0' },
      signal: AbortSignal.timeout(5000),
    });

    if (!resp.ok) {
      if (resp.status === 404) {
        // Not in Wikipedia — strong signal it's a proper noun (unusual name, nickname)
        return {
          inferred_type: 'person',
          confidence: 0.70,
          wiki_summary: null,
          wiki_title: null,
          note: 'not found in Wikipedia — likely a proper noun or unusual name',
        };
      }
      return { inferred_type: 'unknown', confidence: 0.0, wiki_summary: null };
    }

    const data = await resp.json() as Record<string, unknown>;
    const pageType = (data.type as string) ?? '';
    const extract = ((data.extract as string) ?? '').toLowerCase();
    const title = (data.title as string) ?? word;

    // Disambiguation — look at description
    if (pageType === 'disambiguation') {
      const desc = ((data.description as string) ?? '').toLowerCase();
      if (['name', 'given name'].some((p) => desc.includes(p))) {
        return {
          inferred_type: 'person',
          confidence: 0.65,
          wiki_summary: extract.slice(0, 200),
          wiki_title: title,
          note: 'disambiguation page with name entries',
        };
      }
      return {
        inferred_type: 'ambiguous',
        confidence: 0.4,
        wiki_summary: extract.slice(0, 200),
        wiki_title: title,
      };
    }

    // Check for name indicators
    if (NAME_INDICATOR_PHRASES.some((phrase) => extract.includes(phrase))) {
      const wordLower = word.toLowerCase();
      const confidence =
        extract.includes(`${wordLower} is a`) || extract.includes(`${wordLower} (name`)
          ? 0.90
          : 0.80;
      return {
        inferred_type: 'person',
        confidence,
        wiki_summary: extract.slice(0, 200),
        wiki_title: title,
      };
    }

    // Check for place indicators
    if (PLACE_INDICATOR_PHRASES.some((phrase) => extract.includes(phrase))) {
      return {
        inferred_type: 'place',
        confidence: 0.80,
        wiki_summary: extract.slice(0, 200),
        wiki_title: title,
      };
    }

    // Found but doesn't match name/place patterns
    return {
      inferred_type: 'concept',
      confidence: 0.60,
      wiki_summary: extract.slice(0, 200),
      wiki_title: title,
    };
  } catch {
    return { inferred_type: 'unknown', confidence: 0.0, wiki_summary: null };
  }
}

// ---------------------------------------------------------------------------
// Seed input interfaces
// ---------------------------------------------------------------------------

export interface SeedPerson {
  name: string;
  relationship?: string;
  context?: string;
}

// ---------------------------------------------------------------------------
// EntityRegistry
// ---------------------------------------------------------------------------

/**
 * Persistent personal entity registry.
 *
 * Stored at ~/.mempalace/entity_registry.json
 */
export class EntityRegistry {
  private static readonly DEFAULT_PATH = join(
    expandHome('~/.mempalace'),
    'entity_registry.json',
  );

  private _data: RegistryData;
  private readonly _path: string;

  private constructor(data: RegistryData, path: string) {
    this._data = data;
    this._path = path;
  }

  // -- Load / Save ----------------------------------------------------------

  static load(configDir?: string): EntityRegistry {
    const path = configDir
      ? join(configDir, 'entity_registry.json')
      : EntityRegistry.DEFAULT_PATH;

    if (existsSync(path)) {
      try {
        const raw = JSON.parse(readFileSync(path, 'utf-8')) as unknown;
        const data = RegistryDataSchema.parse(raw);
        return new EntityRegistry(data, path);
      } catch {
        // Corrupted or invalid — start fresh
      }
    }
    return new EntityRegistry(EntityRegistry.empty(), path);
  }

  save(): void {
    const dir = dirname(this._path);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(this._path, JSON.stringify(this._data, null, 2));
  }

  private static empty(): RegistryData {
    return {
      version: 1,
      mode: 'personal',
      people: {},
      projects: [],
      ambiguous_flags: [],
      wiki_cache: {},
    };
  }

  // -- Properties -----------------------------------------------------------

  get mode(): string {
    return this._data.mode ?? 'personal';
  }

  get people(): Record<string, PersonEntry> {
    return this._data.people ?? {};
  }

  get projects(): string[] {
    return this._data.projects ?? [];
  }

  get ambiguousFlags(): string[] {
    return this._data.ambiguous_flags ?? [];
  }

  // -- Seed from onboarding -------------------------------------------------

  seed(
    mode: string,
    people: SeedPerson[],
    projects: string[],
    aliases?: Record<string, string>,
  ): void {
    this._data.mode = mode;
    this._data.projects = [...projects];

    const resolvedAliases = aliases ?? {};
    // Reverse: canonical → alias (e.g. Maxwell → Max)
    const reverseAliases: Record<string, string> = {};
    for (const [alias, canonical] of Object.entries(resolvedAliases)) {
      reverseAliases[canonical] = alias;
    }

    for (const entry of people) {
      const name = entry.name.trim();
      if (!name) continue;
      const ctx = entry.context ?? 'personal';
      const relationship = entry.relationship ?? '';

      this._data.people[name] = {
        source: 'onboarding',
        contexts: [ctx],
        aliases: reverseAliases[name] ? [reverseAliases[name]] : [],
        relationship,
        confidence: 1.0,
      };

      // Also register aliases
      if (reverseAliases[name]) {
        const alias = reverseAliases[name];
        this._data.people[alias] = {
          source: 'onboarding',
          contexts: [ctx],
          aliases: [name],
          relationship,
          confidence: 1.0,
          canonical: name,
        };
      }
    }

    // Flag ambiguous names (also common English words)
    const ambiguous: string[] = [];
    for (const name of Object.keys(this._data.people)) {
      if (COMMON_ENGLISH_WORDS.has(name.toLowerCase())) {
        ambiguous.push(name.toLowerCase());
      }
    }
    this._data.ambiguous_flags = ambiguous;

    this.save();
  }

  // -- Lookup ---------------------------------------------------------------

  lookup(word: string, context: string = ''): LookupResult {
    // 1. Exact match in people registry
    for (const [canonical, info] of Object.entries(this.people)) {
      const aliases = info.aliases ?? [];
      if (
        word.toLowerCase() === canonical.toLowerCase() ||
        aliases.some((a) => a.toLowerCase() === word.toLowerCase())
      ) {
        // Check if this is an ambiguous word
        if (this.ambiguousFlags.includes(word.toLowerCase()) && context) {
          const resolved = this.disambiguate(word, context, info);
          if (resolved !== null) {
            return resolved;
          }
        }
        return {
          type: 'person',
          confidence: info.confidence,
          source: info.source,
          name: canonical,
          context: info.contexts ?? ['personal'],
          needs_disambiguation: false,
        };
      }
    }

    // 2. Project match
    for (const proj of this.projects) {
      if (word.toLowerCase() === proj.toLowerCase()) {
        return {
          type: 'project',
          confidence: 1.0,
          source: 'onboarding',
          name: proj,
          needs_disambiguation: false,
        };
      }
    }

    // 3. Wiki cache
    const cache = this._data.wiki_cache ?? {};
    for (const [cachedWord, cachedResult] of Object.entries(cache)) {
      if (word.toLowerCase() === cachedWord.toLowerCase() && cachedResult.confirmed) {
        return {
          type: cachedResult.inferred_type as LookupResult['type'],
          confidence: cachedResult.confidence,
          source: 'wiki',
          name: word,
          needs_disambiguation: false,
        };
      }
    }

    return {
      type: 'unknown',
      confidence: 0.0,
      source: 'none',
      name: word,
      needs_disambiguation: false,
    };
  }

  /**
   * When a word is both a name and a common word, check context.
   * Returns person result if context suggests a name, concept if not, null if ambiguous.
   */
  disambiguate(word: string, context: string, personInfo: PersonEntry): LookupResult | null {
    const nameLower = word.toLowerCase();
    const ctxLower = context.toLowerCase();
    const escaped = escapeRegExp(nameLower);

    // Check person context patterns
    let personScore = 0;
    for (const pat of PERSON_CONTEXT_PATTERNS) {
      const re = new RegExp(pat.replace('{name}', escaped), 'i');
      if (re.test(ctxLower)) {
        personScore += 1;
      }
    }

    // Check concept context patterns
    let conceptScore = 0;
    for (const pat of CONCEPT_CONTEXT_PATTERNS) {
      const re = new RegExp(pat.replace('{name}', escaped), 'i');
      if (re.test(ctxLower)) {
        conceptScore += 1;
      }
    }

    if (personScore > conceptScore) {
      return {
        type: 'person',
        confidence: Math.min(0.95, 0.7 + personScore * 0.1),
        source: personInfo.source,
        name: word,
        context: personInfo.contexts ?? ['personal'],
        needs_disambiguation: false,
        disambiguated_by: 'context_patterns',
      };
    } else if (conceptScore > personScore) {
      return {
        type: 'concept',
        confidence: Math.min(0.90, 0.7 + conceptScore * 0.1),
        source: 'context_disambiguated',
        name: word,
        needs_disambiguation: false,
        disambiguated_by: 'context_patterns',
      };
    }

    // Truly ambiguous — return null to fall through to person (registered name)
    return null;
  }

  // -- Research unknown words -----------------------------------------------

  async research(word: string, autoConfirm: boolean = false): Promise<WikiLookupResult> {
    // Already cached?
    if (!this._data.wiki_cache) {
      this._data.wiki_cache = {};
    }
    const cache = this._data.wiki_cache;
    if (cache[word]) {
      return cache[word];
    }

    const result = await wikipediaLookup(word);
    const entry: WikiLookupResult = {
      ...result,
      word,
      confirmed: autoConfirm,
    };

    cache[word] = entry;
    this.save();
    return entry;
  }

  confirmResearch(
    word: string,
    entityType: string,
    relationship: string = '',
    context: string = 'personal',
  ): void {
    const cache = this._data.wiki_cache ?? {};
    if (cache[word]) {
      cache[word].confirmed = true;
      cache[word].confirmed_type = entityType;
    }

    if (entityType === 'person') {
      this._data.people[word] = {
        source: 'wiki',
        contexts: [context],
        aliases: [],
        relationship,
        confidence: 0.90,
      };
      if (COMMON_ENGLISH_WORDS.has(word.toLowerCase())) {
        if (!this._data.ambiguous_flags) {
          this._data.ambiguous_flags = [];
        }
        if (!this._data.ambiguous_flags.includes(word.toLowerCase())) {
          this._data.ambiguous_flags.push(word.toLowerCase());
        }
      }
    }

    this.save();
  }

  // -- Learn from sessions --------------------------------------------------

  /**
   * Scan session text for new entity candidates.
   * Returns list of newly discovered candidates for review.
   *
   * NOTE: This method requires extractCandidates, scoreEntity, and classifyEntity
   * functions which are not yet ported to TypeScript. It will throw if called
   * until those functions are available.
   */
  learnFromText(_text: string, _minConfidence: number = 0.75): LearnedEntity[] {
    // The Python version imports from entity_detector:
    //   from mempalace.entity_detector import extract_candidates, score_entity, classify_entity
    // These functions are not yet available in the TS entity-detector module.
    // When they are ported, this method should be updated.
    throw new Error(
      'learnFromText is not yet implemented: requires extractCandidates, scoreEntity, ' +
      'and classifyEntity to be ported from entity_detector.py',
    );
  }

  // -- Query helpers for retrieval ------------------------------------------

  extractPeopleFromQuery(query: string): string[] {
    const found: string[] = [];

    for (const [canonical, info] of Object.entries(this.people)) {
      const namesToCheck = [canonical, ...(info.aliases ?? [])];
      for (const name of namesToCheck) {
        const re = new RegExp(`\\b${escapeRegExp(name)}\\b`, 'i');
        if (re.test(query)) {
          // For ambiguous words, check context
          if (this.ambiguousFlags.includes(name.toLowerCase())) {
            const result = this.disambiguate(name, query, info);
            if (result && result.type === 'person') {
              if (!found.includes(canonical)) {
                found.push(canonical);
              }
            }
          } else {
            if (!found.includes(canonical)) {
              found.push(canonical);
            }
          }
        }
      }
    }

    return found;
  }

  extractUnknownCandidates(query: string): string[] {
    const matches = query.match(/\b[A-Z][a-z]{2,15}\b/g) ?? [];
    const unique = [...new Set(matches)];
    const unknown: string[] = [];

    for (const word of unique) {
      if (COMMON_ENGLISH_WORDS.has(word.toLowerCase())) continue;
      const result = this.lookup(word);
      if (result.type === 'unknown') {
        unknown.push(word);
      }
    }

    return unknown;
  }

  // -- Summary --------------------------------------------------------------

  summary(): string {
    const peopleKeys = Object.keys(this.people);
    const peopleSample = peopleKeys.slice(0, 8).join(', ');
    const ellipsis = peopleKeys.length > 8 ? '...' : '';

    const lines = [
      `Mode: ${this.mode}`,
      `People: ${peopleKeys.length} (${peopleSample}${ellipsis})`,
      `Projects: ${this.projects.join(', ') || '(none)'}`,
      `Ambiguous flags: ${this.ambiguousFlags.join(', ') || '(none)'}`,
      `Wiki cache: ${Object.keys(this._data.wiki_cache ?? {}).length} entries`,
    ];
    return lines.join('\n');
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Escape special regex characters in a string. */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
