/**
 * @module convo-miner
 * Conversation mining — ingests chat transcripts into the memory palace.
 *
 * 1:1 PORT from original convo_miner.py
 *
 * Maps directly to:
 *   Python functions: chunk_exchanges, _chunk_by_exchange, _chunk_by_paragraph,
 *                     detect_convo_room, mine_convos
 *   Python file:      convo_miner.py
 *
 * Supports two extract modes:
 *   - "exchange": (user question + assistant response) = 1 chunk
 *   - "general":  5-type memory extraction (decisions, preferences, milestones, problems, emotional)
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { formatDateTime } from './utils/date.js';
import pLimit from 'p-limit';

import type { DrawerMetadata, ExtractMode, TextChunk, ExtractedMemory } from './types.js';
import { normalize } from './utils/normalize.js';
import { getCollection, fileAlreadyMined, addDrawer } from './chroma.js';
import { extractMemories } from './entity-detector.js';
import type { ChromaCollection } from './chroma.js';

// ---------------------------------------------------------------------------
// Topic Keywords — 1:1 PORT from convo_miner.py TOPIC_KEYWORDS
// ---------------------------------------------------------------------------

/**
 * Topic keyword mapping for room detection in conversations.
 * Python: convo_miner.py TOPIC_KEYWORDS
 */
const TOPIC_KEYWORDS: Record<string, string[]> = {
  technical: [
    'code', 'python', 'function', 'bug', 'error', 'api', 'database',
    'javascript', 'typescript', 'react', 'deploy', 'server', 'query',
    'test', 'debug', 'compile', 'runtime', 'stack', 'import', 'module',
  ],
  architecture: [
    'architecture', 'design', 'pattern', 'structure', 'schema', 'model',
    'interface', 'abstraction', 'layer', 'component', 'service', 'system',
  ],
  planning: [
    'plan', 'roadmap', 'milestone', 'deadline', 'priority', 'sprint',
    'backlog', 'goal', 'objective', 'timeline', 'schedule', 'phase',
  ],
  decisions: [
    'decided', 'chose', 'picked', 'switched', 'migrated', 'replaced',
    'selected', 'went with', 'opted', 'committed to', 'locked in',
  ],
  problems: [
    'problem', 'issue', 'broken', 'failed', 'crash', 'stuck',
    'workaround', 'fix', 'bug', 'regression', 'blocker', 'incident',
  ],
};

/**
 * Chunk a conversation by exchange pairs (user + assistant).
 *
 * Python: convo_miner.py _chunk_by_exchange(lines) -> list
 * TS: chunkByExchange(content) -> TextChunk[]
 *
 * Each exchange = one user turn (starting with ">") + the assistant response that follows.
 */
function chunkByExchange(content: string): TextChunk[] {
  const lines = content.split('\n');
  const chunks: TextChunk[] = [];
  let currentChunk: string[] = [];
  let inUserTurn = false;

  for (const line of lines) {
    if (line.startsWith('>')) {
      // Python: Start of a new exchange — flush previous chunk if we have assistant content
      if (currentChunk.length > 0 && !inUserTurn) {
        const text = currentChunk.join('\n').trim();
        if (text.length >= 50) {
          chunks.push({ content: text, chunk_index: chunks.length });
        }
        currentChunk = [];
      }
      currentChunk.push(line);
      inUserTurn = true;
    } else {
      if (inUserTurn && line.trim() === '') {
        // Transition from user to assistant
        inUserTurn = false;
      }
      currentChunk.push(line);
    }
  }

  // Flush final chunk
  if (currentChunk.length > 0) {
    const text = currentChunk.join('\n').trim();
    if (text.length >= 50) {
      chunks.push({ content: text, chunk_index: chunks.length });
    }
  }

  return chunks;
}

/**
 * Chunk a conversation by paragraphs (fallback for unstructured text).
 *
 * Python: convo_miner.py _chunk_by_paragraph(content) -> list
 * TS: chunkByParagraph(content) -> TextChunk[]
 */
function chunkByParagraph(content: string): TextChunk[] {
  const paragraphs = content.split(/\n\n+/);
  const chunks: TextChunk[] = [];

  for (const para of paragraphs) {
    const text = para.trim();
    if (text.length >= 50) {
      chunks.push({ content: text, chunk_index: chunks.length });
    }
  }

  return chunks;
}

/**
 * Chunk a conversation into exchanges (user + assistant pairs).
 *
 * Python: convo_miner.py chunk_exchanges(content) -> list
 * TS: chunkExchanges(content) -> TextChunk[]
 *
 * Tries exchange-based chunking first; falls back to paragraph-based.
 */
export function chunkExchanges(content: string): TextChunk[] {
  // Try exchange-based chunking
  const exchanges = chunkByExchange(content);
  if (exchanges.length > 0) return exchanges;

  // Fallback: paragraph-based
  return chunkByParagraph(content);
}

/**
 * Detect the conversation room based on content keywords.
 *
 * Python: convo_miner.py detect_convo_room(content) -> str
 * TS: detectConvoRoom(content) -> string
 *
 * Scores content against topic keyword sets and returns the best match.
 */
export function detectConvoRoom(content: string): string {
  const lower = content.slice(0, 3000).toLowerCase();
  const scores: Record<string, number> = {};

  for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
    let score = 0;
    for (const kw of keywords) {
      let idx = lower.indexOf(kw);
      while (idx !== -1) {
        score++;
        idx = lower.indexOf(kw, idx + 1);
      }
    }
    if (score > 0) scores[topic] = score;
  }

  if (Object.keys(scores).length === 0) return 'general';

  let best = 'general';
  let bestScore = 0;
  for (const [topic, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      best = topic;
    }
  }
  return best;
}

/**
 * Mine conversations from a directory into the memory palace.
 *
 * Python: convo_miner.py mine_convos(convo_dir, palace_path, wing=None, agent="mempalace",
 *                                     limit=0, dry_run=False, extract_mode="exchange")
 * TS: mineConvos(options) -> { filesProcessed, drawersAdded }
 *
 * @param options - Mining options
 * @returns Mining results with counts
 */
export async function mineConvos(options: {
  convoDir: string;
  palacePath?: string;
  wing?: string;
  agent?: string;
  limit?: number;
  dryRun?: boolean;
  extractMode?: ExtractMode;
  collectionName?: string;
}): Promise<{ filesProcessed: number; drawersAdded: number }> {
  const {
    convoDir,
    wing,
    agent = 'mempalace',
    limit = 0,
    dryRun = false,
    extractMode = 'exchange',
    collectionName,
  } = options;

  const collection = await getCollection(collectionName);
  const files = findConvoFiles(convoDir);
  const toProcess = limit > 0 ? files.slice(0, limit) : files;

  const concurrency = pLimit(5);
  let totalDrawers = 0;

  const results = await Promise.all(
    toProcess.map((filepath) =>
      concurrency(async () => {
        if (await fileAlreadyMined(collection, filepath)) return 0;

        const raw = readFileSync(filepath, 'utf-8');
        const content = normalize(raw);

        // Python v3.2.0: register sentinel for empty / 0-chunk files so
        // fileAlreadyMined() returns true next time (prevents re-processing).
        if (!content.trim()) {
          if (!dryRun) {
            const sentinelId = `sentinel_${randomUUID().slice(0, 8)}`;
            const sentinelMeta: DrawerMetadata = {
              wing: wing ?? 'wing_convos',
              room: 'sentinel',
              source_file: filepath,
              chunk_index: 0,
              added_by: agent,
              filed_at: formatDateTime(new Date()),
              ingest_mode: 'convos',
            };
            await addDrawer(collection, sentinelId, '0-chunk sentinel', sentinelMeta);
          }
          return 0;
        }

        const room = detectConvoRoom(content);
        const wingName = wing ?? `wing_convos`;

        let chunks: Array<{ content: string; chunk_index: number }>;

        if (extractMode === 'general') {
          // Python: 5-type memory extraction
          const memories = extractMemories(content);
          chunks = memories.map((m, i) => ({
            content: `[${m.memory_type}] ${m.content}`,
            chunk_index: i,
          }));
          if (chunks.length === 0) {
            chunks = chunkExchanges(content);
          }
        } else {
          chunks = chunkExchanges(content);
        }

        // Register sentinel for files that produce 0 chunks after extraction
        if (chunks.length === 0) {
          if (!dryRun) {
            const sentinelId = `sentinel_${randomUUID().slice(0, 8)}`;
            const sentinelMeta: DrawerMetadata = {
              wing: wingName,
              room: 'sentinel',
              source_file: filepath,
              chunk_index: 0,
              added_by: agent,
              filed_at: formatDateTime(new Date()),
              ingest_mode: 'convos',
            };
            await addDrawer(collection, sentinelId, '0-chunk sentinel', sentinelMeta);
          }
          return 0;
        }

        if (dryRun) return chunks.length;

        let added = 0;
        for (const chunk of chunks) {
          const id = `drawer_${wingName}_${room}_${randomUUID().slice(0, 8)}`;
          const metadata: DrawerMetadata = {
            wing: wingName,
            room,
            source_file: filepath,
            chunk_index: chunk.chunk_index,
            added_by: agent,
            filed_at: formatDateTime(new Date()),
            ingest_mode: 'convos',
            extract_mode: extractMode,
          };

          await addDrawer(collection, id, chunk.content, metadata);
          added++;
        }

        return added;
      }),
    ),
  );

  for (const count of results) {
    totalDrawers += count;
  }

  return {
    filesProcessed: toProcess.length,
    drawersAdded: totalDrawers,
  };
}

/**
 * Find conversation files in a directory.
 * Looks for .txt, .json, .jsonl, .md files.
 */
function findConvoFiles(dir: string): string[] {
  const resolved = join(dir);
  const files: string[] = [];
  const validExts = new Set(['.txt', '.json', '.jsonl', '.md']);

  try {
    const entries = readdirSync(resolved, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        if (validExts.has(ext)) {
          files.push(join(resolved, entry.name));
        }
      }
    }
  } catch {
    // Directory doesn't exist or isn't readable
  }

  return files;
}
