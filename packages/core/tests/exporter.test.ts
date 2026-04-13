/**
 * Exporter tests -- parity with original exporter.py.
 *
 * Tests:
 *   - _safePathComponent sanitizes special characters
 *   - exportPalace creates directory structure
 *   - exportPalace writes index.md
 *
 * Since _safePathComponent is not exported, we test its behavior
 * indirectly through exportPalace, and also test the sanitization
 * logic directly by reimporting the module.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Mock chroma module before importing exporter
vi.mock('../src/chroma.js', () => ({
  getCollection: vi.fn(),
  getDrawers: vi.fn(),
  drawerCount: vi.fn(),
  searchDrawers: vi.fn(),
  INCLUDE_METADATAS: 'metadatas',
  INCLUDE_DOCUMENTS: 'documents',
  INCLUDE_DISTANCES: 'distances',
}));

import { exportPalace } from '../src/exporter.js';
import { getCollection, getDrawers, drawerCount } from '../src/chroma.js';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mempalace-test-export-'));
}

describe('exportPalace', () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const d of tmpDirs) {
      fs.rmSync(d, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
    vi.restoreAllMocks();
  });

  it('should return zero stats for empty palace', async () => {
    const tmpDir = makeTmpDir();
    tmpDirs.push(tmpDir);
    const outputDir = path.join(tmpDir, 'export');

    const mockCol = {};
    vi.mocked(getCollection).mockResolvedValue(mockCol as never);
    vi.mocked(drawerCount).mockResolvedValue(0);

    const stats = await exportPalace({ outputDir });

    expect(stats.wings).toBe(0);
    expect(stats.rooms).toBe(0);
    expect(stats.drawers).toBe(0);
  });

  it('should create directory structure and write index.md', async () => {
    const tmpDir = makeTmpDir();
    tmpDirs.push(tmpDir);
    const outputDir = path.join(tmpDir, 'export');

    const mockCol = {};
    vi.mocked(getCollection).mockResolvedValue(mockCol as never);
    vi.mocked(drawerCount).mockResolvedValue(2);

    // Return drawers for first batch, empty for second
    vi.mocked(getDrawers)
      .mockResolvedValueOnce([
        {
          id: 'drawer_1',
          content: 'Memory about project architecture',
          metadata: {
            wing: 'projects',
            room: 'backend',
            source_file: 'notes.txt',
            filed_at: '2024-01-01',
            added_by: 'miner',
          },
        },
        {
          id: 'drawer_2',
          content: 'Memory about family dinner',
          metadata: {
            wing: 'personal',
            room: 'family',
            source_file: 'diary.txt',
            filed_at: '2024-01-02',
            added_by: 'convo_miner',
          },
        },
      ] as never)
      .mockResolvedValueOnce([] as never);

    const stats = await exportPalace({ outputDir });

    // Verify stats
    expect(stats.wings).toBe(2);
    expect(stats.rooms).toBe(2);
    expect(stats.drawers).toBe(2);

    // Verify index.md exists and has content
    const indexPath = path.join(outputDir, 'index.md');
    expect(fs.existsSync(indexPath)).toBe(true);
    const indexContent = fs.readFileSync(indexPath, 'utf-8');
    expect(indexContent).toContain('Palace Export');
    expect(indexContent).toContain('personal');
    expect(indexContent).toContain('projects');

    // Verify wing directories created
    expect(fs.existsSync(path.join(outputDir, 'projects'))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, 'personal'))).toBe(true);

    // Verify room files created
    expect(fs.existsSync(path.join(outputDir, 'projects', 'backend.md'))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, 'personal', 'family.md'))).toBe(true);
  });

  it('should sanitize special characters in wing/room names', async () => {
    const tmpDir = makeTmpDir();
    tmpDirs.push(tmpDir);
    const outputDir = path.join(tmpDir, 'export');

    const mockCol = {};
    vi.mocked(getCollection).mockResolvedValue(mockCol as never);
    vi.mocked(drawerCount).mockResolvedValue(1);

    vi.mocked(getDrawers)
      .mockResolvedValueOnce([
        {
          id: 'drawer_1',
          content: 'Test content',
          metadata: {
            wing: 'my/special:wing',
            room: 'room*with"chars',
            source_file: 'test.txt',
            filed_at: '2024-01-01',
            added_by: 'miner',
          },
        },
      ] as never)
      .mockResolvedValueOnce([] as never);

    const stats = await exportPalace({ outputDir });

    expect(stats.drawers).toBe(1);

    // Special chars should be replaced with underscores
    const sanitizedWing = 'my_special_wing';
    const sanitizedRoom = 'room_with_chars';
    expect(fs.existsSync(path.join(outputDir, sanitizedWing))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, sanitizedWing, `${sanitizedRoom}.md`))).toBe(true);
  });

  it('should write room file content with drawer info', async () => {
    const tmpDir = makeTmpDir();
    tmpDirs.push(tmpDir);
    const outputDir = path.join(tmpDir, 'export');

    const mockCol = {};
    vi.mocked(getCollection).mockResolvedValue(mockCol as never);
    vi.mocked(drawerCount).mockResolvedValue(1);

    vi.mocked(getDrawers)
      .mockResolvedValueOnce([
        {
          id: 'drawer_abc',
          content: 'Important project decision about API design',
          metadata: {
            wing: 'work',
            room: 'decisions',
            source_file: 'meeting_notes.txt',
            filed_at: '2024-03-15',
            added_by: 'miner',
          },
        },
      ] as never)
      .mockResolvedValueOnce([] as never);

    await exportPalace({ outputDir });

    const roomPath = path.join(outputDir, 'work', 'decisions.md');
    const content = fs.readFileSync(roomPath, 'utf-8');
    expect(content).toContain('drawer_abc');
    expect(content).toContain('API design');
    expect(content).toContain('meeting_notes.txt');
  });
});
