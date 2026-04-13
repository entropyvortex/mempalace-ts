/**
 * Layers tests -- parity with original test_layers.py.
 *
 * Tests Layer0-Layer3 and MemoryStack.
 * Layer0 uses real filesystem; Layer1-Layer3 mock ChromaDB.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Mock chroma module before importing layers
vi.mock('../src/chroma.js', () => ({
  getCollection: vi.fn(),
  getDrawers: vi.fn(),
  searchDrawers: vi.fn(),
  drawerCount: vi.fn(),
  INCLUDE_METADATAS: 'metadatas',
  INCLUDE_DOCUMENTS: 'documents',
  INCLUDE_DISTANCES: 'distances',
}));

import { Layer0, Layer1, Layer2, Layer3, MemoryStack } from '../src/layers.js';
import { getCollection, getDrawers, searchDrawers } from '../src/chroma.js';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mempalace-test-layers-'));
}

// ─── Layer0 — Identity ──────────────────────────────────────────────────

describe('Layer0', () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const d of tmpDirs) {
      fs.rmSync(d, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  it('should read identity file content', () => {
    const tmpDir = makeTmpDir();
    tmpDirs.push(tmpDir);
    const identityFile = path.join(tmpDir, 'identity.txt');
    fs.writeFileSync(identityFile, 'I am Atlas, a personal AI assistant for Alice.');

    const layer = new Layer0(identityFile);
    const text = layer.render();

    expect(text).toContain('Atlas');
    expect(text).toContain('Alice');
  });

  it('should return default text when identity file is missing', () => {
    const tmpDir = makeTmpDir();
    tmpDirs.push(tmpDir);
    const missingFile = path.join(tmpDir, 'nonexistent.txt');

    const layer = new Layer0(missingFile);
    const text = layer.render();

    expect(text).toContain('No identity configured');
    expect(text).toContain('identity.txt');
  });

  it('should estimate tokens as ceil(length / 4)', () => {
    const tmpDir = makeTmpDir();
    tmpDirs.push(tmpDir);
    const identityFile = path.join(tmpDir, 'identity.txt');
    fs.writeFileSync(identityFile, 'A'.repeat(400));

    const layer = new Layer0(identityFile);
    expect(layer.tokenEstimate()).toBe(100);
  });

  it('should strip whitespace from identity text', () => {
    const tmpDir = makeTmpDir();
    tmpDirs.push(tmpDir);
    const identityFile = path.join(tmpDir, 'identity.txt');
    fs.writeFileSync(identityFile, '  Hello world  \n\n');

    const layer = new Layer0(identityFile);
    expect(layer.render()).toBe('Hello world');
  });

  it('should have token estimate > 0 for default text', () => {
    const tmpDir = makeTmpDir();
    tmpDirs.push(tmpDir);
    const missingFile = path.join(tmpDir, 'nonexistent.txt');

    const layer = new Layer0(missingFile);
    expect(layer.tokenEstimate()).toBeGreaterThan(0);
  });
});

// ─── Layer1 — Essential Story ───────────────────────────────────────────

describe('Layer1', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should return "No memories" when palace is empty', async () => {
    const mockCol = {};
    vi.mocked(getCollection).mockResolvedValue(mockCol as never);
    vi.mocked(getDrawers).mockResolvedValue([] as never);

    const layer = new Layer1('/fake/path');
    const result = await layer.generate();

    expect(result).toContain('No memories');
  });

  it('should generate essential context from drawers', async () => {
    const mockCol = {};
    vi.mocked(getCollection).mockResolvedValue(mockCol as never);
    vi.mocked(getDrawers).mockResolvedValue([
      {
        id: 'd1',
        content: 'Important memory about project decisions',
        metadata: { room: 'decisions', wing: 'work', source_file: 'meeting.txt' },
      },
      {
        id: 'd2',
        content: 'Key architectural choice for the backend',
        metadata: { room: 'architecture', wing: 'work', source_file: 'design.txt' },
      },
    ] as never);

    const layer = new Layer1('/fake/path');
    const result = await layer.generate();

    expect(result).toContain('Essential Context');
    expect(result).toContain('project decisions');
  });

  it('should group drawers by room', async () => {
    const mockCol = {};
    vi.mocked(getCollection).mockResolvedValue(mockCol as never);
    vi.mocked(getDrawers).mockResolvedValue([
      {
        id: 'd1',
        content: 'Memory in room A',
        metadata: { room: 'room_a', wing: 'work' },
      },
      {
        id: 'd2',
        content: 'Memory in room B',
        metadata: { room: 'room_b', wing: 'work' },
      },
    ] as never);

    const layer = new Layer1('/fake/path');
    const result = await layer.generate();

    expect(result).toContain('room_a');
    expect(result).toContain('room_b');
  });

  it('should truncate long drawer content to 200 chars', async () => {
    const longContent = 'X'.repeat(400);
    const mockCol = {};
    vi.mocked(getCollection).mockResolvedValue(mockCol as never);
    vi.mocked(getDrawers).mockResolvedValue([
      {
        id: 'd1',
        content: longContent,
        metadata: { room: 'general', wing: 'work' },
      },
    ] as never);

    const layer = new Layer1('/fake/path');
    const result = await layer.generate();

    // The content in the output should be at most 200 chars per entry
    const lines = result.split('\n').filter((l) => l.startsWith('- '));
    for (const line of lines) {
      // "- " prefix + up to 200 chars of content
      expect(line.length).toBeLessThanOrEqual(202);
    }
  });
});

// ─── Layer2 — On-Demand ─────────────────────────────────────────────────

describe('Layer2', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should return "No memories found" when no drawers match', async () => {
    const mockCol = {};
    vi.mocked(getCollection).mockResolvedValue(mockCol as never);
    vi.mocked(getDrawers).mockResolvedValue([] as never);

    const layer = new Layer2();
    const result = await layer.retrieve('nonexistent');

    expect(result).toContain('No memories found');
  });

  it('should retrieve drawers with wing/room context', async () => {
    const mockCol = {};
    vi.mocked(getCollection).mockResolvedValue(mockCol as never);
    vi.mocked(getDrawers).mockResolvedValue([
      {
        id: 'd1',
        content: 'Some memory about the project',
        metadata: { wing: 'project', room: 'backend', source_file: 'notes.txt' },
      },
    ] as never);

    const layer = new Layer2();
    const result = await layer.retrieve('project');

    expect(result).toContain('project');
    expect(result).toContain('backend');
    expect(result).toContain('memory about the project');
  });

  it('should truncate long content to 300 chars', async () => {
    const longContent = 'Y'.repeat(500);
    const mockCol = {};
    vi.mocked(getCollection).mockResolvedValue(mockCol as never);
    vi.mocked(getDrawers).mockResolvedValue([
      {
        id: 'd1',
        content: longContent,
        metadata: { wing: 'work', room: 'general' },
      },
    ] as never);

    const layer = new Layer2();
    const result = await layer.retrieve('work');

    // Output should not contain the full 500-char string
    expect(result.length).toBeLessThan(500);
  });
});

// ─── Layer3 — Deep Search ───────────────────────────────────────────────

describe('Layer3', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should return "No results found" for empty search', async () => {
    const mockCol = {};
    vi.mocked(getCollection).mockResolvedValue(mockCol as never);
    vi.mocked(searchDrawers).mockResolvedValue([] as never);

    const layer = new Layer3();
    const result = await layer.search('nothing');

    expect(result).toContain('No results found');
  });

  it('should format search results with similarity', async () => {
    const mockCol = {};
    vi.mocked(getCollection).mockResolvedValue(mockCol as never);
    vi.mocked(searchDrawers).mockResolvedValue([
      {
        text: 'Found this important memory',
        wing: 'project',
        room: 'backend',
        similarity: 0.85,
        metadata: { source_file: 'notes.txt' },
      },
    ] as never);

    const layer = new Layer3();
    const result = await layer.search('important');

    expect(result).toContain('project');
    expect(result).toContain('backend');
    expect(result).toContain('85.0%');
    expect(result).toContain('important memory');
  });

  it('should return structured results from searchRaw', async () => {
    const mockCol = {};
    vi.mocked(getCollection).mockResolvedValue(mockCol as never);
    vi.mocked(searchDrawers).mockResolvedValue([
      {
        text: 'doc text',
        wing: 'proj',
        room: 'backend',
        similarity: 0.7,
        metadata: { source_file: 'f.txt' },
      },
    ] as never);

    const layer = new Layer3();
    const results = await layer.searchRaw('query');

    expect(results).toHaveLength(1);
    expect(results[0].text).toBe('doc text');
    expect(results[0].wing).toBe('proj');
    expect(results[0].similarity).toBe(0.7);
  });

  it('searchRaw should return empty array when no results', async () => {
    const mockCol = {};
    vi.mocked(getCollection).mockResolvedValue(mockCol as never);
    vi.mocked(searchDrawers).mockResolvedValue([] as never);

    const layer = new Layer3();
    const results = await layer.searchRaw('nothing');

    expect(results).toEqual([]);
  });
});

// ─── MemoryStack ────────────────────────────────────────────────────────

describe('MemoryStack', () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const d of tmpDirs) {
      fs.rmSync(d, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
    vi.restoreAllMocks();
  });

  it('should wake up with identity and essential story', async () => {
    const tmpDir = makeTmpDir();
    tmpDirs.push(tmpDir);
    const identityFile = path.join(tmpDir, 'identity.txt');
    fs.writeFileSync(identityFile, 'I am Atlas.');

    const mockCol = { count: vi.fn().mockResolvedValue(0) };
    vi.mocked(getCollection).mockResolvedValue(mockCol as never);
    vi.mocked(getDrawers).mockResolvedValue([] as never);

    const stack = new MemoryStack('/fake/palace', identityFile);
    const result = await stack.wakeUp();

    expect(result).toContain('Atlas');
    expect(result).toContain('No memories');
  });

  it('should delegate recall to Layer2', async () => {
    const tmpDir = makeTmpDir();
    tmpDirs.push(tmpDir);
    const identityFile = path.join(tmpDir, 'identity.txt');
    fs.writeFileSync(identityFile, 'I am Atlas.');

    const mockCol = {};
    vi.mocked(getCollection).mockResolvedValue(mockCol as never);
    vi.mocked(getDrawers).mockResolvedValue([] as never);

    const stack = new MemoryStack('/fake/palace', identityFile);
    const result = await stack.recall('test_wing');

    expect(result).toContain('No memories found');
  });

  it('should delegate search to Layer3', async () => {
    const tmpDir = makeTmpDir();
    tmpDirs.push(tmpDir);
    const identityFile = path.join(tmpDir, 'identity.txt');
    fs.writeFileSync(identityFile, 'I am Atlas.');

    vi.mocked(getCollection).mockResolvedValue({} as never);
    vi.mocked(searchDrawers).mockResolvedValue([] as never);

    const stack = new MemoryStack('/fake/palace', identityFile);
    const result = await stack.search('test query');

    expect(result).toContain('No results found');
  });

  it('should return status with layer info', async () => {
    const tmpDir = makeTmpDir();
    tmpDirs.push(tmpDir);
    const identityFile = path.join(tmpDir, 'identity.txt');
    fs.writeFileSync(identityFile, 'I am Atlas.');

    const mockCol = { count: vi.fn().mockResolvedValue(42) };
    vi.mocked(getCollection).mockResolvedValue(mockCol as never);

    const stack = new MemoryStack('/fake/palace', identityFile);
    const status = await stack.status();

    expect(status.layer0).toBeDefined();
    expect(status.layer0.loaded).toBe(true);
    expect(status.layer0.tokens).toBeGreaterThan(0);
    expect(status.layer1).toBeDefined();
    expect(status.layer1.loaded).toBe(true);
    expect(status.layer2).toBeDefined();
    expect(status.layer2.available).toBe(true);
    expect(status.layer3).toBeDefined();
    expect(status.layer3.available).toBe(true);
  });

  it('should handle missing ChromaDB in status gracefully', async () => {
    const tmpDir = makeTmpDir();
    tmpDirs.push(tmpDir);
    const identityFile = path.join(tmpDir, 'identity.txt');
    fs.writeFileSync(identityFile, 'I am Atlas.');

    vi.mocked(getCollection).mockRejectedValue(new Error('ChromaDB not available'));

    const stack = new MemoryStack('/fake/palace', identityFile);
    const status = await stack.status();

    expect(status.layer0.loaded).toBe(true);
    expect(status.layer1.loaded).toBe(false);
    expect(status.layer2.available).toBe(false);
    expect(status.layer3.available).toBe(false);
  });

  it('wakeUp with wing should update Layer1', async () => {
    const tmpDir = makeTmpDir();
    tmpDirs.push(tmpDir);
    const identityFile = path.join(tmpDir, 'identity.txt');
    fs.writeFileSync(identityFile, 'I am Atlas.');

    vi.mocked(getCollection).mockResolvedValue({} as never);
    vi.mocked(getDrawers).mockResolvedValue([] as never);

    const stack = new MemoryStack('/fake/palace', identityFile);
    const result = await stack.wakeUp('my_project');

    expect(result).toContain('Atlas');
  });
});
