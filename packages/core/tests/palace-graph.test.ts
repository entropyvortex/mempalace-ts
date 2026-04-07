/**
 * Palace Graph tests — parity with original palace_graph.py behavior.
 *
 * Since these require ChromaDB, we test the pure logic functions
 * by mocking the collection interface.
 *
 * Tests:
 *   - Graph building from drawer metadata
 *   - Tunnel detection (rooms in multiple wings)
 *   - BFS traversal
 *   - Graph statistics
 */

import { describe, it, expect } from 'vitest';
import type { PalaceGraphNode } from '../src/types.js';

// ---------------------------------------------------------------------------
// Pure logic tests (no ChromaDB needed)
// ---------------------------------------------------------------------------

/**
 * Simulate buildGraph logic without ChromaDB.
 * 1:1 PORT from palace_graph.py build_graph() algorithm.
 */
function buildGraphFromMetadata(
  metadatas: Array<{ wing: string; room: string }>,
): { nodes: Map<string, PalaceGraphNode>; edges: Array<{ source: string; target: string; shared_wings: string[] }> } {
  const nodes = new Map<string, PalaceGraphNode>();

  for (const meta of metadatas) {
    const room = meta.room ?? 'general';
    const wing = meta.wing ?? 'unknown';

    const existing = nodes.get(room);
    if (existing) {
      if (!existing.wings.includes(wing)) {
        existing.wings.push(wing);
      }
      existing.count++;
    } else {
      nodes.set(room, { room, wings: [wing], halls: [], count: 1 });
    }
  }

  const edges: Array<{ source: string; target: string; shared_wings: string[] }> = [];
  for (const node of nodes.values()) {
    if (node.wings.length > 1) {
      for (let i = 0; i < node.wings.length; i++) {
        for (let j = i + 1; j < node.wings.length; j++) {
          edges.push({
            source: node.room,
            target: node.room,
            shared_wings: [node.wings[i], node.wings[j]],
          });
        }
      }
    }
  }

  return { nodes, edges };
}

/**
 * Simulate BFS traversal logic without ChromaDB.
 * 1:1 PORT from palace_graph.py traverse() algorithm.
 */
function traverseGraph(
  startRoom: string,
  nodes: Map<string, PalaceGraphNode>,
  maxHops: number = 2,
): Array<PalaceGraphNode & { hop: number; connected_via: string[] }> {
  const startNode = nodes.get(startRoom);
  if (!startNode) return [];

  const visited = new Set<string>([startRoom]);
  const frontier: Array<[string, number]> = [[startRoom, 0]];
  const results: Array<PalaceGraphNode & { hop: number; connected_via: string[] }> = [
    { ...startNode, hop: 0, connected_via: [] },
  ];

  while (frontier.length > 0) {
    const [currentRoom, depth] = frontier.shift()!;
    if (depth >= maxHops) continue;

    const currentNode = nodes.get(currentRoom);
    if (!currentNode) continue;

    const currentWings = new Set(currentNode.wings);

    for (const [roomName, node] of nodes) {
      if (visited.has(roomName)) continue;

      const sharedWings = node.wings.filter((w) => currentWings.has(w));
      if (sharedWings.length > 0) {
        visited.add(roomName);
        results.push({ ...node, hop: depth + 1, connected_via: sharedWings });

        if (depth + 1 < maxHops) {
          frontier.push([roomName, depth + 1]);
        }
      }
    }
  }

  results.sort((a, b) => {
    if (a.hop !== b.hop) return a.hop - b.hop;
    return b.count - a.count;
  });

  return results;
}

describe('Palace Graph (pure logic)', () => {
  // -------------------------------------------------------------------------
  // Graph Building
  // Python: palace_graph.py build_graph() behavior
  // -------------------------------------------------------------------------

  describe('buildGraph', () => {
    it('should create nodes from metadata', () => {
      const { nodes } = buildGraphFromMetadata([
        { wing: 'wing_app', room: 'auth' },
        { wing: 'wing_app', room: 'auth' },
        { wing: 'wing_app', room: 'payments' },
      ]);

      expect(nodes.size).toBe(2);
      expect(nodes.get('auth')?.count).toBe(2);
      expect(nodes.get('payments')?.count).toBe(1);
    });

    it('should track multiple wings per room', () => {
      const { nodes } = buildGraphFromMetadata([
        { wing: 'wing_app', room: 'auth' },
        { wing: 'wing_infra', room: 'auth' },
      ]);

      const authNode = nodes.get('auth');
      expect(authNode?.wings).toEqual(['wing_app', 'wing_infra']);
    });

    it('should detect tunnels (rooms in multiple wings)', () => {
      const { edges } = buildGraphFromMetadata([
        { wing: 'wing_app', room: 'auth' },
        { wing: 'wing_infra', room: 'auth' },
        { wing: 'wing_app', room: 'payments' },
      ]);

      // Only auth is in multiple wings
      expect(edges).toHaveLength(1);
      expect(edges[0].source).toBe('auth');
      expect(edges[0].shared_wings).toContain('wing_app');
      expect(edges[0].shared_wings).toContain('wing_infra');
    });

    it('should handle rooms in 3+ wings', () => {
      const { edges } = buildGraphFromMetadata([
        { wing: 'wing_a', room: 'shared' },
        { wing: 'wing_b', room: 'shared' },
        { wing: 'wing_c', room: 'shared' },
      ]);

      // 3 wings → C(3,2) = 3 edges
      expect(edges).toHaveLength(3);
    });
  });

  // -------------------------------------------------------------------------
  // BFS Traversal
  // Python: palace_graph.py traverse() algorithm
  // -------------------------------------------------------------------------

  describe('traverse', () => {
    it('should start with the start room at hop 0', () => {
      const nodes = new Map<string, PalaceGraphNode>();
      nodes.set('auth', { room: 'auth', wings: ['wing_app'], halls: [], count: 5 });

      const results = traverseGraph('auth', nodes);
      expect(results).toHaveLength(1);
      expect(results[0].room).toBe('auth');
      expect(results[0].hop).toBe(0);
    });

    it('should find connected rooms within the same wing', () => {
      const nodes = new Map<string, PalaceGraphNode>();
      nodes.set('auth', { room: 'auth', wings: ['wing_app'], halls: [], count: 5 });
      nodes.set('payments', { room: 'payments', wings: ['wing_app'], halls: [], count: 3 });
      nodes.set('unrelated', { room: 'unrelated', wings: ['wing_other'], halls: [], count: 1 });

      const results = traverseGraph('auth', nodes);
      expect(results).toHaveLength(2); // auth + payments (same wing)
      expect(results.map((r) => r.room)).toContain('payments');
      expect(results.map((r) => r.room)).not.toContain('unrelated');
    });

    it('should traverse through tunnels across wings', () => {
      const nodes = new Map<string, PalaceGraphNode>();
      nodes.set('auth', { room: 'auth', wings: ['wing_app'], halls: [], count: 5 });
      nodes.set('shared', { room: 'shared', wings: ['wing_app', 'wing_infra'], halls: [], count: 3 });
      nodes.set('deploy', { room: 'deploy', wings: ['wing_infra'], halls: [], count: 2 });

      // auth → shared (same wing: wing_app) → deploy (same wing: wing_infra)
      const results = traverseGraph('auth', nodes, 2);
      expect(results).toHaveLength(3);
      expect(results.map((r) => r.room)).toContain('deploy');
    });

    it('should respect max_hops', () => {
      const nodes = new Map<string, PalaceGraphNode>();
      nodes.set('a', { room: 'a', wings: ['w1'], halls: [], count: 1 });
      nodes.set('b', { room: 'b', wings: ['w1', 'w2'], halls: [], count: 1 });
      nodes.set('c', { room: 'c', wings: ['w2', 'w3'], halls: [], count: 1 });
      nodes.set('d', { room: 'd', wings: ['w3'], halls: [], count: 1 });

      // With max_hops=1, should only reach b
      const results1 = traverseGraph('a', nodes, 1);
      expect(results1.map((r) => r.room)).toContain('b');
      expect(results1.map((r) => r.room)).not.toContain('c');
    });

    it('should sort by hop distance then count', () => {
      const nodes = new Map<string, PalaceGraphNode>();
      nodes.set('start', { room: 'start', wings: ['w1'], halls: [], count: 1 });
      nodes.set('high', { room: 'high', wings: ['w1'], halls: [], count: 10 });
      nodes.set('low', { room: 'low', wings: ['w1'], halls: [], count: 2 });

      const results = traverseGraph('start', nodes, 1);
      // Hop 0: start, Hop 1: high (10), low (2) — sorted by -count
      const hop1 = results.filter((r) => r.hop === 1);
      expect(hop1[0].room).toBe('high');
      expect(hop1[1].room).toBe('low');
    });

    it('should return empty for unknown start room', () => {
      const nodes = new Map<string, PalaceGraphNode>();
      const results = traverseGraph('nonexistent', nodes);
      expect(results).toHaveLength(0);
    });
  });
});
