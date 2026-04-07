/**
 * @module split-mega-files
 * Split concatenated transcript files into per-session files.
 *
 * 1:1 PORT from original split_mega_files.py
 *
 * Scans a directory for .txt files that contain multiple Claude Code sessions
 * (identified by "Claude Code v" headers). Splits each into individual files
 * named with: date, time, people detected, and subject from first prompt.
 *
 * Distinguishes true session starts from mid-session context restores
 * (which show "Ctrl+E"/"previous messages").
 */

import {
  readFileSync,
  writeFileSync,
  readdirSync,
  renameSync,
  existsSync,
  statSync,
} from 'node:fs';
import { join, basename } from 'node:path';
import { z } from 'zod';
import { resolvePath, expandHome } from './utils/paths.js';

// Known names config path
const KNOWN_NAMES_PATH = join(expandHome('~'), '.mempalace', 'known_names.json');
const FALLBACK_KNOWN_PEOPLE = ['Alice', 'Ben', 'Riley', 'Max', 'Sam', 'Devon', 'Jordan'];

const KnownNamesListSchema = z.array(z.string());
const KnownNamesDictSchema = z.object({
  names: z.array(z.string()),
  username_map: z.record(z.string(), z.string()).optional(),
});
const KnownNamesSchema = z.union([KnownNamesListSchema, KnownNamesDictSchema]);

type KnownNamesConfig = z.infer<typeof KnownNamesSchema>;

let _knownNamesCache: KnownNamesConfig | null | undefined = undefined;

function loadKnownNamesConfig(): KnownNamesConfig | null {
  if (_knownNamesCache !== undefined) return _knownNamesCache;

  if (existsSync(KNOWN_NAMES_PATH)) {
    try {
      const raw = JSON.parse(readFileSync(KNOWN_NAMES_PATH, 'utf-8'));
      _knownNamesCache = KnownNamesSchema.parse(raw);
      return _knownNamesCache;
    } catch {
      // fall through
    }
  }

  _knownNamesCache = null;
  return null;
}

function loadKnownPeople(): string[] {
  const data = loadKnownNamesConfig();
  if (Array.isArray(data)) return data;
  if (data && 'names' in data) return data.names;
  return [...FALLBACK_KNOWN_PEOPLE];
}

function loadUsernameMap(): Record<string, string> {
  const data = loadKnownNamesConfig();
  if (data && !Array.isArray(data) && data.username_map) {
    return data.username_map;
  }
  return {};
}

/**
 * True session start: 'Claude Code v' header NOT followed by 'Ctrl+E'/'previous messages'
 * within the next 6 lines.
 */
function isTrueSessionStart(lines: string[], idx: number): boolean {
  const nearby = lines.slice(idx, idx + 6).join('');
  return !nearby.includes('Ctrl+E') && !nearby.includes('previous messages');
}

/**
 * Return list of line indices where true new sessions begin.
 */
export function findSessionBoundaries(lines: string[]): number[] {
  const boundaries: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('Claude Code v') && isTrueSessionStart(lines, i)) {
      boundaries.push(i);
    }
  }
  return boundaries;
}

const MONTHS: Record<string, string> = {
  January: '01', February: '02', March: '03', April: '04',
  May: '05', June: '06', July: '07', August: '08',
  September: '09', October: '10', November: '11', December: '12',
};

/**
 * Find the first timestamp line.
 * Returns [humanReadable, iso] or [null, null].
 */
export function extractTimestamp(lines: string[]): [string | null, string | null] {
  const tsPattern = /⏺\s+(\d{1,2}:\d{2}\s+[AP]M)\s+\w+,\s+(\w+)\s+(\d{1,2}),\s+(\d{4})/;
  for (const line of lines.slice(0, 50)) {
    const m = tsPattern.exec(line);
    if (m) {
      const [, timeStr, month, day, year] = m;
      const mon = MONTHS[month] ?? '00';
      const dayZ = day.padStart(2, '0');
      const timeSafe = timeStr.replace(/:/g, '').replace(/ /g, '');
      const human = `${year}-${mon}-${dayZ}_${timeSafe}`;
      return [human, `${year}-${mon}-${dayZ}`];
    }
  }
  return [null, null];
}

/**
 * Detect people mentioned in first 100 lines.
 */
export function extractPeople(lines: string[]): string[] {
  const found = new Set<string>();
  const text = lines.slice(0, 100).join('');
  const knownPeople = loadKnownPeople();

  for (const person of knownPeople) {
    const escaped = person.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\b${escaped}\\b`, 'i');
    if (re.test(text)) {
      found.add(person);
    }
  }

  // Working directory username hint
  const dirMatch = /\/Users\/(\w+)\//.exec(text);
  if (dirMatch) {
    const username = dirMatch[1];
    const usernameMap = loadUsernameMap();
    if (username in usernameMap) {
      found.add(usernameMap[username]);
    }
  }

  return [...found].sort();
}

/**
 * Find the first meaningful user prompt (> line that isn't a shell command).
 */
export function extractSubject(lines: string[]): string {
  const skipPatterns = /^(\.\/|cd |ls |python|bash|git |cat |source |export |claude|.\/activate)/;
  for (const line of lines) {
    if (line.startsWith('> ')) {
      const prompt = line.slice(2).trim();
      if (prompt && !skipPatterns.test(prompt) && prompt.length > 5) {
        let subject = prompt.replace(/[^\w\s-]/g, '');
        subject = subject.trim().replace(/\s+/g, '-');
        return subject.slice(0, 60);
      }
    }
  }
  return 'session';
}

/**
 * Split a single mega-file into per-session files.
 *
 * Python: split_mega_files.py split_file(filepath, output_dir, dry_run=False)
 *
 * @returns List of output paths written (or would be written if dryRun)
 */
export function splitFile(
  filepath: string,
  outputDir: string | null,
  dryRun: boolean = false,
): string[] {
  const content = readFileSync(filepath, { encoding: 'utf-8' });
  const lines = content.split('\n');

  const boundaries = findSessionBoundaries(lines);
  if (boundaries.length < 2) return []; // Not a mega-file

  // Add sentinel at end
  boundaries.push(lines.length);

  const outDir = outputDir ?? join(filepath, '..');
  const written: string[] = [];
  const srcStem = basename(filepath, '.txt')
    .replace(/[^\w-]/g, '_')
    .slice(0, 40);

  for (let i = 0; i < boundaries.length - 1; i++) {
    const start = boundaries[i];
    const end = boundaries[i + 1];
    const chunk = lines.slice(start, end);

    if (chunk.length < 10) continue; // Skip tiny fragments

    const [tsHuman] = extractTimestamp(chunk);
    const people = extractPeople(chunk);
    const subject = extractSubject(chunk);

    const tsPart = tsHuman ?? `part${String(i + 1).padStart(2, '0')}`;
    const peoplePart = people.slice(0, 3).join('-') || 'unknown';
    let name = `${srcStem}__${tsPart}_${peoplePart}_${subject}.txt`;
    name = name.replace(/[^\w.\-]/g, '_').replace(/_+/g, '_');

    const outPath = join(outDir, name);

    if (dryRun) {
      console.log(`  [${i + 1}/${boundaries.length - 1}] ${name}  (${chunk.length} lines)`);
    } else {
      writeFileSync(outPath, chunk.join('\n'));
      console.log(`  \u2713 ${name}  (${chunk.length} lines)`);
    }

    written.push(outPath);
  }

  return written;
}

/**
 * Split all mega-files in a directory.
 *
 * Python: split_mega_files.py main()
 */
export function splitMegaFiles(options: {
  sourceDir: string;
  outputDir?: string;
  minSessions?: number;
  dryRun?: boolean;
}): { megaFilesFound: number; totalWritten: number } {
  const {
    sourceDir,
    outputDir,
    minSessions = 2,
    dryRun = false,
  } = options;

  const resolved = resolvePath(sourceDir);
  const files = readdirSync(resolved)
    .filter((f) => f.endsWith('.txt'))
    .map((f) => join(resolved, f))
    .sort();

  const megaFiles: Array<{ path: string; sessions: number }> = [];
  for (const f of files) {
    const content = readFileSync(f, 'utf-8');
    const lines = content.split('\n');
    const boundaries = findSessionBoundaries(lines);
    if (boundaries.length >= minSessions) {
      megaFiles.push({ path: f, sessions: boundaries.length });
    }
  }

  if (megaFiles.length === 0) {
    console.log(`No mega-files found in ${resolved} (min ${minSessions} sessions).`);
    return { megaFilesFound: 0, totalWritten: 0 };
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`  Mega-file splitter \u2014 ${dryRun ? 'DRY RUN' : 'SPLITTING'}`);
  console.log(`${'='.repeat(60)}`);
  console.log(`  Source:      ${resolved}`);
  console.log(`  Output:      ${outputDir ?? 'same dir as source'}`);
  console.log(`  Mega-files:  ${megaFiles.length}`);
  console.log(`${'─'.repeat(60)}\n`);

  let totalWritten = 0;
  for (const { path: f, sessions } of megaFiles) {
    const size = Math.floor(statSync(f).size / 1024);
    console.log(`  ${basename(f)}  (${sessions} sessions, ${size}KB)`);
    const written = splitFile(f, outputDir ?? null, dryRun);
    totalWritten += written.length;

    if (!dryRun && written.length > 0) {
      const backup = f.replace(/\.txt$/, '.mega_backup');
      renameSync(f, backup);
      console.log(`  \u2192 Original renamed to ${basename(backup)}\n`);
    } else {
      console.log();
    }
  }

  console.log(`${'─'.repeat(60)}`);
  if (dryRun) {
    console.log(`  DRY RUN \u2014 would create ${totalWritten} files from ${megaFiles.length} mega-files`);
  } else {
    console.log(`  Done \u2014 created ${totalWritten} files from ${megaFiles.length} mega-files`);
  }
  console.log();

  return { megaFilesFound: megaFiles.length, totalWritten };
}
