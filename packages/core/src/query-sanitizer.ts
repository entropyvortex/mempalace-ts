/**
 * @module query-sanitizer
 *
 * Mitigate system prompt contamination in search queries.
 *
 * 1:1 PORT of `mempalace/mempalace/query_sanitizer.py`
 *
 * Problem: AI agents sometimes prepend system prompts (2000+ chars) to search queries.
 * Embedding models represent the concatenated string as a single vector where the
 * system prompt overwhelms the actual question (typically 10-50 chars), causing
 * near-total retrieval failure (89.8% -> 1.0% R@10). See Issue #333.
 *
 * Approach: "Mitigation" — not perfect prevention, but prevents the cliff.
 *
 * Expected recovery:
 *   Step 1 passthrough (<=200 chars)     -> no degradation, ~89.8%
 *   Step 2 question extraction (? found) -> near-full recovery, ~85-89%
 *   Step 3 tail sentence extraction      -> moderate recovery, ~80-89%
 *   Step 4 tail truncation (fallback)    -> minimum viable, ~70-80%
 *
 *   Without sanitizer: 1.0% (catastrophic silent failure)
 *   Worst case with sanitizer: ~70-80% (survivable)
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Above this, prompt contamination increasingly dominates. */
export const MAX_QUERY_LENGTH = 250;

/** Below this, query is almost certainly clean. */
export const SAFE_QUERY_LENGTH = 200;

/** Extracted result shorter than this = extraction failed. */
export const MIN_QUERY_LENGTH = 10;

/** Characters treated as wrapping quotes. */
const QUOTE_CHARS: ReadonlySet<string> = new Set(["'", '"']);

/** Sentence splitter: split on . ! ? (including fullwidth) and newlines. */
const _SENTENCE_SPLIT = /[.!?。！？\n]+/;

/** Question detector: ends with ? or ？ (possibly with trailing whitespace/quotes). */
const _QUESTION_MARK = /[?？]\s*["']?\s*$/;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of sanitizing a query string. */
export interface SanitizeResult {
  cleanQuery: string;
  wasSanitized: boolean;
  originalLength: number;
  cleanLength: number;
  method: 'passthrough' | 'question_extraction' | 'tail_sentence' | 'tail_truncation';
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Strip matching wrapping quotes from the outside of a string.
 *
 * Python: `_strip_wrapping_quotes`
 */
function stripWrappingQuotes(candidate: string): string {
  candidate = candidate.trim();

  // Remove balanced wrapping quotes repeatedly
  while (
    candidate.length >= 2 &&
    QUOTE_CHARS.has(candidate[0]) &&
    candidate[0] === candidate[candidate.length - 1]
  ) {
    candidate = candidate.slice(1, -1).trim();
    if (!candidate) {
      return '';
    }
  }

  // Remove a lone leading quote
  if (candidate.length > 0 && QUOTE_CHARS.has(candidate[0])) {
    candidate = candidate.slice(1).trim();
  }

  // Remove a lone trailing quote
  if (candidate.length > 0 && QUOTE_CHARS.has(candidate[candidate.length - 1])) {
    candidate = candidate.slice(0, -1).trim();
  }

  return candidate;
}

/**
 * Trim a candidate string to fit within MAX_QUERY_LENGTH, preferring meaningful
 * sentence fragments from the end.
 *
 * Python: `_trim_candidate`
 */
function trimCandidate(candidate: string): string {
  candidate = stripWrappingQuotes(candidate);
  if (candidate.length <= MAX_QUERY_LENGTH) {
    return candidate;
  }

  const nestedFragments: string[] = candidate
    .split(_SENTENCE_SPLIT)
    .map((frag) => stripWrappingQuotes(frag))
    .filter((frag) => frag.trim().length > 0);

  for (let i = nestedFragments.length - 1; i >= 0; i--) {
    const frag = nestedFragments[i];
    if (frag.length >= MIN_QUERY_LENGTH && frag.length <= MAX_QUERY_LENGTH) {
      return frag;
    }
  }

  return candidate.slice(-MAX_QUERY_LENGTH).trim();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extract the actual search intent from a potentially contaminated query.
 *
 * Python: `sanitize_query`
 *
 * @param rawQuery - The raw query string from the AI agent, possibly containing
 *                   system prompt content prepended to the actual question.
 * @returns A {@link SanitizeResult} describing the cleaned query and method used.
 */
export function sanitizeQuery(rawQuery: string): SanitizeResult {
  // Handle empty / whitespace-only input
  if (!rawQuery || !rawQuery.trim()) {
    return {
      cleanQuery: rawQuery || '',
      wasSanitized: false,
      originalLength: rawQuery ? rawQuery.length : 0,
      cleanLength: rawQuery ? rawQuery.length : 0,
      method: 'passthrough',
    };
  }

  rawQuery = rawQuery.trim();
  const originalLength = rawQuery.length;

  // --- Step 1: Short query passthrough ---
  if (originalLength <= SAFE_QUERY_LENGTH) {
    return {
      cleanQuery: rawQuery,
      wasSanitized: false,
      originalLength,
      cleanLength: originalLength,
      method: 'passthrough',
    };
  }

  // --- Step 2: Question extraction ---
  // Split into sentences and find ones ending with ?
  const sentences = rawQuery
    .split(_SENTENCE_SPLIT)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  // Also split on newlines to catch questions on their own line
  const allSegments: string[] = rawQuery
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  // Look for question marks in segments (prefer later ones = more likely the actual query)
  const questionSentences: string[] = [];

  for (let i = allSegments.length - 1; i >= 0; i--) {
    if (_QUESTION_MARK.test(allSegments[i])) {
      questionSentences.push(allSegments[i]);
    }
  }

  if (questionSentences.length === 0) {
    // Also check the sentence-split results
    for (let i = sentences.length - 1; i >= 0; i--) {
      if (sentences[i].includes('?') || sentences[i].includes('\uff1f')) {
        questionSentences.push(sentences[i]);
      }
    }
  }

  if (questionSentences.length > 0) {
    // Take the last (most recent) question found
    let candidate = questionSentences[0].trim();
    if (candidate.length >= MIN_QUERY_LENGTH) {
      if (candidate.length > MAX_QUERY_LENGTH) {
        candidate = trimCandidate(candidate);
      }
      console.warn(
        `Query sanitized: ${originalLength} → ${candidate.length} chars (method=question_extraction)`,
      );
      return {
        cleanQuery: candidate,
        wasSanitized: true,
        originalLength,
        cleanLength: candidate.length,
        method: 'question_extraction',
      };
    }
  }

  // --- Step 3: Tail sentence extraction ---
  // System prompts are prepended, so the actual query is near the end.
  // Walk backwards through segments to find the last meaningful sentence.
  for (let i = allSegments.length - 1; i >= 0; i--) {
    const seg = allSegments[i].trim();
    if (seg.length >= MIN_QUERY_LENGTH) {
      const candidate = trimCandidate(seg);
      if (candidate.length < MIN_QUERY_LENGTH) {
        continue;
      }
      console.warn(
        `Query sanitized: ${originalLength} → ${candidate.length} chars (method=tail_sentence)`,
      );
      return {
        cleanQuery: candidate,
        wasSanitized: true,
        originalLength,
        cleanLength: candidate.length,
        method: 'tail_sentence',
      };
    }
  }

  // --- Step 4: Tail truncation (fallback) ---
  // Nothing worked — just take the last MAX_QUERY_LENGTH characters.
  const fallback = rawQuery.slice(-MAX_QUERY_LENGTH).trim();
  console.warn(
    `Query sanitized: ${originalLength} → ${fallback.length} chars (method=tail_truncation)`,
  );
  return {
    cleanQuery: fallback,
    wasSanitized: true,
    originalLength,
    cleanLength: fallback.length,
    method: 'tail_truncation',
  };
}
