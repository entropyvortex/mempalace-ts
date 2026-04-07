/**
 * @module types
 * Core type definitions for mempalace-ts.
 *
 * 1:1 PORT from original mempalace Python project.
 * Every type here maps directly to a Python class, TypedDict, or constant structure.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Memory Palace Metaphor Types
// ---------------------------------------------------------------------------

/**
 * 1:1 PORT from palace_graph.py — the spatial hierarchy:
 * Wing → Hall → Room → Closet → Drawer
 */
export interface Wing {
  /** Wing identifier, e.g. "wing_myapp" */
  id: string;
  /** Human-readable name */
  name: string;
}

/**
 * Hall types — the five memory categories present in every Wing.
 * Python: DEFAULT_HALL_KEYWORDS keys in config.py
 */
export type HallType =
  | 'hall_facts'
  | 'hall_events'
  | 'hall_discoveries'
  | 'hall_preferences'
  | 'hall_advice';

export const HALL_TYPES: readonly HallType[] = [
  'hall_facts',
  'hall_events',
  'hall_discoveries',
  'hall_preferences',
  'hall_advice',
] as const;

/**
 * A Room within a Wing — named ideas like "auth-migration", "graphql-switch".
 * Python: rooms list in mempalace.yaml
 */
export interface RoomConfig {
  name: string;
  description: string;
  keywords: string[];
}

/**
 * A Drawer — the atomic unit of stored memory.
 * Python: ChromaDB document metadata in miner.py
 */
export interface DrawerMetadata {
  wing: string;
  room: string;
  source_file: string;
  chunk_index: number;
  added_by: string;
  filed_at: string;
  ingest_mode: 'convos' | 'projects';
  extract_mode?: 'exchange' | 'general';
  importance?: number;
  emotional_weight?: number;
}

/**
 * A Drawer with its content.
 */
export interface Drawer {
  id: string;
  content: string;
  metadata: DrawerMetadata;
}

// ---------------------------------------------------------------------------
// Knowledge Graph Types
// ---------------------------------------------------------------------------

/**
 * 1:1 PORT from knowledge_graph.py — Entity in the temporal knowledge graph.
 * Python: entities table schema
 */
export interface Entity {
  id: string;
  name: string;
  type: string;
  properties: Record<string, unknown>;
  created_at: string;
}

/**
 * 1:1 PORT from knowledge_graph.py — Temporal triple.
 * Python: triples table schema
 */
export interface Triple {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  valid_from: string | null;
  valid_to: string | null;
  confidence: number;
  source_closet: string | null;
  source_file: string | null;
  extracted_at: string;
}

/**
 * Query result for entity relationships.
 */
export interface EntityRelationship extends Triple {
  current: boolean;
}

/**
 * Knowledge graph statistics.
 * Python: KnowledgeGraph.stats() return value
 */
export interface KnowledgeGraphStats {
  entities: number;
  triples: number;
  current_facts: number;
  expired_facts: number;
  relationship_types: string[];
}

/** Direction for entity relationship queries. */
export type QueryDirection = 'outgoing' | 'incoming' | 'both';

// ---------------------------------------------------------------------------
// Palace Graph Types
// ---------------------------------------------------------------------------

/**
 * 1:1 PORT from palace_graph.py — Node in the palace navigation graph.
 * Python: build_graph() node structure
 */
export interface PalaceGraphNode {
  room: string;
  wings: string[];
  halls: string[];
  count: number;
}

/**
 * 1:1 PORT from palace_graph.py — Edge (tunnel) connecting rooms across wings.
 * Python: build_graph() edge structure
 */
export interface PalaceGraphEdge {
  source: string;
  target: string;
  shared_wings: string[];
}

/**
 * Result of a BFS traversal from a starting room.
 * Python: traverse() return value
 */
export interface TraversalResult extends PalaceGraphNode {
  hop: number;
  connected_via: string[];
}

/**
 * Palace graph statistics.
 * Python: graph_stats() return value
 */
export interface PalaceGraphStats {
  total_rooms: number;
  tunnel_rooms: number;
  total_edges: number;
  rooms_per_wing: Record<string, number>;
  top_tunnels: Array<{ room: string; wing_count: number }>;
}

// ---------------------------------------------------------------------------
// AAAK Dialect Types
// ---------------------------------------------------------------------------

/**
 * 1:1 PORT from dialect.py — Emotion code mapping.
 */
export type EmotionCode =
  | 'vul' | 'joy' | 'fear' | 'trust' | 'grief'
  | 'wonder' | 'rage' | 'love' | 'hope' | 'despair'
  | 'peace' | 'relief' | 'humor' | 'tender' | 'raw'
  | 'doubt' | 'anx' | 'exhaust' | 'convict' | 'passion'
  | 'warmth' | 'curious' | 'grat' | 'frust' | 'confuse'
  | 'satis' | 'excite' | 'determ' | 'surprise';

/**
 * 1:1 PORT from dialect.py — Flag signals for AAAK entries.
 */
export type AAAKFlag =
  | 'ORIGIN' | 'CORE' | 'SENSITIVE' | 'PIVOT'
  | 'GENESIS' | 'DECISION' | 'TECHNICAL';

/**
 * AAAK compression statistics.
 * Python: Dialect.compression_stats()
 */
export interface CompressionStats {
  original_tokens: number;
  compressed_tokens: number;
  ratio: number;
  savings_percent: number;
}

/**
 * Entity mapping for AAAK dialect: full name → 3-letter code.
 */
export type EntityMap = Record<string, string>;

// ---------------------------------------------------------------------------
// Layer Types
// ---------------------------------------------------------------------------

/**
 * Memory stack status.
 * Python: MemoryStack.status()
 */
export interface StackStatus {
  layer0: { loaded: boolean; tokens: number };
  layer1: { loaded: boolean; tokens: number; drawer_count: number };
  layer2: { available: boolean };
  layer3: { available: boolean };
}

// ---------------------------------------------------------------------------
// Configuration Types
// ---------------------------------------------------------------------------

/**
 * 1:1 PORT from config.py — MempalaceConfig structure.
 */
export interface MempalaceConfigData {
  palace_path: string;
  collection_name: string;
  topic_wings: string[];
  hall_keywords: Record<string, string[]>;
}

/**
 * Project-level mempalace.yaml schema.
 * Python: miner.py load_config()
 */
export const ProjectConfigSchema = z.object({
  wing: z.string(),
  rooms: z.array(
    z.object({
      name: z.string(),
      description: z.string().default(''),
      keywords: z.array(z.string()).default([]),
    }),
  ),
});

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

// ---------------------------------------------------------------------------
// Search Types
// ---------------------------------------------------------------------------

/**
 * Search result from ChromaDB semantic search.
 * Python: searcher.search_memories() return value
 */
export interface SearchResult {
  text: string;
  wing: string;
  room: string;
  source_file: string;
  similarity: number;
}

export interface SearchResponse {
  query: string;
  filters: { wing?: string; room?: string };
  results: SearchResult[];
}

// ---------------------------------------------------------------------------
// Mining Types
// ---------------------------------------------------------------------------

/**
 * Text chunk produced by the chunker.
 * Python: miner.py chunk_text() return value
 */
export interface TextChunk {
  content: string;
  chunk_index: number;
}

/**
 * Extraction mode for conversation mining.
 * Python: convo_miner.py extract_mode parameter
 */
export type ExtractMode = 'exchange' | 'general';

/**
 * Ingest mode for mining.
 */
export type IngestMode = 'convos' | 'projects';

// ---------------------------------------------------------------------------
// Entity Detection Types
// ---------------------------------------------------------------------------

/**
 * A detected entity (person or project).
 * Python: entity_detector.py return structure
 */
export interface DetectedEntity {
  name: string;
  confidence: number;
  signal_count: number;
  source: 'detected' | 'onboarding' | 'manual';
}

/**
 * Result of entity detection scan.
 * Python: entity_detector.py detect_entities() return value
 */
export interface DetectionResult {
  people: DetectedEntity[];
  projects: DetectedEntity[];
  uncertain: DetectedEntity[];
}

// ---------------------------------------------------------------------------
// General Extractor Types
// ---------------------------------------------------------------------------

/**
 * Memory type classification.
 * Python: general_extractor.py — 5 memory types
 */
export type MemoryType = 'decision' | 'preference' | 'milestone' | 'problem' | 'emotional';

/**
 * Extracted memory from text.
 * Python: general_extractor.py extract_memories() return value
 */
export interface ExtractedMemory {
  content: string;
  memory_type: MemoryType;
  chunk_index: number;
}

// ---------------------------------------------------------------------------
// MCP Types
// ---------------------------------------------------------------------------

/**
 * Diary entry for agent diary tools.
 * Python: mcp_server.py mempalace_diary_write/read
 */
export interface DiaryEntry {
  timestamp: string;
  content: string;
  agent: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default palace path. Python: config.py DEFAULT_PALACE_PATH */
export const DEFAULT_PALACE_PATH = '~/.mempalace/palace';

/** Default ChromaDB collection name. Python: config.py DEFAULT_COLLECTION_NAME */
export const DEFAULT_COLLECTION_NAME = 'mempalace_drawers';

/** Default knowledge graph database path. Python: knowledge_graph.py */
export const DEFAULT_KG_PATH = '~/.mempalace/knowledge_graph.sqlite3';

/** Default identity file path. Python: layers.py */
export const DEFAULT_IDENTITY_PATH = '~/.mempalace/identity.txt';

/** Chunk size in characters. Python: miner.py CHUNK_SIZE */
export const CHUNK_SIZE = 800;

/** Overlap between chunks. Python: miner.py CHUNK_OVERLAP */
export const CHUNK_OVERLAP = 100;

/** Minimum chunk size to keep. Python: miner.py MIN_CHUNK_SIZE */
export const MIN_CHUNK_SIZE = 50;

/** Maximum drawers for Layer 1. Python: layers.py Layer1.MAX_DRAWERS */
export const L1_MAX_DRAWERS = 15;

/** Maximum characters for Layer 1 output. Python: layers.py Layer1.MAX_CHARS */
export const L1_MAX_CHARS = 3200;

/**
 * Readable file extensions for mining.
 * Python: miner.py READABLE_EXTENSIONS
 */
export const READABLE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.txt', '.md', '.py', '.js', '.ts', '.jsx', '.tsx',
  '.json', '.yaml', '.yml', '.html', '.css', '.java',
  '.go', '.rs', '.rb', '.sh', '.csv', '.sql', '.toml',
]);

/**
 * Directories to skip during mining.
 * Python: miner.py SKIP_DIRS
 */
export const SKIP_DIRS: ReadonlySet<string> = new Set([
  '.git', 'node_modules', '__pycache__', '.venv', 'venv', 'env',
  'dist', 'build', '.next', 'coverage', '.mempalace',
]);

/**
 * Default topic wings.
 * Python: config.py DEFAULT_TOPIC_WINGS
 */
export const DEFAULT_TOPIC_WINGS = [
  'emotions', 'consciousness', 'memory', 'technical',
  'identity', 'family', 'creative',
] as const;

/**
 * Default hall keyword mapping.
 * Python: config.py DEFAULT_HALL_KEYWORDS
 */
export const DEFAULT_HALL_KEYWORDS: Record<HallType, string[]> = {
  hall_facts: ['decided', 'confirmed', 'locked', 'final', 'always', 'never', 'rule'],
  hall_events: ['happened', 'session', 'milestone', 'debugging', 'shipped', 'deployed'],
  hall_discoveries: ['breakthrough', 'insight', 'realized', 'found', 'eureka', 'discovered'],
  hall_preferences: ['prefer', 'like', 'hate', 'habit', 'always use', 'never use', 'style'],
  hall_advice: ['recommend', 'suggestion', 'tip', 'trick', 'solution', 'workaround'],
};
