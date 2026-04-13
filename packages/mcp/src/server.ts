#!/usr/bin/env node
/**
 * @module mcp-server
 * MCP (Model Context Protocol) server for mempalace-ts — 25 tools, exact parity.
 *
 * 1:1 PORT from original mcp_server.py
 *
 * Tool categories:
 *   READ (7):  status, list_wings, list_rooms, get_taxonomy, search, check_duplicate, get_aaak_spec
 *   WRITE (2): add_drawer, delete_drawer
 *   KNOWLEDGE GRAPH (5): kg_query, kg_add, kg_invalidate, kg_timeline, kg_stats
 *   NAVIGATION (3): traverse, find_tunnels, graph_stats
 *   AGENT DIARY (2): diary_write, diary_read
 *   DRAWER MANAGEMENT (3): get_drawer, list_drawers, update_drawer
 *   SETTINGS & MAINTENANCE (3): hook_settings, reconnect, memories_filed_away
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  getCollection,
  searchDrawers,
  addDrawer,
  deleteDrawer,
  drawerCount,
  listWings,
  listRooms,
  getTaxonomy,
  checkDuplicate,
  getDrawers,
  KnowledgeGraph,
  traverse,
  findTunnels,
  graphStats,
  Dialect,
  MempalaceConfig,
  type DrawerMetadata,
  type QueryDirection,
} from '@mempalace-ts/core';
import { v4 as uuidv4 } from 'uuid';
import { format } from 'date-fns';

// ---------------------------------------------------------------------------
// Protocol & AAAK Spec — 1:1 PORT from mcp_server.py
// ---------------------------------------------------------------------------

/**
 * Python: mcp_server.py PALACE_PROTOCOL
 */
const PALACE_PROTOCOL = `Remember facts before speaking. KNOW before you speak.
Load L0 (identity) + L1 (essential context) on wake-up.
Check L2 (on-demand) when a topic comes up.
Search L3 (deep search) only when needed.
Always file new memories with proper wing/room/hall classification.
Never fabricate memories — if you don't know, say so.
Respect the temporal validity of knowledge graph facts.`;

/**
 * Python: mcp_server.py AAAK_SPEC
 */
const AAAK_SPEC = `AAAK — Abbreviated Associative Archival Kernel

Format:
  HEADER: FILE_NUM|PRIMARY_ENTITY|DATE|TITLE
  ZETTEL: ZID:ENTITIES|topic_keywords|"key_quote"|WEIGHT|EMOTIONS|FLAGS
  TUNNEL: T:ZID<->ZID|label
  ARC: ARC:emotion->emotion->emotion

Entity codes: 3-letter uppercase (Alice→ALC, Bob→BOB)
Emotion codes: vul, joy, fear, trust, grief, wonder, rage, love, hope, despair,
  peace, relief, humor, tender, raw, doubt, anx, exhaust, convict, passion,
  warmth, curious, grat, frust, confuse, satis, excite, determ, surprise
Flags: ORIGIN, CORE, SENSITIVE, PIVOT, GENESIS, DECISION, TECHNICAL
Target: 30x compression ratio, lossless`;

// ---------------------------------------------------------------------------
// Diary storage (in-memory for simplicity; persisted per session)
// ---------------------------------------------------------------------------
const diary: Array<{ timestamp: string; content: string; agent: string }> = [];

// ---------------------------------------------------------------------------
// KnowledgeGraph singleton
// ---------------------------------------------------------------------------
let kg: KnowledgeGraph | null = null;
function getKG(): KnowledgeGraph {
  if (!kg) kg = new KnowledgeGraph();
  return kg;
}

// ---------------------------------------------------------------------------
// MCP Server Setup
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: 'mempalace-ts',
  version: '1.0.0',
});

// ===== READ TOOLS (7) =====================================================

/**
 * Tool 1: mempalace_status — Palace overview + AAAK spec + protocol
 * Python: mcp_server.py tool_status
 */
server.tool(
  'mempalace_status',
  'Get memory palace status, AAAK spec, and protocol instructions',
  {},
  async () => {
    const collection = await getCollection();
    const count = await drawerCount(collection);
    const wings = await listWings(collection);
    const kgStats = getKG().stats();

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          palace: {
            total_drawers: count,
            wings,
          },
          knowledge_graph: kgStats,
          protocol: PALACE_PROTOCOL,
          aaak_spec: AAAK_SPEC,
        }, null, 2),
      }],
    };
  },
);

/**
 * Tool 2: mempalace_list_wings — All wings with counts
 * Python: mcp_server.py tool_list_wings
 */
server.tool(
  'mempalace_list_wings',
  'List all wings in the memory palace with drawer counts',
  {},
  async () => {
    const collection = await getCollection();
    const wings = await listWings(collection);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(wings, null, 2) }],
    };
  },
);

/**
 * Tool 3: mempalace_list_rooms — Rooms in a wing
 * Python: mcp_server.py tool_list_rooms
 */
server.tool(
  'mempalace_list_rooms',
  'List all rooms within a specific wing',
  { wing: z.string().describe('Wing name to list rooms for') },
  async ({ wing }) => {
    const collection = await getCollection();
    const rooms = await listRooms(collection, wing);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(rooms, null, 2) }],
    };
  },
);

/**
 * Tool 4: mempalace_get_taxonomy — Full wing → room → count tree
 * Python: mcp_server.py tool_get_taxonomy
 */
server.tool(
  'mempalace_get_taxonomy',
  'Get the full taxonomy: wing → room → drawer count',
  {},
  async () => {
    const collection = await getCollection();
    const taxonomy = await getTaxonomy(collection);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(taxonomy, null, 2) }],
    };
  },
);

/**
 * Tool 5: mempalace_search — Semantic search with filters
 * Python: mcp_server.py tool_search
 */
server.tool(
  'mempalace_search',
  'Semantic search across memory palace drawers',
  {
    query: z.string().describe('Search query'),
    wing: z.string().optional().describe('Filter by wing'),
    room: z.string().optional().describe('Filter by room'),
    n_results: z.number().optional().default(5).describe('Number of results'),
  },
  async ({ query, wing, room, n_results }) => {
    const collection = await getCollection();
    const results = await searchDrawers(collection, query, wing, room, n_results);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }],
    };
  },
);

/**
 * Tool 6: mempalace_check_duplicate — Check before filing
 * Python: mcp_server.py tool_check_duplicate
 */
server.tool(
  'mempalace_check_duplicate',
  'Check if content is a duplicate of existing drawers before filing',
  {
    content: z.string().describe('Content to check for duplicates'),
    threshold: z.number().optional().default(0.9).describe('Similarity threshold (0-1)'),
  },
  async ({ content, threshold }) => {
    const collection = await getCollection();
    const match = await checkDuplicate(collection, content, threshold);
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          is_duplicate: match !== null,
          match: match ?? undefined,
        }, null, 2),
      }],
    };
  },
);

/**
 * Tool 7: mempalace_get_aaak_spec — AAAK dialect reference
 * Python: mcp_server.py tool_get_aaak_spec
 */
server.tool(
  'mempalace_get_aaak_spec',
  'Get the full AAAK compression dialect specification',
  {},
  async () => {
    return {
      content: [{ type: 'text' as const, text: AAAK_SPEC }],
    };
  },
);

// ===== WRITE TOOLS (2) =====================================================

/**
 * Tool 8: mempalace_add_drawer — File verbatim content
 * Python: mcp_server.py tool_add_drawer
 */
server.tool(
  'mempalace_add_drawer',
  'Add a new drawer (memory) to the palace',
  {
    content: z.string().describe('Content to store'),
    wing: z.string().describe('Wing to file in'),
    room: z.string().describe('Room to file in'),
    source: z.string().optional().default('mcp').describe('Source identifier'),
    agent: z.string().optional().default('agent').describe('Agent filing this memory'),
  },
  async ({ content, wing, room, source, agent }) => {
    const collection = await getCollection();
    const id = `drawer_${wing}_${room}_${uuidv4().slice(0, 8)}`;
    const metadata: DrawerMetadata = {
      wing,
      room,
      source_file: source,
      chunk_index: 0,
      added_by: agent,
      filed_at: format(new Date(), "yyyy-MM-dd'T'HH:mm:ss.SSSSSS"),
      ingest_mode: 'projects',
    };

    await addDrawer(collection, id, content, metadata);
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ success: true, id }, null, 2),
      }],
    };
  },
);

/**
 * Tool 9: mempalace_delete_drawer — Remove drawer by ID
 * Python: mcp_server.py tool_delete_drawer
 */
server.tool(
  'mempalace_delete_drawer',
  'Delete a drawer by ID',
  { id: z.string().describe('Drawer ID to delete') },
  async ({ id }) => {
    const collection = await getCollection();
    await deleteDrawer(collection, id);
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ success: true, deleted: id }, null, 2),
      }],
    };
  },
);

// ===== KNOWLEDGE GRAPH TOOLS (5) ===========================================

/**
 * Tool 10: mempalace_kg_query — Entity relationships
 * Python: mcp_server.py tool_kg_query
 */
server.tool(
  'mempalace_kg_query',
  'Query knowledge graph for entity relationships',
  {
    name: z.string().describe('Entity name to query'),
    as_of: z.string().optional().describe('Date filter (YYYY-MM-DD)'),
    direction: z.enum(['outgoing', 'incoming', 'both']).optional().default('outgoing')
      .describe('Query direction'),
  },
  async ({ name, as_of, direction }) => {
    const results = getKG().queryEntity(name, as_of, direction as QueryDirection);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }],
    };
  },
);

/**
 * Tool 11: mempalace_kg_add — Add fact
 * Python: mcp_server.py tool_kg_add
 */
server.tool(
  'mempalace_kg_add',
  'Add a fact (triple) to the knowledge graph',
  {
    subject: z.string().describe('Subject entity'),
    predicate: z.string().describe('Relationship (e.g., works_on, child_of)'),
    object: z.string().describe('Object entity'),
    valid_from: z.string().optional().describe('Start date (YYYY-MM-DD)'),
    valid_to: z.string().optional().describe('End date (YYYY-MM-DD)'),
    confidence: z.number().optional().default(1.0).describe('Confidence (0-1)'),
  },
  async ({ subject, predicate, object, valid_from, valid_to, confidence }) => {
    const id = getKG().addTriple(subject, predicate, object, {
      validFrom: valid_from,
      validTo: valid_to,
      confidence,
    });
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ success: true, id }, null, 2),
      }],
    };
  },
);

/**
 * Tool 12: mempalace_kg_invalidate — Mark fact as ended
 * Python: mcp_server.py tool_kg_invalidate
 */
server.tool(
  'mempalace_kg_invalidate',
  'Invalidate (end) a knowledge graph fact',
  {
    subject: z.string().describe('Subject entity'),
    predicate: z.string().describe('Relationship'),
    object: z.string().describe('Object entity'),
    ended: z.string().optional().describe('End date (default: today)'),
  },
  async ({ subject, predicate, object, ended }) => {
    getKG().invalidate(subject, predicate, object, ended);
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ success: true }, null, 2),
      }],
    };
  },
);

/**
 * Tool 13: mempalace_kg_timeline — Chronological story
 * Python: mcp_server.py tool_kg_timeline
 */
server.tool(
  'mempalace_kg_timeline',
  'Get chronological timeline for an entity',
  {
    entity: z.string().optional().describe('Entity name (omit for all)'),
  },
  async ({ entity }) => {
    const timeline = getKG().timeline(entity);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(timeline, null, 2) }],
    };
  },
);

/**
 * Tool 14: mempalace_kg_stats — Graph overview
 * Python: mcp_server.py tool_kg_stats
 */
server.tool(
  'mempalace_kg_stats',
  'Get knowledge graph statistics',
  {},
  async () => {
    const stats = getKG().stats();
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(stats, null, 2) }],
    };
  },
);

// ===== NAVIGATION TOOLS (3) ================================================

/**
 * Tool 15: mempalace_traverse — Walk palace graph from room
 * Python: mcp_server.py tool_traverse
 */
server.tool(
  'mempalace_traverse',
  'BFS traversal of the palace graph from a starting room',
  {
    start_room: z.string().describe('Room to start from'),
    max_hops: z.number().optional().default(2).describe('Maximum BFS depth'),
  },
  async ({ start_room, max_hops }) => {
    const collection = await getCollection();
    const results = await traverse(start_room, collection, max_hops);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }],
    };
  },
);

/**
 * Tool 16: mempalace_find_tunnels — Find rooms bridging wings
 * Python: mcp_server.py tool_find_tunnels
 */
server.tool(
  'mempalace_find_tunnels',
  'Find rooms that bridge (tunnel between) two wings',
  {
    wing_a: z.string().optional().describe('First wing'),
    wing_b: z.string().optional().describe('Second wing'),
  },
  async ({ wing_a, wing_b }) => {
    const collection = await getCollection();
    const tunnels = await findTunnels(collection, wing_a, wing_b);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(tunnels, null, 2) }],
    };
  },
);

/**
 * Tool 17: mempalace_graph_stats — Graph connectivity
 * Python: mcp_server.py tool_graph_stats
 */
server.tool(
  'mempalace_graph_stats',
  'Get palace graph statistics (rooms, tunnels, edges)',
  {},
  async () => {
    const collection = await getCollection();
    const stats = await graphStats(collection);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(stats, null, 2) }],
    };
  },
);

// ===== AGENT DIARY TOOLS (2) ===============================================

/**
 * Tool 18: mempalace_diary_write — Write AAAK diary entry
 * Python: mcp_server.py tool_diary_write
 */
server.tool(
  'mempalace_diary_write',
  'Write a diary entry in AAAK format',
  {
    content: z.string().describe('Diary entry content'),
    agent: z.string().optional().default('agent').describe('Agent writing the entry'),
  },
  async ({ content, agent }) => {
    const dialect = new Dialect();
    const compressed = dialect.compress(content);
    const entry = {
      timestamp: new Date().toISOString(),
      content: compressed,
      agent,
    };
    diary.push(entry);
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ success: true, entry }, null, 2),
      }],
    };
  },
);

/**
 * Tool 19: mempalace_diary_read — Read recent entries
 * Python: mcp_server.py tool_diary_read
 */
server.tool(
  'mempalace_diary_read',
  'Read recent diary entries',
  {
    limit: z.number().optional().default(10).describe('Max entries to return'),
  },
  async ({ limit }) => {
    const recent = diary.slice(-limit);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(recent, null, 2) }],
    };
  },
);

// ===== DRAWER MANAGEMENT TOOLS (3) =========================================

/**
 * Tool 20: mempalace_get_drawer — Fetch a single drawer by ID
 * Python: mcp_server.py tool_get_drawer
 */
server.tool(
  'mempalace_get_drawer',
  'Fetch a single drawer by ID',
  { id: z.string().describe('Drawer ID to fetch') },
  async ({ id }) => {
    const collection = await getCollection();
    const results = await collection.get({ ids: [id], include: ['documents' as any, 'metadatas' as any] });
    if (!results.ids.length) {
      return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Drawer not found' }) }] };
    }
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({
        id: results.ids[0],
        content: results.documents?.[0] ?? '',
        metadata: results.metadatas?.[0] ?? {},
      }, null, 2) }],
    };
  },
);

/**
 * Tool 21: mempalace_list_drawers — List drawers with pagination and filters
 * Python: mcp_server.py tool_list_drawers
 */
server.tool(
  'mempalace_list_drawers',
  'List drawers with pagination and optional wing/room filters',
  {
    wing: z.string().optional().describe('Filter by wing'),
    room: z.string().optional().describe('Filter by room'),
    limit: z.number().optional().default(20).describe('Maximum drawers to return'),
    offset: z.number().optional().default(0).describe('Offset for pagination'),
  },
  async ({ wing, room, limit, offset }) => {
    const collection = await getCollection();
    const drawers = await getDrawers(collection, wing, room, limit, offset);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(drawers, null, 2) }],
    };
  },
);

/**
 * Tool 22: mempalace_update_drawer — Update drawer content and/or metadata
 * Python: mcp_server.py tool_update_drawer
 */
server.tool(
  'mempalace_update_drawer',
  'Update drawer content and/or metadata',
  {
    id: z.string().describe('Drawer ID to update'),
    content: z.string().optional().describe('New content for the drawer'),
    wing: z.string().optional().describe('New wing for the drawer'),
    room: z.string().optional().describe('New room for the drawer'),
  },
  async ({ id, content, wing, room }) => {
    const collection = await getCollection();
    const updatePayload: Record<string, unknown> = { ids: [id] };
    if (content !== undefined) updatePayload.documents = [content];
    const metadataUpdates: Record<string, string> = {};
    if (wing !== undefined) metadataUpdates.wing = wing;
    if (room !== undefined) metadataUpdates.room = room;
    if (Object.keys(metadataUpdates).length > 0) updatePayload.metadatas = [metadataUpdates];
    await collection.update(updatePayload as any);
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ success: true, updated: id }, null, 2),
      }],
    };
  },
);

// ===== SETTINGS & MAINTENANCE TOOLS (3) =====================================

/**
 * Tool 23: mempalace_hook_settings — Get or set hook behavior
 * Python: mcp_server.py tool_hook_settings
 */
server.tool(
  'mempalace_hook_settings',
  'Get or set hook behavior (silent_save, desktop_toast)',
  {
    silent_save: z.boolean().optional().describe('Enable/disable silent save on hook'),
    desktop_toast: z.boolean().optional().describe('Enable/disable desktop toast notifications'),
  },
  async ({ silent_save, desktop_toast }) => {
    const config = new MempalaceConfig();
    if (silent_save !== undefined) config.setHookSetting('silent_save', silent_save);
    if (desktop_toast !== undefined) config.setHookSetting('desktop_toast', desktop_toast);
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          silent_save: config.hookSilentSave,
          desktop_toast: config.hookDesktopToast,
        }, null, 2),
      }],
    };
  },
);

/**
 * Tool 24: mempalace_reconnect — Force cache invalidation
 * Python: mcp_server.py tool_reconnect
 */
server.tool(
  'mempalace_reconnect',
  'Force cache invalidation — reset ChromaDB client and knowledge graph',
  {},
  async () => {
    kg = null;
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ success: true, message: 'Cache invalidated. Next call will reconnect.' }, null, 2),
      }],
    };
  },
);

/**
 * Tool 25: mempalace_memories_filed_away — Check recent diary activity
 * Python: mcp_server.py tool_memories_filed_away
 */
server.tool(
  'mempalace_memories_filed_away',
  'Check if the most recent diary entry was within the last N minutes',
  {
    minutes: z.number().optional().default(30).describe('Time window in minutes (default 30)'),
  },
  async ({ minutes }) => {
    if (diary.length === 0) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ filed_recently: false, message: 'No diary entries found' }, null, 2),
        }],
      };
    }
    const lastEntry = diary[diary.length - 1];
    const lastTime = new Date(lastEntry.timestamp).getTime();
    const cutoff = Date.now() - minutes * 60 * 1000;
    const filedRecently = lastTime >= cutoff;
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          filed_recently: filedRecently,
          last_entry_at: lastEntry.timestamp,
          minutes_ago: Math.round((Date.now() - lastTime) / 60000),
        }, null, 2),
      }],
    };
  },
);

// ---------------------------------------------------------------------------
// Start the MCP server
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('MCP server error:', err);
  process.exit(1);
});
