/**
 * Hooks tests -- parity with original test_hooks_cli.py.
 *
 * Tests:
 *   - hookStop: passthrough when stop_hook_active
 *   - hookStop: passthrough when message count < SAVE_INTERVAL
 *   - hookStop: blocks at SAVE_INTERVAL
 *   - hookStop: tracks save point (no double-block)
 *   - hookSessionStart: always returns {}
 *   - hookPrecompact: always blocks
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { hookStop, hookSessionStart, hookPrecompact } from '../src/hooks.js';
import type { HarnessName } from '../src/hooks.js';

const SAVE_INTERVAL = 15;

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mempalace-test-hooks-'));
}

/** Generate a unique session ID to avoid state file collisions between test runs. */
function uniqueSessionId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

/**
 * Write a JSONL transcript file with the specified number of human messages.
 */
function writeTranscript(filePath: string, humanMessageCount: number): void {
  const lines: string[] = [];
  for (let i = 0; i < humanMessageCount; i++) {
    lines.push(JSON.stringify({
      message: { role: 'user', content: `Message ${i + 1}` },
    }));
    lines.push(JSON.stringify({
      message: { role: 'assistant', content: `Response ${i + 1}` },
    }));
  }
  fs.writeFileSync(filePath, lines.join('\n'));
}

describe('hooks', () => {
  let tmpDir: string;
  let origHome: string | undefined;
  const harness: HarnessName = 'claude-code';

  beforeEach(() => {
    tmpDir = makeTmpDir();
    origHome = process.env.HOME;
    process.env.HOME = tmpDir;
  });

  afterEach(() => {
    if (origHome !== undefined) {
      process.env.HOME = origHome;
    } else {
      delete process.env.HOME;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('hookStop', () => {
    it('should passthrough when stop_hook_active is true', () => {
      const sid = uniqueSessionId('active');
      const result = hookStop(
        { session_id: sid, stop_hook_active: true, transcript_path: '' },
        harness,
      );
      expect(result).toEqual({});
    });

    it('should passthrough when message count is below SAVE_INTERVAL', () => {
      const sid = uniqueSessionId('below');
      const transcriptPath = path.join(tmpDir, 'transcript-below.jsonl');
      writeTranscript(transcriptPath, SAVE_INTERVAL - 1);

      const result = hookStop(
        { session_id: sid, transcript_path: transcriptPath },
        harness,
      );
      expect(result).toEqual({});
    });

    it('should block at SAVE_INTERVAL messages', () => {
      const sid = uniqueSessionId('at-interval');
      const transcriptPath = path.join(tmpDir, 'transcript-block.jsonl');
      writeTranscript(transcriptPath, SAVE_INTERVAL);

      const result = hookStop(
        { session_id: sid, transcript_path: transcriptPath },
        harness,
      );
      expect(result).toHaveProperty('decision', 'block');
      expect(result).toHaveProperty('reason');
    });

    it('should not block again at same count (tracks save point)', () => {
      const sid = uniqueSessionId('double');
      const transcriptPath = path.join(tmpDir, 'transcript-double.jsonl');
      writeTranscript(transcriptPath, SAVE_INTERVAL);

      // First call triggers block
      const first = hookStop(
        { session_id: sid, transcript_path: transcriptPath },
        harness,
      );
      expect(first).toHaveProperty('decision', 'block');

      // Second call with same count should pass through
      const second = hookStop(
        { session_id: sid, transcript_path: transcriptPath },
        harness,
      );
      expect(second).toEqual({});
    });

    it('should passthrough when transcript file does not exist', () => {
      const sid = uniqueSessionId('nofile');
      const result = hookStop(
        { session_id: sid, transcript_path: '/nonexistent/path.jsonl' },
        harness,
      );
      expect(result).toEqual({});
    });
  });

  describe('hookSessionStart', () => {
    it('should always return empty object', () => {
      const result = hookSessionStart(
        { session_id: 'test-session-start' },
        harness,
      );
      expect(result).toEqual({});
    });
  });

  describe('hookPrecompact', () => {
    it('should always block with a reason', () => {
      const result = hookPrecompact(
        { session_id: 'test-precompact' },
        harness,
      );
      expect(result).toHaveProperty('decision', 'block');
      expect(result).toHaveProperty('reason');
      expect(typeof result.reason).toBe('string');
      expect(result.reason!.length).toBeGreaterThan(0);
    });
  });
});
