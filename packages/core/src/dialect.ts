/**
 * @module dialect
 * AAAK (Abbreviated Associative Archival Kernel) compression dialect.
 *
 * 1:1 PORT from original dialect.py
 *
 * Maps directly to:
 *   Python class: Dialect
 *   Python file:  dialect.py
 *
 * AAAK achieves ~30x lossless compression for memory storage.
 * It converts verbose natural language into a compact notation using:
 *   - Entity codes: 3-letter uppercase codes for people/projects (e.g., Alice → ALC)
 *   - Emotion codes: Short codes for emotional states (e.g., vulnerability → vul)
 *   - Flag signals: Markers for content type (ORIGIN, CORE, SENSITIVE, PIVOT, etc.)
 *   - Structural compression: Remove filler words, use symbols for common patterns
 *
 * Format structure:
 *   HEADER: FILE_NUM|PRIMARY_ENTITY|DATE|TITLE
 *   ZETTEL: ZID:ENTITIES|topic_keywords|"key_quote"|WEIGHT|EMOTIONS|FLAGS
 *   TUNNEL: T:ZID<->ZID|label
 *   ARC: ARC:emotion->emotion->emotion
 */

import type { EmotionCode, AAAKFlag, CompressionStats, EntityMap } from './types.js';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolvePath } from './utils/paths.js';

// ---------------------------------------------------------------------------
// Emotion Codes — 1:1 PORT from dialect.py EMOTION_CODES
// ---------------------------------------------------------------------------

/**
 * Full emotion code mapping.
 * Python: dialect.py — EMOTION_CODES dict
 */
export const EMOTION_CODES: Record<EmotionCode, string> = {
  vul: 'vulnerability',
  joy: 'joy',
  fear: 'fear',
  trust: 'trust',
  grief: 'grief',
  wonder: 'wonder',
  rage: 'rage',
  love: 'love',
  hope: 'hope',
  despair: 'despair',
  peace: 'peace',
  relief: 'relief',
  humor: 'humor',
  tender: 'tenderness',
  raw: 'raw_honesty',
  doubt: 'self_doubt',
  anx: 'anxiety',
  exhaust: 'exhaustion',
  convict: 'conviction',
  passion: 'quiet_passion',
  warmth: 'warmth',
  curious: 'curiosity',
  grat: 'gratitude',
  frust: 'frustration',
  confuse: 'confusion',
  satis: 'satisfaction',
  excite: 'excitement',
  determ: 'determination',
  surprise: 'surprise',
};

/**
 * Reverse lookup: emotion word → code.
 * Python: dialect.py — built dynamically from EMOTION_CODES
 */
const EMOTION_REVERSE: Record<string, EmotionCode> = {};
for (const [code, name] of Object.entries(EMOTION_CODES)) {
  EMOTION_REVERSE[name] = code as EmotionCode;
}

// ---------------------------------------------------------------------------
// Emotion Signal Detection — 1:1 PORT from dialect.py
// ---------------------------------------------------------------------------

/**
 * Word → emotion code mapping for auto-detection in text.
 * Python: dialect.py — EMOTION_SIGNALS
 */
const EMOTION_SIGNALS: Record<string, EmotionCode> = {
  decided: 'determ',
  prefer: 'convict',
  worried: 'anx',
  excited: 'excite',
  frustrated: 'frust',
  confused: 'confuse',
  love: 'love',
  hate: 'rage',
  hope: 'hope',
  fear: 'fear',
  trust: 'trust',
  happy: 'joy',
  sad: 'grief',
  surprised: 'surprise',
  grateful: 'grat',
  curious: 'curious',
  wonder: 'wonder',
  anxious: 'anx',
  relieved: 'relief',
  satisfied: 'satis',
  disappointed: 'grief',
  concerned: 'anx',
  vulnerable: 'vul',
  peaceful: 'peace',
  exhausted: 'exhaust',
  tender: 'tender',
  passionate: 'passion',
  warm: 'warmth',
  doubtful: 'doubt',
  hopeless: 'despair',
  angry: 'rage',
  funny: 'humor',
  raw: 'raw',
};

// ---------------------------------------------------------------------------
// Flag Signal Detection — 1:1 PORT from dialect.py
// ---------------------------------------------------------------------------

/**
 * Flag keywords for auto-detection.
 * Python: dialect.py — FLAG_SIGNALS
 */
const FLAG_KEYWORDS: Record<AAAKFlag, string[]> = {
  ORIGIN: ['founded', 'created', 'started', 'born', 'launched', 'first time', 'beginning'],
  CORE: ['core', 'fundamental', 'essential', 'principle', 'belief', 'always', 'never forget'],
  SENSITIVE: [], // Manually marked only
  PIVOT: ['turning point', 'changed everything', 'realized', 'breakthrough', 'epiphany'],
  GENESIS: ['led to', 'resulted in', 'because of this', 'which became'],
  DECISION: ['decided', 'chose', 'switched', 'migrated', 'replaced', 'instead of', 'because'],
  TECHNICAL: [
    'api', 'database', 'architecture', 'deploy', 'infrastructure',
    'algorithm', 'framework', 'server', 'config', 'schema',
  ],
};

// ---------------------------------------------------------------------------
// Filler words to strip during compression
// ---------------------------------------------------------------------------

export const FILLER_WORDS: ReadonlySet<string> = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'must', 'need', 'dare',
  'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as',
  'into', 'through', 'during', 'before', 'after', 'above', 'below',
  'between', 'out', 'off', 'over', 'under', 'again', 'further', 'then',
  'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each',
  'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no',
  'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just',
  'about', 'also', 'and', 'but', 'or', 'if', 'while', 'although',
  'because', 'until', 'that', 'which', 'who', 'whom', 'this', 'these',
  'those', 'it', 'its', 'they', 'them', 'their', 'we', 'us', 'our',
  'you', 'your', 'he', 'him', 'his', 'she', 'her', 'i', 'me', 'my',
  'really', 'actually', 'basically', 'essentially', 'literally', 'honestly',
  'obviously', 'clearly', 'simply', 'perhaps', 'maybe', 'probably',
  'definitely', 'certainly', 'anyway', 'however', 'therefore', 'thus',
  'hence', 'yet', 'still', 'already', 'even', 'much', 'well', 'quite',
]);

/**
 * AAAK Compression Dialect.
 *
 * 1:1 PORT from dialect.py Dialect class.
 *
 * Python: class Dialect:
 *   def __init__(self, entities=None, skip_names=None)
 *   def encode_entity(name) -> Optional[str]
 *   def encode_emotions(emotions) -> str
 *   def get_flags(zettel) -> str
 *   def compress(text, metadata=None) -> str
 *   def compression_stats(original, compressed) -> dict
 *   def count_tokens(text) -> int
 *   def compress_file(json_path) -> str
 *   def generate_layer1(input_dir, output="LAYER1.aaak")
 *   def save_config(config_path)
 *   @classmethod from_config(config_path) -> Dialect
 */
export class Dialect {
  /** Entity name → 3-letter code mapping. Python: self.entities */
  private entities: EntityMap;
  /** Names to skip during entity detection. Python: self.skip_names */
  private skipNames: Set<string>;

  /**
   * Python: Dialect.__init__(self, entities=None, skip_names=None)
   * TS: new Dialect(entities, skipNames)
   *
   * @param entities - Entity name → code mapping (e.g., {"Alice": "ALC"})
   * @param skipNames - Names to skip during auto-encoding
   */
  constructor(entities: EntityMap = {}, skipNames: string[] = []) {
    this.entities = { ...entities };
    this.skipNames = new Set(skipNames.map((n) => n.toLowerCase()));
  }

  /**
   * Create a Dialect instance from a config file.
   *
   * Python: @classmethod Dialect.from_config(cls, config_path) -> Dialect
   * TS: Dialect.fromConfig(configPath) -> Dialect
   *
   * @param configPath - Path to a JSON config file with entities and skip_names
   */
  static fromConfig(configPath: string): Dialect {
    const resolved = resolvePath(configPath);
    if (!existsSync(resolved)) return new Dialect();

    const data = JSON.parse(readFileSync(resolved, 'utf-8')) as {
      entities?: EntityMap;
      skip_names?: string[];
    };

    return new Dialect(data.entities ?? {}, data.skip_names ?? []);
  }

  /**
   * Encode a name to its 3-letter entity code.
   *
   * Python: Dialect.encode_entity(self, name) -> Optional[str]
   * TS: this.encodeEntity(name) -> string | null
   *
   * If no mapping exists, auto-generates one from the first 3 characters (uppercase).
   *
   * @param name - Entity name (e.g., "Alice")
   * @returns 3-letter code (e.g., "ALC") or null if skipped
   */
  encodeEntity(name: string): string | null {
    if (this.skipNames.has(name.toLowerCase())) return null;

    // Python: Check existing mapping (case-insensitive)
    const key = Object.keys(this.entities).find(
      (k) => k.toLowerCase() === name.toLowerCase(),
    );
    if (key) return this.entities[key];

    // Python: Auto-generate from first 3 chars
    const code = name.slice(0, 3).toUpperCase();
    this.entities[name] = code;
    return code;
  }

  /**
   * Encode a list of emotions to their short codes.
   *
   * Python: Dialect.encode_emotions(self, emotions) -> str
   * TS: this.encodeEmotions(emotions) -> string
   *
   * @param emotions - Array of emotion names or codes
   * @returns Comma-separated emotion codes (e.g., "vul,joy,trust")
   */
  encodeEmotions(emotions: string[]): string {
    return emotions
      .map((e) => {
        const lower = e.toLowerCase();
        // Already a code?
        if (lower in EMOTION_CODES) return lower;
        // Reverse lookup
        return EMOTION_REVERSE[lower] ?? lower;
      })
      .join(',');
  }

  /**
   * Detect emotions in text content.
   *
   * Python: Part of Dialect.compress() — emotion signal detection
   * TS: this.detectEmotions(text) -> EmotionCode[]
   *
   * @param text - Text to scan for emotional signals
   * @returns Array of detected emotion codes
   */
  detectEmotions(text: string): EmotionCode[] {
    const lower = text.toLowerCase();
    const detected = new Set<EmotionCode>();

    for (const [word, code] of Object.entries(EMOTION_SIGNALS)) {
      if (lower.includes(word)) {
        detected.add(code);
      }
    }

    return [...detected];
  }

  /**
   * Detect AAAK flags from text content.
   *
   * Python: Dialect.get_flags(self, zettel) -> str
   * TS: this.getFlags(text) -> AAAKFlag[]
   *
   * @param text - Text to scan for flag signals
   * @returns Array of detected flags
   */
  getFlags(text: string): AAAKFlag[] {
    const lower = text.toLowerCase();
    const flags: AAAKFlag[] = [];

    for (const [flag, keywords] of Object.entries(FLAG_KEYWORDS) as Array<
      [AAAKFlag, string[]]
    >) {
      if (keywords.length === 0) continue; // Skip SENSITIVE (manual only)
      for (const kw of keywords) {
        if (lower.includes(kw)) {
          flags.push(flag);
          break;
        }
      }
    }

    return flags;
  }

  /**
   * Compress text to AAAK format.
   *
   * Python: Dialect.compress(self, text, metadata=None) -> str
   * TS: this.compress(text, metadata) -> string
   *
   * Compression pipeline:
   *   1. Replace entity names with 3-letter codes
   *   2. Strip filler words
   *   3. Detect and append emotion codes
   *   4. Detect and append flags
   *   5. Compact whitespace and punctuation
   *
   * @param text - Text to compress
   * @param metadata - Optional metadata for context
   * @returns AAAK-compressed text
   */
  compress(text: string, metadata?: Record<string, string>): string {
    let compressed = text;

    // Step 1: Replace entity names with codes
    // Python: Replace all entity names with their codes
    for (const [name, code] of Object.entries(this.entities)) {
      const regex = new RegExp(`\\b${escapeRegExp(name)}\\b`, 'gi');
      compressed = compressed.replace(regex, code);
    }

    // Step 2: Strip filler words (preserve sentence structure)
    const words = compressed.split(/\s+/);
    const filtered = words.filter((w) => {
      const lower = w.toLowerCase().replace(/[.,!?;:'"()]/g, '');
      return !FILLER_WORDS.has(lower) || w.length <= 1;
    });
    compressed = filtered.join(' ');

    // Step 3: Detect emotions
    const emotions = this.detectEmotions(text);
    const emotionStr = emotions.length > 0 ? `|${this.encodeEmotions(emotions)}` : '';

    // Step 4: Detect flags
    const flags = this.getFlags(text);
    const flagStr = flags.length > 0 ? `|${flags.join(',')}` : '';

    // Step 5: Compact whitespace
    compressed = compressed.replace(/\s+/g, ' ').trim();

    // Step 6: Add metadata header if available
    const wing = metadata?.wing ?? '';
    const room = metadata?.room ?? '';
    const header = wing || room ? `[${wing}/${room}] ` : '';

    return `${header}${compressed}${emotionStr}${flagStr}`;
  }

  /**
   * Get compression statistics.
   *
   * Python: Dialect.compression_stats(self, original, compressed) -> dict
   * TS: this.compressionStats(original, compressed) -> CompressionStats
   *
   * @param original - Original text
   * @param compressed - Compressed AAAK text
   * @returns Compression ratio and savings
   */
  compressionStats(original: string, compressed: string): CompressionStats {
    const origTokens = Dialect.countTokens(original);
    const compTokens = Dialect.countTokens(compressed);
    const ratio = origTokens > 0 ? origTokens / compTokens : 0;
    const savings = origTokens > 0 ? ((origTokens - compTokens) / origTokens) * 100 : 0;

    return {
      original_tokens: origTokens,
      compressed_tokens: compTokens,
      ratio: Math.round(ratio * 10) / 10,
      savings_percent: Math.round(savings * 10) / 10,
    };
  }

  /**
   * Estimate token count (rough: ~4 chars per token).
   *
   * Python: Dialect.count_tokens(text) -> int (static method)
   * TS: Dialect.countTokens(text) -> number
   *
   * @param text - Text to estimate tokens for
   * @returns Estimated token count
   */
  static countTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Save entity configuration to a JSON file.
   *
   * Python: Dialect.save_config(self, config_path)
   * TS: this.saveConfig(configPath)
   *
   * @param configPath - Path to write config file
   */
  saveConfig(configPath: string): void {
    const resolved = resolvePath(configPath);
    const data = {
      entities: this.entities,
      skip_names: [...this.skipNames],
    };
    writeFileSync(resolved, JSON.stringify(data, null, 2), 'utf-8');
  }

  /**
   * Get the current entity map.
   */
  getEntities(): EntityMap {
    return { ...this.entities };
  }
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
