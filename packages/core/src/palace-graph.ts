/**
 * @module palace-graph
 * Room navigation graph — builds a spatial graph of the memory palace and enables
 * BFS traversal across rooms and wings.
 *
 * CRITICAL — 1:1 PORT from original palace_graph.py
 *
 * Maps directly to:
 *   Python functions: build_graph(), traverse(), find_tunnels(), graph_stats()
 *   Python file:      palace_graph.py
 *
 * The palace metaphor hierarchy:
 *   Wing (people/projects) → Hall (memory type) → Room (named idea) → Closet → Drawer
 *
 * Rooms can appear in multiple wings — these cross-wing rooms are called **Tunnels**.
 * Tunnels are the edges in the palace graph, connecting different contexts.
 *
 * Python: self.wings[wing_id].halls[hall_type]...
 * TS:     buildGraph() returns { nodes, edges } where nodes are rooms and edges are tunnels
 */

import type { ChromaCollection } from './chroma.js';
import { INCLUDE_METADATAS } from './chroma.js';
import type {
  PalaceGraphNode,
  PalaceGraphEdge,
  TraversalResult,
  PalaceGraphStats,
} from './types.js';

/**
 * Build the palace navigation graph from ChromaDB drawer metadata.
 *
 * 1:1 PORT from palace_graph.py build_graph(col=None, config=None)
 * Python: def build_graph(col=None, config=None) -> (dict, list)
 * TS:     buildGraph(collection) -> { nodes, edges }
 *
 * Scans all drawers in the collection, groups them by room,
 * and detects tunnels (rooms present in multiple wings).
 *
 * @param collection - ChromaDB collection containing drawers
 * @returns Object with nodes (room → metadata) and edges (tunnel connections)
 */
export async function buildGraph(
  collection: ChromaCollection,
): Promise<{ nodes: Map<string, PalaceGraphNode>; edges: PalaceGraphEdge[] }> {
  // Python: col.get(include=["metadatas"])
  const all = await collection.get({ include: [INCLUDE_METADATAS] });

  // Python: nodes = {} — room → {wings, halls, count}
  const nodes = new Map<string, PalaceGraphNode>();

  for (const meta of all.metadatas ?? []) {
    const m = meta as Record<string, string>;
    const room = m?.room ?? 'general';
    const wing = m?.wing ?? 'unknown';

    // Python: hall detection from metadata — derive hall from content keywords
    // In the original, halls are derived from content; here we track wing presence
    const existing = nodes.get(room);
    if (existing) {
      if (!existing.wings.includes(wing)) {
        existing.wings.push(wing);
      }
      existing.count++;
    } else {
      nodes.set(room, {
        room,
        wings: [wing],
        halls: [],
        count: 1,
      });
    }
  }

  // Python: edges = [] — tunnels are rooms that appear in multiple wings
  // A tunnel connects every pair of wings that share a room
  const edges: PalaceGraphEdge[] = [];
  for (const [roomName, node] of nodes) {
    if (node.wings.length > 1) {
      // Python: Create edges between all pairs of wings sharing this room
      for (let i = 0; i < node.wings.length; i++) {
        for (let j = i + 1; j < node.wings.length; j++) {
          edges.push({
            source: roomName,
            target: roomName,
            shared_wings: [node.wings[i], node.wings[j]],
          });
        }
      }
    }
  }

  return { nodes, edges };
}

/**
 * BFS traversal from a starting room in the palace graph.
 *
 * 1:1 PORT from palace_graph.py traverse(start_room, col=None, config=None, max_hops=2)
 * Python: def traverse(start_room, col=None, config=None, max_hops=2) -> list
 * TS:     traverse(startRoom, collection, maxHops) -> TraversalResult[]
 *
 * Algorithm (from Python):
 *   1. Start at start_room, depth 0
 *   2. visited = {start_room}
 *   3. frontier = [(start_room, 0)]
 *   4. While frontier is not empty:
 *      a. Pop (current_room, depth)
 *      b. If depth >= max_hops: skip
 *      c. Find all rooms sharing a wing with current_room
 *      d. For each unvisited neighbor:
 *         - Add to visited, results, and frontier (if depth+1 < max_hops)
 *   5. Sort results by (hop distance, -count)
 *
 * @param startRoom - Room name to start traversal from
 * @param collection - ChromaDB collection
 * @param maxHops - Maximum BFS depth (default: 2)
 * @returns Array of traversal results sorted by proximity then importance
 */
export async function traverse(
  startRoom: string,
  collection: ChromaCollection,
  maxHops: number = 2,
): Promise<TraversalResult[]> {
  const { nodes } = await buildGraph(collection);

  const startNode = nodes.get(startRoom);
  if (!startNode) return [];

  // Python: visited = {start_room}
  const visited = new Set<string>([startRoom]);

  // Python: frontier = [(start_room, 0)]
  const frontier: Array<[string, number]> = [[startRoom, 0]];

  // Python: results = [start_room_data]
  const results: TraversalResult[] = [
    {
      ...startNode,
      hop: 0,
      connected_via: [],
    },
  ];

  // Python: BFS loop
  while (frontier.length > 0) {
    const [currentRoom, depth] = frontier.shift()!;

    // Python: if depth >= max_hops: continue
    if (depth >= maxHops) continue;

    const currentNode = nodes.get(currentRoom);
    if (!currentNode) continue;

    const currentWings = new Set(currentNode.wings);

    // Python: for room in all_rooms — find rooms sharing a wing with current
    for (const [roomName, node] of nodes) {
      if (visited.has(roomName)) continue;

      // Python: shared_wings = current_wings & set(room_wings)
      const sharedWings = node.wings.filter((w) => currentWings.has(w));
      if (sharedWings.length > 0) {
        visited.add(roomName);
        results.push({
          ...node,
          hop: depth + 1,
          connected_via: sharedWings,
        });

        // Python: if depth + 1 < max_hops: frontier.append((room, depth + 1))
        if (depth + 1 < maxHops) {
          frontier.push([roomName, depth + 1]);
        }
      }
    }
  }

  // Python: sorted by (hop_distance, -count)
  results.sort((a, b) => {
    if (a.hop !== b.hop) return a.hop - b.hop;
    return b.count - a.count;
  });

  return results;
}

/**
 * Find rooms (tunnels) that bridge two specific wings.
 *
 * 1:1 PORT from palace_graph.py find_tunnels(wing_a=None, wing_b=None, ...)
 * Python: def find_tunnels(wing_a=None, wing_b=None, col=None, config=None) -> list
 * TS:     findTunnels(collection, wingA, wingB) -> PalaceGraphNode[]
 *
 * @param collection - ChromaDB collection
 * @param wingA - Optional first wing filter
 * @param wingB - Optional second wing filter
 * @returns Rooms present in both wings (or all multi-wing rooms if no filter)
 */
export async function findTunnels(
  collection: ChromaCollection,
  wingA?: string,
  wingB?: string,
): Promise<PalaceGraphNode[]> {
  const { nodes } = await buildGraph(collection);

  const tunnels: PalaceGraphNode[] = [];
  for (const node of nodes.values()) {
    // Python: Tunnel = room in multiple wings
    if (node.wings.length <= 1) continue;

    // Python: Filter by specific wings if provided
    if (wingA && !node.wings.includes(wingA)) continue;
    if (wingB && !node.wings.includes(wingB)) continue;

    tunnels.push(node);
  }

  return tunnels;
}

/**
 * Get palace graph statistics.
 *
 * 1:1 PORT from palace_graph.py graph_stats(col=None, config=None)
 * Python: def graph_stats(col=None, config=None) -> dict
 * TS:     graphStats(collection) -> PalaceGraphStats
 *
 * @param collection - ChromaDB collection
 * @returns Statistics about rooms, tunnels, edges, and wings
 */
export async function graphStats(collection: ChromaCollection): Promise<PalaceGraphStats> {
  const { nodes, edges } = await buildGraph(collection);

  // Python: rooms_per_wing
  const roomsPerWing: Record<string, number> = {};
  for (const node of nodes.values()) {
    for (const wing of node.wings) {
      roomsPerWing[wing] = (roomsPerWing[wing] ?? 0) + 1;
    }
  }

  // Python: top_tunnels — rooms with the most wing connections
  const tunnelRooms = [...nodes.values()]
    .filter((n) => n.wings.length > 1)
    .sort((a, b) => b.wings.length - a.wings.length)
    .slice(0, 10)
    .map((n) => ({ room: n.room, wing_count: n.wings.length }));

  return {
    total_rooms: nodes.size,
    tunnel_rooms: tunnelRooms.length,
    total_edges: edges.length,
    rooms_per_wing: roomsPerWing,
    top_tunnels: tunnelRooms,
  };
}
