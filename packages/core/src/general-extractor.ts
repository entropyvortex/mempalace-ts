/**
 * @module general-extractor
 * Extract 5 types of memories from text.
 *
 * 1:1 PORT from original general_extractor.py
 *
 * Types:
 *   1. DECISIONS    — "we went with X because Y", choices made
 *   2. PREFERENCES  — "always use X", "never do Y", "I prefer Z"
 *   3. MILESTONES   — breakthroughs, things that finally worked
 *   4. PROBLEMS     — what broke, what fixed it, root causes
 *   5. EMOTIONAL    — feelings, vulnerability, relationships
 *
 * No LLM required. Pure keyword/pattern heuristics.
 */

import type { MemoryType, ExtractedMemory } from './types.js';

// =============================================================================
// MARKER SETS — One per memory type
// Python: general_extractor.py marker lists
// =============================================================================

const DECISION_MARKERS = [
  /\blet'?s (use|go with|try|pick|choose|switch to)\b/i,
  /\bwe (should|decided|chose|went with|picked|settled on)\b/i,
  /\bi'?m going (to|with)\b/i,
  /\bbetter (to|than|approach|option|choice)\b/i,
  /\binstead of\b/i,
  /\brather than\b/i,
  /\bthe reason (is|was|being)\b/i,
  /\bbecause\b/i,
  /\btrade-?off\b/i,
  /\bpros and cons\b/i,
  /\bover\b.*\bbecause\b/i,
  /\barchitecture\b/i,
  /\bapproach\b/i,
  /\bstrategy\b/i,
  /\bpattern\b/i,
  /\bstack\b/i,
  /\bframework\b/i,
  /\binfrastructure\b/i,
  /\bset (it |this )?to\b/i,
  /\bconfigure\b/i,
  /\bdefault\b/i,
];

const PREFERENCE_MARKERS = [
  /\bi prefer\b/i,
  /\balways use\b/i,
  /\bnever use\b/i,
  /\bdon'?t (ever |like to )?(use|do|mock|stub|import)\b/i,
  /\bi like (to|when|how)\b/i,
  /\bi hate (when|how|it when)\b/i,
  /\bplease (always|never|don'?t)\b/i,
  /\bmy (rule|preference|style|convention) is\b/i,
  /\bwe (always|never)\b/i,
  /\bfunctional\b.*\bstyle\b/i,
  /\bimperative\b/i,
  /\bsnake_?case\b/i,
  /\bcamel_?case\b/i,
  /\btabs\b.*\bspaces\b/i,
  /\bspaces\b.*\btabs\b/i,
  /\buse\b.*\binstead of\b/i,
];

const MILESTONE_MARKERS = [
  /\bit works\b/i,
  /\bit worked\b/i,
  /\bgot it working\b/i,
  /\bfixed\b/i,
  /\bsolved\b/i,
  /\bbreakthrough\b/i,
  /\bfigured (it )?out\b/i,
  /\bnailed it\b/i,
  /\bcracked (it|the)\b/i,
  /\bfinally\b/i,
  /\bfirst time\b/i,
  /\bfirst ever\b/i,
  /\bnever (done|been|had) before\b/i,
  /\bdiscovered\b/i,
  /\brealized\b/i,
  /\bfound (out|that)\b/i,
  /\bturns out\b/i,
  /\bthe key (is|was|insight)\b/i,
  /\bthe trick (is|was)\b/i,
  /\bnow i (understand|see|get it)\b/i,
  /\bbuilt\b/i,
  /\bcreated\b/i,
  /\bimplemented\b/i,
  /\bshipped\b/i,
  /\blaunched\b/i,
  /\bdeployed\b/i,
  /\breleased\b/i,
  /\bprototype\b/i,
  /\bproof of concept\b/i,
  /\bdemo\b/i,
  /\bversion \d/i,
  /\bv\d+\.\d+/i,
  /\d+x (compression|faster|slower|better|improvement|reduction)/i,
  /\d+% (reduction|improvement|faster|better|smaller)/i,
];

const PROBLEM_MARKERS = [
  /\b(bug|error|crash|fail|broke|broken|issue|problem)\b/i,
  /\bdoesn'?t work\b/i,
  /\bnot working\b/i,
  /\bwon'?t\b.*\bwork\b/i,
  /\bkeeps? (failing|crashing|breaking|erroring)\b/i,
  /\broot cause\b/i,
  /\bthe (problem|issue|bug) (is|was)\b/i,
  /\bturns out\b.*\b(was|because|due to)\b/i,
  /\bthe fix (is|was)\b/i,
  /\bworkaround\b/i,
  /\bthat'?s why\b/i,
  /\bthe reason it\b/i,
  /\bfixed (it |the |by )\b/i,
  /\bsolution (is|was)\b/i,
  /\bresolved\b/i,
  /\bpatched\b/i,
  /\bthe answer (is|was)\b/i,
  /\b(had|need) to\b.*\binstead\b/i,
];

const EMOTION_MARKERS = [
  /\blove\b/i,
  /\bscared\b/i,
  /\bafraid\b/i,
  /\bproud\b/i,
  /\bhurt\b/i,
  /\bhappy\b/i,
  /\bsad\b/i,
  /\bcry\b/i,
  /\bcrying\b/i,
  /\bmiss\b/i,
  /\bsorry\b/i,
  /\bgrateful\b/i,
  /\bangry\b/i,
  /\bworried\b/i,
  /\blonely\b/i,
  /\bbeautiful\b/i,
  /\bamazing\b/i,
  /\bwonderful\b/i,
  /i feel/i,
  /i'm scared/i,
  /i love you/i,
  /i'm sorry/i,
  /i can't/i,
  /i wish/i,
  /i miss/i,
  /i need/i,
  /never told anyone/i,
  /nobody knows/i,
  /\*[^*]+\*/,
];

const ALL_MARKERS: Record<MemoryType, RegExp[]> = {
  decision: DECISION_MARKERS,
  preference: PREFERENCE_MARKERS,
  milestone: MILESTONE_MARKERS,
  problem: PROBLEM_MARKERS,
  emotional: EMOTION_MARKERS,
};

// =============================================================================
// SENTIMENT — for disambiguation
// Python: general_extractor.py POSITIVE_WORDS, NEGATIVE_WORDS
// =============================================================================

const POSITIVE_WORDS = new Set([
  'pride', 'proud', 'joy', 'happy', 'love', 'loving', 'beautiful', 'amazing',
  'wonderful', 'incredible', 'fantastic', 'brilliant', 'perfect', 'excited',
  'thrilled', 'grateful', 'warm', 'breakthrough', 'success', 'works',
  'working', 'solved', 'fixed', 'nailed', 'heart', 'hug', 'precious', 'adore',
]);

const NEGATIVE_WORDS = new Set([
  'bug', 'error', 'crash', 'crashing', 'crashed', 'fail', 'failed', 'failing',
  'failure', 'broken', 'broke', 'breaking', 'breaks', 'issue', 'problem',
  'wrong', 'stuck', 'blocked', 'unable', 'impossible', 'missing', 'terrible',
  'horrible', 'awful', 'worse', 'worst', 'panic', 'disaster', 'mess',
]);

function getSentiment(text: string): 'positive' | 'negative' | 'neutral' {
  const words = new Set(text.toLowerCase().match(/\b\w+\b/g) ?? []);
  let pos = 0;
  let neg = 0;
  for (const w of words) {
    if (POSITIVE_WORDS.has(w)) pos++;
    if (NEGATIVE_WORDS.has(w)) neg++;
  }
  if (pos > neg) return 'positive';
  if (neg > pos) return 'negative';
  return 'neutral';
}

function hasResolution(text: string): boolean {
  const lower = text.toLowerCase();
  const patterns = [
    /\bfixed\b/, /\bsolved\b/, /\bresolved\b/, /\bpatched\b/,
    /\bgot it working\b/, /\bit works\b/, /\bnailed it\b/,
    /\bfigured (it )?out\b/, /\bthe (fix|answer|solution)\b/,
  ];
  return patterns.some((p) => p.test(lower));
}

function disambiguate(
  memoryType: MemoryType,
  text: string,
  scores: Map<MemoryType, number>,
): MemoryType {
  const sentiment = getSentiment(text);

  // Resolved problems are milestones
  if (memoryType === 'problem' && hasResolution(text)) {
    if ((scores.get('emotional') ?? 0) > 0 && sentiment === 'positive') {
      return 'emotional';
    }
    return 'milestone';
  }

  // Problem + positive sentiment => milestone or emotional
  if (memoryType === 'problem' && sentiment === 'positive') {
    if ((scores.get('milestone') ?? 0) > 0) return 'milestone';
    if ((scores.get('emotional') ?? 0) > 0) return 'emotional';
  }

  return memoryType;
}

// =============================================================================
// CODE LINE FILTERING
// Python: general_extractor.py _CODE_LINE_PATTERNS
// =============================================================================

const CODE_LINE_PATTERNS = [
  /^\s*[$#]\s/,
  /^\s*(cd|source|echo|export|pip|npm|git|python|bash|curl|wget|mkdir|rm|cp|mv|ls|cat|grep|find|chmod|sudo|brew|docker)\s/,
  /^\s*```/,
  /^\s*(import|from|def|class|function|const|let|var|return)\s/,
  /^\s*[A-Z_]{2,}=/,
  /^\s*\|/,
  /^\s*-{2,}/,
  /^\s*[{}[\]]\s*$/,
  /^\s*(if|for|while|try|except|elif|else:)\b/,
  /^\s*\w+\.\w+\(/,
  /^\s*\w+ = \w+\.\w+/,
];

function isCodeLine(line: string): boolean {
  const stripped = line.trim();
  if (!stripped) return false;
  for (const pattern of CODE_LINE_PATTERNS) {
    if (pattern.test(stripped)) return true;
  }
  const alphaCount = [...stripped].filter((c) => /[a-zA-Z]/.test(c)).length;
  const alphaRatio = alphaCount / Math.max(stripped.length, 1);
  if (alphaRatio < 0.4 && stripped.length > 10) return true;
  return false;
}

function extractProse(text: string): string {
  const lines = text.split('\n');
  const prose: string[] = [];
  let inCode = false;
  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      inCode = !inCode;
      continue;
    }
    if (inCode) continue;
    if (!isCodeLine(line)) {
      prose.push(line);
    }
  }
  const result = prose.join('\n').trim();
  return result || text;
}

// =============================================================================
// SCORING
// Python: general_extractor.py _score_markers
// =============================================================================

function scoreMarkers(text: string, markers: RegExp[]): number {
  const lower = text.toLowerCase();
  let score = 0;
  for (const marker of markers) {
    const matches = lower.match(new RegExp(marker.source, 'gi'));
    if (matches) {
      score += matches.length;
    }
  }
  return score;
}

// =============================================================================
// SEGMENT SPLITTING
// Python: general_extractor.py _split_into_segments, _split_by_turns
// =============================================================================

function splitByTurns(lines: string[], turnPatterns: RegExp[]): string[] {
  const segments: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    const stripped = line.trim();
    const isTurn = turnPatterns.some((pat) => pat.test(stripped));

    if (isTurn && current.length > 0) {
      segments.push(current.join('\n'));
      current = [line];
    } else {
      current.push(line);
    }
  }

  if (current.length > 0) {
    segments.push(current.join('\n'));
  }

  return segments;
}

function splitIntoSegments(text: string): string[] {
  const lines = text.split('\n');

  const turnPatterns = [
    /^>\s/,
    /^(Human|User|Q)\s*:/i,
    /^(Assistant|AI|A|Claude|ChatGPT)\s*:/i,
  ];

  let turnCount = 0;
  for (const line of lines) {
    const stripped = line.trim();
    for (const pat of turnPatterns) {
      if (pat.test(stripped)) {
        turnCount++;
        break;
      }
    }
  }

  // If enough turn markers, split by turns
  if (turnCount >= 3) {
    return splitByTurns(lines, turnPatterns);
  }

  // Fallback: paragraph splitting
  const paragraphs = text.split('\n\n').map((p) => p.trim()).filter(Boolean);

  // If single giant block, chunk by line groups
  if (paragraphs.length <= 1 && lines.length > 20) {
    const segments: string[] = [];
    for (let i = 0; i < lines.length; i += 25) {
      const group = lines.slice(i, i + 25).join('\n').trim();
      if (group) segments.push(group);
    }
    return segments;
  }

  return paragraphs;
}

// =============================================================================
// MAIN EXTRACTION
// Python: general_extractor.py extract_memories(text, min_confidence=0.3)
// =============================================================================

/**
 * Extract 5-type memories from text content using regex pattern heuristics.
 *
 * Full port of general_extractor.py with:
 * - Regex marker scoring (not just substring matching)
 * - Sentiment-based disambiguation
 * - Code line filtering
 * - Proper segment splitting (speaker turns, paragraphs, line groups)
 * - Length bonus and confidence thresholds
 *
 * @param text - Text to extract memories from
 * @param minConfidence - Minimum confidence threshold (0.0-1.0), default 0.3
 * @returns Array of extracted memories with type classification
 */
export function extractMemoriesFull(
  text: string,
  minConfidence: number = 0.3,
): ExtractedMemory[] {
  const paragraphs = splitIntoSegments(text);
  const memories: ExtractedMemory[] = [];

  for (const para of paragraphs) {
    if (para.trim().length < 20) continue;

    const prose = extractProse(para);

    // Score against all types
    const scores = new Map<MemoryType, number>();
    for (const [memType, markers] of Object.entries(ALL_MARKERS) as Array<[MemoryType, RegExp[]]>) {
      const score = scoreMarkers(prose, markers);
      if (score > 0) {
        scores.set(memType, score);
      }
    }

    if (scores.size === 0) continue;

    // Length bonus
    let lengthBonus = 0;
    if (para.length > 500) lengthBonus = 2;
    else if (para.length > 200) lengthBonus = 1;

    let maxType: MemoryType = 'decision';
    let maxScore = 0;
    for (const [type, score] of scores) {
      if (score > maxScore) {
        maxScore = score;
        maxType = type;
      }
    }
    maxScore += lengthBonus;

    // Disambiguate
    maxType = disambiguate(maxType, prose, scores);

    // Confidence
    const confidence = Math.min(1.0, maxScore / 5.0);
    if (confidence < minConfidence) continue;

    memories.push({
      content: para.trim(),
      memory_type: maxType,
      chunk_index: memories.length,
    });
  }

  return memories;
}
