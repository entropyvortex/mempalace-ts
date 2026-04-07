/**
 * @module spellcheck
 * Spell-correct user messages before palace filing.
 *
 * 1:1 PORT from original spellcheck.py
 *
 * Preserves:
 *   - Technical terms (words with digits, hyphens, underscores)
 *   - CamelCase and ALL_CAPS identifiers
 *   - Known entity names
 *   - URLs and file paths
 *   - Words shorter than 4 chars
 *
 * Corrects:
 *   - Genuine typos in lowercase, flowing text
 *
 * Note: The Python version uses the `autocorrect` library. This TS port
 * provides the same structure but uses a simple edit-distance dictionary
 * approach since there is no direct TS equivalent. For full spell-checking,
 * install an npm spellcheck library and wire it in via setSpeller().
 */

// ---------------------------------------------------------------------------
// Speller interface — pluggable spell correction backend
// ---------------------------------------------------------------------------

type SpellerFn = (word: string) => string;

let _speller: SpellerFn | null = null;

/**
 * Set a custom speller function.
 * The function should accept a word and return the corrected version.
 *
 * Example with nspell or similar:
 *   setSpeller((word) => dictionary.suggest(word)[0] ?? word);
 */
export function setSpeller(fn: SpellerFn): void {
  _speller = fn;
}

// ---------------------------------------------------------------------------
// Patterns that mark a token as "don't touch this"
// Python: spellcheck.py skip patterns
// ---------------------------------------------------------------------------

const HAS_DIGIT = /\d/;
const IS_CAMEL = /[A-Z][a-z]+[A-Z]/;
const IS_ALLCAPS = /^[A-Z_@#$%^&*()+=[\]{}|<>?.:/\\]+$/;
const IS_TECHNICAL = /[-_]/;
const IS_URL = /https?:\/\/|www\.|\/Users\/|~\/|\.[a-z]{2,4}$/i;
const IS_CODE_OR_EMOJI = /[`*_#{}[\]\\]/;
const MIN_LENGTH = 4;

function shouldSkip(token: string, knownNames: Set<string>): boolean {
  if (token.length < MIN_LENGTH) return true;
  if (HAS_DIGIT.test(token)) return true;
  if (IS_CAMEL.test(token)) return true;
  if (IS_ALLCAPS.test(token)) return true;
  if (IS_TECHNICAL.test(token)) return true;
  if (IS_URL.test(token)) return true;
  if (IS_CODE_OR_EMOJI.test(token)) return true;
  if (knownNames.has(token.toLowerCase())) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Edit distance — guard against over-aggressive corrections
// Python: spellcheck.py _edit_distance
// ---------------------------------------------------------------------------

/**
 * Levenshtein distance between two strings.
 */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      curr.push(
        Math.min(
          prev[j] + 1,
          curr[j - 1] + 1,
          prev[j - 1] + (a[i - 1] !== b[j - 1] ? 1 : 0),
        ),
      );
    }
    prev = curr;
  }
  return prev[b.length];
}

// ---------------------------------------------------------------------------
// Core correction
// Python: spellcheck.py spellcheck_user_text
// ---------------------------------------------------------------------------

const TOKEN_RE = /(\S+)/g;

/**
 * Spell-correct a user message.
 *
 * Python: spellcheck.py spellcheck_user_text(text, known_names=None)
 *
 * @param text - Raw user message text
 * @param knownNames - Set of lowercase names/terms to preserve
 * @returns Corrected text. Falls back to original if no speller is set.
 */
export function spellcheckUserText(
  text: string,
  knownNames: Set<string> = new Set(),
): string {
  if (!_speller) return text; // No speller configured — pass through

  const speller = _speller;

  return text.replace(TOKEN_RE, (token) => {
    // Strip trailing punctuation for checking, reattach after
    const stripped = token.replace(/[.,!?;:'")\]]+$/, '');
    const punct = token.slice(stripped.length);

    if (!stripped || shouldSkip(stripped, knownNames)) return token;

    // Only correct lowercase words (capitalized words are likely proper nouns)
    if (stripped[0] === stripped[0].toUpperCase() && stripped[0] !== stripped[0].toLowerCase()) {
      return token;
    }

    const corrected = speller(stripped);

    // Guard: don't apply if corrected word is too different
    if (corrected !== stripped) {
      const dist = editDistance(stripped, corrected);
      const maxEdits = stripped.length <= 7 ? 2 : 3;
      if (dist > maxEdits) return token;
    }

    return corrected + punct;
  });
}

/**
 * Spell-correct a single transcript line.
 * Only touches lines that start with '>' (user turns).
 *
 * Python: spellcheck.py spellcheck_transcript_line(line)
 */
export function spellcheckTranscriptLine(line: string): string {
  const stripped = line.trimStart();
  if (!stripped.startsWith('>')) return line;

  const prefixLen = line.length - stripped.length + 2; // '> '
  const message = line.slice(prefixLen);
  if (!message.trim()) return line;

  const corrected = spellcheckUserText(message);
  return line.slice(0, prefixLen) + corrected;
}

/**
 * Spell-correct all user turns in a full transcript.
 * Only lines starting with '>' are touched.
 *
 * Python: spellcheck.py spellcheck_transcript(content)
 */
export function spellcheckTranscript(content: string): string {
  const lines = content.split('\n');
  return lines.map(spellcheckTranscriptLine).join('\n');
}
