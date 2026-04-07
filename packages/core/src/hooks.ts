/**
 * @module hooks
 * Hook logic for MemPalace — session-start, stop, and precompact hooks.
 *
 * 1:1 PORT from original hooks_cli.py
 *
 * Reads JSON from stdin, outputs JSON to stdout.
 * Supported hooks: session-start, stop, precompact
 * Supported harnesses: claude-code, codex
 */

import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { expandHome } from './utils/paths.js';

const SAVE_INTERVAL = 15;
const STATE_DIR = join(expandHome('~'), '.mempalace', 'hook_state');

const STOP_BLOCK_REASON =
  'AUTO-SAVE checkpoint. Save key topics, decisions, quotes, and code ' +
  'from this session to your memory system. Organize into appropriate ' +
  'categories. Use verbatim quotes where possible. Continue conversation ' +
  'after saving.';

const PRECOMPACT_BLOCK_REASON =
  'COMPACTION IMMINENT. Save ALL topics, decisions, quotes, code, and ' +
  'important context from this session to your memory system. Be thorough ' +
  '\u2014 after compaction, detailed context will be lost. Organize into ' +
  'appropriate categories. Use verbatim quotes where possible. Save ' +
  'everything, then allow compaction to proceed.';

function sanitizeSessionId(sessionId: string): string {
  const sanitized = sessionId.replace(/[^a-zA-Z0-9_-]/g, '');
  return sanitized || 'unknown';
}

/**
 * Count human messages in a JSONL transcript, skipping command-messages.
 */
function countHumanMessages(transcriptPath: string): number {
  const resolved = expandHome(transcriptPath);
  if (!existsSync(resolved)) return 0;

  let count = 0;
  try {
    const content = readFileSync(resolved, 'utf-8');
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        const msg = entry.message;
        if (msg && typeof msg === 'object' && msg.role === 'user') {
          const contentVal = msg.content;
          if (typeof contentVal === 'string') {
            if (contentVal.includes('<command-message>')) continue;
          } else if (Array.isArray(contentVal)) {
            const text = (contentVal as unknown[])
              .filter((b): b is Record<string, unknown> => typeof b === 'object' && b !== null)
              .map((b) => String(b.text ?? ''))
              .join(' ');
            if (text.includes('<command-message>')) continue;
          }
          count++;
        }
      } catch {
        // skip malformed lines
      }
    }
  } catch {
    return 0;
  }
  return count;
}

function hookLog(message: string): void {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    const logPath = join(STATE_DIR, 'hook.log');
    const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
    appendFileSync(logPath, `[${timestamp}] ${message}\n`);
  } catch {
    // best effort
  }
}

export interface HookOutput {
  decision?: 'block';
  reason?: string;
}

export type HookName = 'session-start' | 'stop' | 'precompact';
export type HarnessName = 'claude-code' | 'codex';

const SUPPORTED_HARNESSES = new Set<HarnessName>(['claude-code', 'codex']);

interface ParsedInput {
  sessionId: string;
  stopHookActive: boolean;
  transcriptPath: string;
}

function parseHarnessInput(data: Record<string, unknown>, harness: HarnessName): ParsedInput {
  if (!SUPPORTED_HARNESSES.has(harness)) {
    throw new Error(`Unknown harness: ${harness}`);
  }
  return {
    sessionId: sanitizeSessionId(String(data.session_id ?? 'unknown')),
    stopHookActive: Boolean(data.stop_hook_active),
    transcriptPath: String(data.transcript_path ?? ''),
  };
}

function maybeAutoIngest(): void {
  const mempalDir = process.env.MEMPAL_DIR ?? '';
  if (mempalDir && existsSync(mempalDir)) {
    try {
      const child = spawn(process.execPath, ['-e', `import("@mempalace-ts/cli")`], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
    } catch {
      // best effort
    }
  }
}

/**
 * Stop hook: block every N messages for auto-save.
 *
 * Python: hooks_cli.py hook_stop(data, harness)
 */
export function hookStop(data: Record<string, unknown>, harness: HarnessName): HookOutput {
  const parsed = parseHarnessInput(data, harness);

  // If already in a save cycle, let through (infinite-loop prevention)
  if (parsed.stopHookActive) return {};

  const exchangeCount = countHumanMessages(parsed.transcriptPath);

  // Track last save point
  mkdirSync(STATE_DIR, { recursive: true });
  const lastSaveFile = join(STATE_DIR, `${parsed.sessionId}_last_save`);
  let lastSave = 0;
  if (existsSync(lastSaveFile)) {
    try {
      lastSave = parseInt(readFileSync(lastSaveFile, 'utf-8').trim(), 10) || 0;
    } catch {
      lastSave = 0;
    }
  }

  const sinceLast = exchangeCount - lastSave;

  hookLog(`Session ${parsed.sessionId}: ${exchangeCount} exchanges, ${sinceLast} since last save`);

  if (sinceLast >= SAVE_INTERVAL && exchangeCount > 0) {
    try {
      writeFileSync(lastSaveFile, String(exchangeCount));
    } catch {
      // best effort
    }

    hookLog(`TRIGGERING SAVE at exchange ${exchangeCount}`);
    maybeAutoIngest();

    return { decision: 'block', reason: STOP_BLOCK_REASON };
  }

  return {};
}

/**
 * Session start hook: initialize session tracking state.
 *
 * Python: hooks_cli.py hook_session_start(data, harness)
 */
export function hookSessionStart(data: Record<string, unknown>, harness: HarnessName): HookOutput {
  const parsed = parseHarnessInput(data, harness);
  hookLog(`SESSION START for session ${parsed.sessionId}`);
  mkdirSync(STATE_DIR, { recursive: true });
  return {};
}

/**
 * Precompact hook: always block with comprehensive save instruction.
 *
 * Python: hooks_cli.py hook_precompact(data, harness)
 */
export function hookPrecompact(data: Record<string, unknown>, harness: HarnessName): HookOutput {
  const parsed = parseHarnessInput(data, harness);
  hookLog(`PRE-COMPACT triggered for session ${parsed.sessionId}`);
  return { decision: 'block', reason: PRECOMPACT_BLOCK_REASON };
}

/**
 * Main entry point: dispatch to hook handler.
 *
 * Python: hooks_cli.py run_hook(hook_name, harness)
 */
export function runHook(
  hookName: HookName,
  harness: HarnessName,
  data: Record<string, unknown>,
): HookOutput {
  const hooks: Record<HookName, (d: Record<string, unknown>, h: HarnessName) => HookOutput> = {
    'session-start': hookSessionStart,
    stop: hookStop,
    precompact: hookPrecompact,
  };

  const handler = hooks[hookName];
  if (!handler) {
    throw new Error(`Unknown hook: ${hookName}`);
  }

  return handler(data, harness);
}
