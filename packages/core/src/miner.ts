/**
 * @module miner
 * Project file mining — scans project directories and ingests files into the memory palace.
 *
 * 1:1 PORT from original miner.py
 *
 * Maps directly to:
 *   Python functions: load_config, detect_room, chunk_text, get_collection,
 *                     file_already_mined, add_drawer, process_file, scan_project,
 *                     mine, status
 *   Python file:      miner.py
 */

import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';

/** Maximum file size for mining (10 MB). Files larger than this are skipped. */
export const MAX_FILE_SIZE = 10 * 1024 * 1024;
import { join, extname, basename } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { randomUUID } from 'node:crypto';
import { formatDateTime } from './utils/date.js';
import pLimit from 'p-limit';

import { ProjectConfigSchema, READABLE_EXTENSIONS, SKIP_DIRS } from './types.js';
import type { ProjectConfig, RoomConfig, TextChunk, DrawerMetadata } from './types.js';
import { chunkText } from './utils/chunk.js';
import { resolvePath } from './utils/paths.js';
import { GitignoreMatcher, loadGitignoreMatcher, isGitignored } from './utils/gitignore.js';
import { getCollection, fileAlreadyMined, addDrawer as addDrawerToChroma, INCLUDE_METADATAS } from './chroma.js';
import type { ChromaCollection } from './chroma.js';

/**
 * Load project configuration from a mempalace.yaml file.
 *
 * Python: miner.py load_config(project_dir) -> dict
 * TS: loadConfig(projectDir) -> ProjectConfig
 *
 * @param projectDir - Path to the project directory
 * @returns Parsed project configuration
 */
export function loadConfig(projectDir: string): ProjectConfig {
  const resolved = resolvePath(projectDir);
  const configPath = join(resolved, 'mempalace.yaml');

  if (!existsSync(configPath)) {
    return {
      wing: `wing_${basename(resolved)}`,
      rooms: [{ name: 'general', description: 'General files', keywords: [] }],
    };
  }

  const raw = readFileSync(configPath, 'utf-8');
  const parsed = parseYaml(raw) as Record<string, unknown>;
  return ProjectConfigSchema.parse(parsed);
}

/**
 * Detect which room a file belongs to based on path and content.
 *
 * Python: miner.py detect_room(filepath, content, rooms, project_path) -> str
 * TS: detectRoom(filepath, content, rooms) -> string
 *
 * Priority:
 *   1. Folder path contains room name
 *   2. Filename matches room name
 *   3. Content keyword scoring
 *   4. Fallback: "general"
 */
export function detectRoom(
  filepath: string,
  content: string,
  rooms: RoomConfig[],
): string {
  const pathLower = filepath.toLowerCase();
  const filenameLower = basename(filepath).toLowerCase();
  const contentLower = content.slice(0, 2000).toLowerCase();

  // Python: Priority 1 — Folder path contains room name
  for (const room of rooms) {
    if (pathLower.includes(`/${room.name.toLowerCase()}/`) ||
        pathLower.includes(`\\${room.name.toLowerCase()}\\`)) {
      return room.name;
    }
  }

  // Python: Priority 2 — Filename matches room name
  for (const room of rooms) {
    if (filenameLower.includes(room.name.toLowerCase())) {
      return room.name;
    }
  }

  // Python: Priority 3 — Content keyword scoring
  const scores = new Map<string, number>();
  for (const room of rooms) {
    let score = 0;
    const keywords = [...room.keywords, room.name];
    for (const kw of keywords) {
      const kwLower = kw.toLowerCase();
      let idx = contentLower.indexOf(kwLower);
      while (idx !== -1) {
        score++;
        idx = contentLower.indexOf(kwLower, idx + 1);
      }
    }
    if (score > 0) {
      scores.set(room.name, score);
    }
  }

  if (scores.size > 0) {
    let bestRoom = 'general';
    let bestScore = 0;
    for (const [room, score] of scores) {
      if (score > bestScore) {
        bestScore = score;
        bestRoom = room;
      }
    }
    return bestRoom;
  }

  // Python: Fallback
  return 'general';
}

/**
 * Recursively scan a project directory for readable files.
 *
 * Python: miner.py scan_project(project_dir) -> list[Path]
 * TS: scanProject(projectDir, respectGitignore?, includeIgnored?) -> string[]
 *
 * Skips hidden directories, node_modules, __pycache__, etc.
 * Optionally respects .gitignore files (default: true).
 */
export function scanProject(
  projectDir: string,
  respectGitignore: boolean = true,
  includeIgnored: string[] = [],
): string[] {
  const resolved = resolvePath(projectDir);
  const files: string[] = [];
  const gitignoreCache = new Map<string, GitignoreMatcher | null>();

  // Pre-resolve include-ignored paths to absolute
  const includeSet = new Set(
    includeIgnored.map((p) => resolvePath(join(resolved, p))),
  );

  function isForceIncluded(fullPath: string): boolean {
    for (const inc of includeSet) {
      if (fullPath.startsWith(inc)) return true;
    }
    return false;
  }

  function walk(dir: string, activeMatchers: GitignoreMatcher[]): void {
    // Load .gitignore for this directory
    const matchers = [...activeMatchers];
    if (respectGitignore) {
      const matcher = loadGitignoreMatcher(dir, gitignoreCache);
      if (matcher) matchers.push(matcher);
    }

    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;

        // Check gitignore for directory
        if (respectGitignore && !isForceIncluded(fullPath)) {
          if (isGitignored(fullPath, matchers, true)) continue;
        }

        walk(fullPath, matchers);
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        if (!READABLE_EXTENSIONS.has(ext)) continue;

        // Check gitignore for file
        if (respectGitignore && !isForceIncluded(fullPath)) {
          if (isGitignored(fullPath, matchers, false)) continue;
        }

        files.push(fullPath);
      }
    }
  }

  walk(resolved, []);
  return files;
}

/**
 * Generate a unique drawer ID.
 *
 * Python: miner.py add_drawer() ID generation: drawer_{wing}_{room}_{hash}
 */
function drawerId(wing: string, room: string): string {
  return `drawer_${wing}_${room}_${randomUUID().slice(0, 8)}`;
}

/**
 * Process a single file: read, chunk, and add drawers.
 *
 * Python: miner.py process_file(filepath, project_path, collection, wing, rooms, agent, dry_run) -> int
 * TS: processFile(filepath, collection, wing, rooms, agent, dryRun) -> number
 *
 * @returns Number of drawers added
 */
export async function processFile(
  filepath: string,
  collection: ChromaCollection,
  wing: string,
  rooms: RoomConfig[],
  agent: string = 'mempalace',
  dryRun: boolean = false,
): Promise<number> {
  // Python: Check if already mined
  if (await fileAlreadyMined(collection, filepath)) {
    return 0;
  }

  // Issue #250: guard against OOM on large files
  const fileSize = statSync(filepath).size;
  if (fileSize > MAX_FILE_SIZE) {
    return 0;
  }

  const content = readFileSync(filepath, 'utf-8');
  if (!content.trim()) return 0;

  const room = detectRoom(filepath, content, rooms);
  const chunks = chunkText(content);

  if (dryRun) return chunks.length;

  let added = 0;
  for (const chunk of chunks) {
    const id = drawerId(wing, room);
    const metadata: DrawerMetadata = {
      wing,
      room,
      source_file: filepath,
      chunk_index: chunk.chunk_index,
      added_by: agent,
      filed_at: formatDateTime(new Date()),
      ingest_mode: 'projects',
    };

    await addDrawerToChroma(collection, id, chunk.content, metadata);
    added++;
  }

  return added;
}

/**
 * Mine a project directory into the memory palace.
 *
 * Python: miner.py mine(project_dir, palace_path, wing_override=None, agent="mempalace",
 *                       limit=0, dry_run=False)
 * TS: mine(options) -> { filesProcessed, drawersAdded }
 *
 * @param options - Mining options
 * @returns Mining results with counts
 */
export async function mine(options: {
  projectDir: string;
  palacePath?: string;
  wingOverride?: string;
  agent?: string;
  limit?: number;
  dryRun?: boolean;
  collectionName?: string;
  respectGitignore?: boolean;
  includeIgnored?: string[];
}): Promise<{ filesProcessed: number; drawersAdded: number }> {
  const {
    projectDir,
    wingOverride,
    agent = 'mempalace',
    limit = 0,
    dryRun = false,
    collectionName,
    respectGitignore = true,
    includeIgnored = [],
  } = options;

  const config = loadConfig(projectDir);
  const wing = wingOverride ?? config.wing;
  const collection = await getCollection(collectionName);
  const files = scanProject(projectDir, respectGitignore, includeIgnored);

  const toProcess = limit > 0 ? files.slice(0, limit) : files;
  const concurrency = pLimit(5);

  let totalDrawers = 0;
  const results = await Promise.all(
    toProcess.map((f) =>
      concurrency(() => processFile(f, collection, wing, config.rooms, agent, dryRun)),
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
 * Get mining status for a palace.
 *
 * Python: miner.py status(palace_path)
 * TS: miningStatus(collectionName) -> { drawerCount, wings, rooms }
 */
export async function miningStatus(collectionName?: string): Promise<{
  drawerCount: number;
  wings: Record<string, number>;
}> {
  const collection = await getCollection(collectionName);
  const count = await collection.count();

  const all = await collection.get({ include: [INCLUDE_METADATAS] });
  const wings: Record<string, number> = {};
  for (const meta of all.metadatas ?? []) {
    const wing = String((meta as Record<string, string>)?.wing ?? 'unknown');
    wings[wing] = (wings[wing] ?? 0) + 1;
  }

  return { drawerCount: count, wings };
}
