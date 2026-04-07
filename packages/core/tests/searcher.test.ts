/**
 * Searcher tests -- parity with original test_searcher.py.
 *
 * Tests:
 *   - searchMemories passes through options correctly
 *   - wing/room filters are forwarded to searchDrawers
 *   - results are structured correctly
 *
 * Since ChromaDB requires a server, we mock the chroma module.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../src/chroma.js', () => ({
  getCollection: vi.fn(),
  searchDrawers: vi.fn(),
}));

import { searchMemories } from '../src/searcher.js';
import { getCollection, searchDrawers } from '../src/chroma.js';

const mockGetCollection = vi.mocked(getCollection);
const mockSearchDrawers = vi.mocked(searchDrawers);

describe('searchMemories', () => {
  const fakeCollection = { name: 'test-collection' };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCollection.mockResolvedValue(fakeCollection as any);
  });

  it('should pass query through to searchDrawers', async () => {
    mockSearchDrawers.mockResolvedValue([]);

    const result = await searchMemories({ query: 'test query' });

    expect(mockSearchDrawers).toHaveBeenCalledWith(
      fakeCollection,
      'test query',
      undefined,
      undefined,
      5,
    );
    expect(result.query).toBe('test query');
  });

  it('should forward wing filter to searchDrawers', async () => {
    mockSearchDrawers.mockResolvedValue([]);

    await searchMemories({ query: 'test', wing: 'wing_app' });

    expect(mockSearchDrawers).toHaveBeenCalledWith(
      fakeCollection,
      'test',
      'wing_app',
      undefined,
      5,
    );
  });

  it('should forward room filter to searchDrawers', async () => {
    mockSearchDrawers.mockResolvedValue([]);

    await searchMemories({ query: 'test', room: 'auth' });

    expect(mockSearchDrawers).toHaveBeenCalledWith(
      fakeCollection,
      'test',
      undefined,
      'auth',
      5,
    );
  });

  it('should forward both wing and room filters', async () => {
    mockSearchDrawers.mockResolvedValue([]);

    await searchMemories({ query: 'test', wing: 'wing_app', room: 'auth' });

    expect(mockSearchDrawers).toHaveBeenCalledWith(
      fakeCollection,
      'test',
      'wing_app',
      'auth',
      5,
    );
  });

  it('should forward custom nResults', async () => {
    mockSearchDrawers.mockResolvedValue([]);

    await searchMemories({ query: 'test', nResults: 10 });

    expect(mockSearchDrawers).toHaveBeenCalledWith(
      fakeCollection,
      'test',
      undefined,
      undefined,
      10,
    );
  });

  it('should forward collectionName to getCollection', async () => {
    mockSearchDrawers.mockResolvedValue([]);

    await searchMemories({ query: 'test', collectionName: 'custom_collection' });

    expect(mockGetCollection).toHaveBeenCalledWith('custom_collection');
  });

  it('should return structured results', async () => {
    const mockResults = [
      {
        text: 'Some memory content',
        wing: 'wing_app',
        room: 'auth',
        source_file: '/path/to/file.ts',
        similarity: 0.95,
      },
    ];
    mockSearchDrawers.mockResolvedValue(mockResults);

    const result = await searchMemories({ query: 'auth memory' });

    expect(result).toHaveProperty('query', 'auth memory');
    expect(result).toHaveProperty('filters');
    expect(result).toHaveProperty('results');
    expect(result.results).toHaveLength(1);
    expect(result.results[0].text).toBe('Some memory content');
    expect(result.results[0].wing).toBe('wing_app');
    expect(result.results[0].room).toBe('auth');
    expect(result.results[0].similarity).toBe(0.95);
  });

  it('should include filters in response', async () => {
    mockSearchDrawers.mockResolvedValue([]);

    const result = await searchMemories({
      query: 'test',
      wing: 'wing_app',
      room: 'auth',
    });

    expect(result.filters).toEqual({ wing: 'wing_app', room: 'auth' });
  });

  it('should return empty results when no matches', async () => {
    mockSearchDrawers.mockResolvedValue([]);

    const result = await searchMemories({ query: 'nonexistent' });

    expect(result.results).toHaveLength(0);
  });
});
