/**
 * @module layers
 * 4-layer memory stack: L0 (Identity), L1 (Essential Story),
 * L2 (On-Demand), L3 (Deep Search).
 *
 * 1:1 PORT from original layers.py
 *
 * Maps directly to:
 *   Python classes: Layer0, Layer1, Layer2, Layer3, MemoryStack
 *   Python file:    layers.py
 *
 * Wake-up cost: ~600-900 tokens (L0 + L1)
 *   Layer 0: ~100 tokens — "Who am I?" identity
 *   Layer 1: ~500-800 tokens — top 15 drawers by importance
 *   Layer 2: ~200-500 tokens per call — wing/room filtered retrieval
 *   Layer 3: unlimited — full semantic search
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolvePath } from './utils/paths.js';
import { getCollection, getDrawers, searchDrawers } from './chroma.js';
import {
  DEFAULT_IDENTITY_PATH,
  DEFAULT_PALACE_PATH,
  DEFAULT_COLLECTION_NAME,
  L1_MAX_DRAWERS,
  L1_MAX_CHARS,
} from './types.js';
import type { StackStatus, SearchResult } from './types.js';

/**
 * Layer 0: Identity — "Who am I?"
 *
 * 1:1 PORT from layers.py Layer0 class.
 * Python: class Layer0:
 *   def __init__(self, identity_path=None)
 *   def render() -> str
 *   def token_estimate() -> int
 *
 * Reads a plain text identity file (~100 tokens).
 * Example content:
 *   "I am Atlas, personal AI for Alice. Traits: warm, direct, remembers everything."
 */
export class Layer0 {
  private identityPath: string;

  /**
   * Python: Layer0.__init__(self, identity_path=None)
   */
  constructor(identityPath: string = DEFAULT_IDENTITY_PATH) {
    this.identityPath = resolvePath(identityPath);
  }

  /**
   * Render the identity text.
   *
   * Python: Layer0.render(self) -> str
   * Returns default text if identity file doesn't exist.
   */
  render(): string {
    if (existsSync(this.identityPath)) {
      return readFileSync(this.identityPath, 'utf-8').trim();
    }
    return 'No identity configured. Create ~/.mempalace/identity.txt to set your agent identity.';
  }

  /**
   * Estimate token count for this layer.
   *
   * Python: Layer0.token_estimate(self) -> int
   */
  tokenEstimate(): number {
    return Math.ceil(this.render().length / 4);
  }
}

/**
 * Layer 1: Essential Story — auto-generated from top drawers.
 *
 * 1:1 PORT from layers.py Layer1 class.
 * Python: class Layer1:
 *   MAX_DRAWERS = 15
 *   MAX_CHARS = 3200
 *   def __init__(self, palace_path=None, wing=None)
 *   def generate() -> str
 *
 * Retrieves the top 15 drawers (by importance/recency), groups by room,
 * and generates a compact context block (~500-800 tokens).
 */
export class Layer1 {
  private palacePath: string;
  private wing: string | undefined;
  private collectionName: string;

  /**
   * Python: Layer1.__init__(self, palace_path=None, wing=None)
   */
  constructor(
    palacePath: string = DEFAULT_PALACE_PATH,
    wing?: string,
    collectionName: string = DEFAULT_COLLECTION_NAME,
  ) {
    this.palacePath = resolvePath(palacePath);
    this.wing = wing;
    this.collectionName = collectionName;
  }

  /**
   * Generate Layer 1 context from top drawers.
   *
   * Python: Layer1.generate(self) -> str
   *
   * Algorithm:
   *   1. Get drawers (optionally filtered by wing)
   *   2. Take top MAX_DRAWERS
   *   3. Group by room
   *   4. Build compact text block, truncating at MAX_CHARS
   */
  async generate(): Promise<string> {
    const collection = await getCollection(this.collectionName);
    const drawers = await getDrawers(collection, this.wing, undefined, L1_MAX_DRAWERS);

    if (drawers.length === 0) {
      return 'No memories stored yet.';
    }

    // Group by room
    const byRoom = new Map<string, string[]>();
    for (const d of drawers) {
      const room = String(d.metadata.room ?? 'general');
      const existing = byRoom.get(room) ?? [];
      existing.push(d.content);
      byRoom.set(room, existing);
    }

    // Build output
    const lines: string[] = ['## Essential Context'];
    let totalChars = 0;

    for (const [room, contents] of byRoom) {
      const roomHeader = `\n### ${room}`;
      lines.push(roomHeader);
      totalChars += roomHeader.length;

      for (const content of contents) {
        if (totalChars + content.length > L1_MAX_CHARS) break;
        lines.push(`- ${content.slice(0, 200)}`);
        totalChars += Math.min(content.length, 200);
      }

      if (totalChars >= L1_MAX_CHARS) break;
    }

    return lines.join('\n');
  }
}

/**
 * Layer 2: On-Demand — wing/room filtered retrieval.
 *
 * 1:1 PORT from layers.py Layer2 class.
 * Python: class Layer2:
 *   def __init__(self, palace_path=None)
 *   def retrieve(wing=None, room=None, n_results=10) -> str
 *
 * Called when a specific topic comes up. Returns ~200-500 tokens.
 */
export class Layer2 {
  private collectionName: string;

  /**
   * Python: Layer2.__init__(self, palace_path=None)
   */
  constructor(collectionName: string = DEFAULT_COLLECTION_NAME) {
    this.collectionName = collectionName;
  }

  /**
   * Retrieve memories filtered by wing and/or room.
   *
   * Python: Layer2.retrieve(self, wing=None, room=None, n_results=10) -> str
   */
  async retrieve(wing?: string, room?: string, nResults: number = 10): Promise<string> {
    const collection = await getCollection(this.collectionName);
    const drawers = await getDrawers(collection, wing, room, nResults);

    if (drawers.length === 0) {
      return 'No memories found for this context.';
    }

    const lines = drawers.map((d) => {
      const meta = d.metadata;
      return `[${meta.wing}/${meta.room}] ${d.content.slice(0, 300)}`;
    });

    return lines.join('\n\n');
  }
}

/**
 * Layer 3: Deep Search — full semantic search via ChromaDB.
 *
 * 1:1 PORT from layers.py Layer3 class.
 * Python: class Layer3:
 *   def __init__(self, palace_path=None)
 *   def search(query, wing=None, room=None, n_results=5) -> str
 *   def search_raw(...) -> list
 */
export class Layer3 {
  private collectionName: string;

  /**
   * Python: Layer3.__init__(self, palace_path=None)
   */
  constructor(collectionName: string = DEFAULT_COLLECTION_NAME) {
    this.collectionName = collectionName;
  }

  /**
   * Semantic search with optional filters.
   *
   * Python: Layer3.search(self, query, wing=None, room=None, n_results=5) -> str
   */
  async search(
    query: string,
    wing?: string,
    room?: string,
    nResults: number = 5,
  ): Promise<string> {
    const results = await this.searchRaw(query, wing, room, nResults);

    if (results.length === 0) {
      return 'No results found.';
    }

    return results
      .map((r) => `[${r.wing}/${r.room}] (${(r.similarity * 100).toFixed(1)}%) ${r.text.slice(0, 300)}`)
      .join('\n\n');
  }

  /**
   * Raw search returning structured results.
   *
   * Python: Layer3.search_raw(self, query, wing=None, room=None, n_results=5) -> list
   */
  async searchRaw(
    query: string,
    wing?: string,
    room?: string,
    nResults: number = 5,
  ): Promise<SearchResult[]> {
    const collection = await getCollection(this.collectionName);
    return searchDrawers(collection, query, wing, room, nResults);
  }
}

/**
 * Complete memory stack combining all 4 layers.
 *
 * 1:1 PORT from layers.py MemoryStack class.
 * Python: class MemoryStack:
 *   def __init__(self, palace_path=None, identity_path=None)
 *   def wake_up(wing=None) -> str
 *   def recall(wing=None, room=None, n_results=10) -> str
 *   def search(query, wing=None, room=None, n_results=5) -> str
 *   def status() -> dict
 */
export class MemoryStack {
  private layer0: Layer0;
  private layer1: Layer1;
  private layer2: Layer2;
  private layer3: Layer3;
  private collectionName: string;

  /**
   * Python: MemoryStack.__init__(self, palace_path=None, identity_path=None)
   */
  constructor(
    palacePath: string = DEFAULT_PALACE_PATH,
    identityPath: string = DEFAULT_IDENTITY_PATH,
    collectionName: string = DEFAULT_COLLECTION_NAME,
  ) {
    this.collectionName = collectionName;
    this.layer0 = new Layer0(identityPath);
    this.layer1 = new Layer1(palacePath, undefined, collectionName);
    this.layer2 = new Layer2(collectionName);
    this.layer3 = new Layer3(collectionName);
  }

  /**
   * Wake up: Load L0 (identity) + L1 (essential story).
   *
   * Python: MemoryStack.wake_up(self, wing=None) -> str
   * Cost: ~600-900 tokens
   */
  async wakeUp(wing?: string): Promise<string> {
    if (wing) {
      this.layer1 = new Layer1(DEFAULT_PALACE_PATH, wing, this.collectionName);
    }

    const identity = this.layer0.render();
    const essential = await this.layer1.generate();

    return `${identity}\n\n${essential}`;
  }

  /**
   * Recall: On-demand retrieval (L2).
   *
   * Python: MemoryStack.recall(self, wing=None, room=None, n_results=10) -> str
   */
  async recall(wing?: string, room?: string, nResults: number = 10): Promise<string> {
    return this.layer2.retrieve(wing, room, nResults);
  }

  /**
   * Search: Deep semantic search (L3).
   *
   * Python: MemoryStack.search(self, query, wing=None, room=None, n_results=5) -> str
   */
  async search(
    query: string,
    wing?: string,
    room?: string,
    nResults: number = 5,
  ): Promise<string> {
    return this.layer3.search(query, wing, room, nResults);
  }

  /**
   * Get memory stack status.
   *
   * Python: MemoryStack.status(self) -> dict
   */
  async status(): Promise<StackStatus> {
    const l0Text = this.layer0.render();
    let drawerCount = 0;
    try {
      const collection = await getCollection(this.collectionName);
      drawerCount = await collection.count();
    } catch {
      // ChromaDB not available
    }

    return {
      layer0: {
        loaded: l0Text !== '',
        tokens: this.layer0.tokenEstimate(),
      },
      layer1: {
        loaded: drawerCount > 0,
        tokens: 0, // Calculated on generate()
        drawer_count: Math.min(drawerCount, L1_MAX_DRAWERS),
      },
      layer2: { available: drawerCount > 0 },
      layer3: { available: drawerCount > 0 },
    };
  }
}
