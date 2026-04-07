/**
 * @module entity-detector
 * Auto-detect people and projects from text content.
 * Also includes the general 5-type memory extractor.
 *
 * 1:1 PORT from original entity_detector.py + general_extractor.py
 *
 * Maps directly to:
 *   Python: entity_detector.py — scan_for_detection(), detect_entities(), confirm_entities()
 *   Python: general_extractor.py — extract_memories()
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import type { DetectedEntity, DetectionResult, ExtractedMemory, MemoryType } from './types.js';
import { READABLE_EXTENSIONS, SKIP_DIRS } from './types.js';
import { FILLER_WORDS } from './dialect.js';

// ---------------------------------------------------------------------------
// Person Detection Patterns — 1:1 PORT from entity_detector.py
// ---------------------------------------------------------------------------

/**
 * Verbs that signal a person is being mentioned.
 * Python: entity_detector.py PERSON_VERB_PATTERNS
 */
const PERSON_VERBS = [
  'said', 'asked', 'told', 'replied', 'laughed', 'smiled', 'cried',
  'felt', 'thinks', 'wants', 'loves', 'hates', 'knows', 'decided',
  'mentioned',
];

/**
 * Context patterns for person detection.
 * Python: entity_detector.py PERSON_CONTEXT_PATTERNS
 */
const PERSON_CONTEXTS = [
  /\b(\w+)\s+said\b/gi,
  /\b(\w+)\s+asked\b/gi,
  /\b(\w+)\s+told\b/gi,
  /\b(\w+)\s+replied\b/gi,
  /\bwith\s+(\w+)\b/gi,
  /\b(\w+)'s\s/gi,
  /\b(\w+)\s+laughed\b/gi,
  /\b(\w+)\s+smiled\b/gi,
  /\b(\w+)\s+thinks\b/gi,
  /\b(\w+)\s+wants\b/gi,
  /\b(\w+)\s+loves\b/gi,
  /\b(\w+)\s+decided\b/gi,
  /\b(\w+)\s+mentioned\b/gi,
];

/**
 * Project detection patterns.
 * Python: entity_detector.py PROJECT_VERB_PATTERNS
 */
const PROJECT_PATTERNS = [
  /building\s+(\w+)/gi,
  /shipped\s+(\w+)/gi,
  /the\s+(\w+)\s+architecture/gi,
  /(\w+)\s+v\d/gi,
  /import\s+(\w+)/gi,
  /pip\s+install\s+(\w+)/gi,
  /npm\s+install\s+(\w+)/gi,
  /the\s+(\w+)\s+project/gi,
  /working\s+on\s+(\w+)/gi,
];

/**
 * Common English words that should not be detected as entities.
 * Built from FILLER_WORDS (dialect.ts) plus entity-detection-specific extras.
 * Python: entity_detector.py — STOPWORDS (subset)
 */
const ENTITY_EXTRA_STOPWORDS = [
  'yes', 'what', 'who', 'whom', 'how',
  'many', 'few', 'less', 'least', 'another',
  'new', 'old', 'good', 'bad', 'big', 'small', 'long', 'short',
  'first', 'last', 'next', 'now', 'up', 'down',
  'ever', 'grace', 'will', 'may', 'june', 'joy', 'hope',
  'said', 'asked', 'told', 'like', 'get', 'got', 'make', 'made',
  'think', 'know', 'want', 'see', 'look', 'find', 'give', 'tell',
  'work', 'call', 'try', 'come', 'go', 'take', 'let', 'keep',
  'back', 'way',
] as const;
const STOPWORDS: ReadonlySet<string> = new Set([...FILLER_WORDS, ...ENTITY_EXTRA_STOPWORDS]);

/**
 * Check if a word looks like a proper name (capitalized, not a stopword).
 */
function isLikelyName(word: string): boolean {
  if (word.length < 2 || word.length > 20) return false;
  if (STOPWORDS.has(word.toLowerCase())) return false;
  if (!/^[A-Z][a-z]+$/.test(word)) return false;
  return true;
}

/**
 * Scan files for entity detection.
 *
 * Python: entity_detector.py scan_for_detection(project_dir, limit=100) -> list[Path]
 * TS: scanForDetection(projectDir, limit) -> string[]
 */
export function scanForDetection(projectDir: string, limit: number = 100): string[] {
  const files: string[] = [];

  function walk(dir: string): void {
    if (files.length >= limit) return;
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (files.length >= limit) return;
        const fullPath = join(dir, entry.name);

        if (entry.isDirectory()) {
          if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
          walk(fullPath);
        } else if (entry.isFile()) {
          const ext = extname(entry.name).toLowerCase();
          if (READABLE_EXTENSIONS.has(ext)) {
            files.push(fullPath);
          }
        }
      }
    } catch {
      // Permission errors, etc.
    }
  }

  walk(projectDir);
  return files;
}

/**
 * Detect entities (people and projects) from file content.
 *
 * Python: entity_detector.py detect_entities(file_paths) -> dict
 * TS: detectEntities(filePaths) -> DetectionResult
 *
 * @param filePaths - Array of file paths to scan
 * @returns Detection result with people, projects, and uncertain entities
 */
export function detectEntities(filePaths: string[]): DetectionResult {
  const personCounts = new Map<string, number>();
  const projectCounts = new Map<string, number>();

  for (const filepath of filePaths) {
    let content: string;
    try {
      content = readFileSync(filepath, 'utf-8');
    } catch {
      continue;
    }

    // Python: Detect people using context patterns
    for (const pattern of PERSON_CONTEXTS) {
      // Reset lastIndex for global patterns
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const name = match[1];
        if (isLikelyName(name)) {
          personCounts.set(name, (personCounts.get(name) ?? 0) + 1);
        }
      }
    }

    // Python: Detect projects using project patterns
    for (const pattern of PROJECT_PATTERNS) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const name = match[1];
        if (name.length >= 3 && !STOPWORDS.has(name.toLowerCase())) {
          projectCounts.set(name, (projectCounts.get(name) ?? 0) + 1);
        }
      }
    }
  }

  // Python: Classify by confidence
  const people: DetectedEntity[] = [];
  const projects: DetectedEntity[] = [];
  const uncertain: DetectedEntity[] = [];

  for (const [name, count] of personCounts) {
    const confidence = Math.min(count / 10, 1.0);
    const entity: DetectedEntity = {
      name,
      confidence,
      signal_count: count,
      source: 'detected',
    };

    if (confidence >= 0.5) {
      people.push(entity);
    } else {
      uncertain.push(entity);
    }
  }

  for (const [name, count] of projectCounts) {
    // Skip if already classified as a person
    if (personCounts.has(name) && (personCounts.get(name) ?? 0) > count) continue;

    const confidence = Math.min(count / 5, 1.0);
    const entity: DetectedEntity = {
      name,
      confidence,
      signal_count: count,
      source: 'detected',
    };

    if (confidence >= 0.3) {
      projects.push(entity);
    } else {
      uncertain.push(entity);
    }
  }

  // Sort by signal count descending
  people.sort((a, b) => b.signal_count - a.signal_count);
  projects.sort((a, b) => b.signal_count - a.signal_count);
  uncertain.sort((a, b) => b.signal_count - a.signal_count);

  return { people, projects, uncertain };
}

// ---------------------------------------------------------------------------
// General Memory Extractor — 1:1 PORT from general_extractor.py
// ---------------------------------------------------------------------------

/**
 * Memory type keyword patterns.
 * Python: general_extractor.py — keyword patterns for each memory type
 */
const MEMORY_TYPE_PATTERNS: Record<MemoryType, string[]> = {
  decision: [
    "let's use", 'we decided', 'decided to', 'instead of', 'trade-off',
    'architecture', 'chose', 'switched', 'migrated', 'replaced',
    'went with', 'opted for', 'committed to', 'locked in',
  ],
  preference: [
    'i prefer', 'always use', 'never use', "don't like", 'my rule is',
    'i like', 'my style', 'i always', 'i never', 'habit',
  ],
  milestone: [
    'it works', 'got it working', 'fixed', 'breakthrough', 'figured out',
    'finally', 'shipped', 'deployed', 'launched', 'completed',
    'achieved', 'done', 'success',
  ],
  problem: [
    'broken', 'failed', 'crash', 'stuck', 'workaround', 'fix',
    'issue', 'bug', 'regression', 'blocker', 'incident',
    'error', 'exception', 'timeout',
  ],
  emotional: [
    'feel', 'feeling', 'felt', 'scared', 'happy', 'sad', 'angry',
    'frustrated', 'excited', 'worried', 'grateful', 'love',
    'hate', 'miss', 'proud', 'ashamed', 'vulnerable',
  ],
};

/**
 * Extract 5-type memories from text content.
 *
 * Python: general_extractor.py extract_memories(text) -> list
 * TS: extractMemories(text) -> ExtractedMemory[]
 *
 * Memory types:
 *   1. decisions — trade-offs, architecture choices
 *   2. preferences — habits, rules, likes/dislikes
 *   3. milestones — breakthroughs, completions
 *   4. problems — bugs, crashes, blockers
 *   5. emotional — feelings, vulnerability
 *
 * @param text - Text to extract memories from
 * @returns Array of extracted memories with type classification
 */
export function extractMemories(text: string): ExtractedMemory[] {
  const memories: ExtractedMemory[] = [];
  const sentences = text.split(/[.!?\n]+/).filter((s) => s.trim().length > 20);

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i].trim();
    const lower = sentence.toLowerCase();

    for (const [type, patterns] of Object.entries(MEMORY_TYPE_PATTERNS) as Array<
      [MemoryType, string[]]
    >) {
      for (const pattern of patterns) {
        if (lower.includes(pattern)) {
          memories.push({
            content: sentence,
            memory_type: type,
            chunk_index: i,
          });
          break; // Only classify once per type per sentence
        }
      }
    }
  }

  return memories;
}
