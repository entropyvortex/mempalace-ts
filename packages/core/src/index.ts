/**
 * @module @mempalace-ts/core
 * TypeScript-native memory palace for AI agents.
 *
 * Complete, zero-Python port of the viral MemPalace project.
 * @see https://github.com/milla-jovovich/mempalace
 */

// Types
export type {
  Wing,
  HallType,
  RoomConfig,
  DrawerMetadata,
  Drawer,
  Entity,
  Triple,
  EntityRelationship,
  KnowledgeGraphStats,
  QueryDirection,
  PalaceGraphNode,
  PalaceGraphEdge,
  TraversalResult,
  PalaceGraphStats,
  EmotionCode,
  AAAKFlag,
  CompressionStats,
  EntityMap,
  StackStatus,
  MempalaceConfigData,
  ProjectConfig,
  SearchResult,
  SearchResponse,
  TextChunk,
  ExtractMode,
  IngestMode,
  DetectedEntity,
  DetectionResult,
  MemoryType,
  ExtractedMemory,
  DiaryEntry,
} from './types.js';

// Constants
export {
  HALL_TYPES,
  DEFAULT_PALACE_PATH,
  DEFAULT_COLLECTION_NAME,
  DEFAULT_KG_PATH,
  DEFAULT_IDENTITY_PATH,
  CHUNK_SIZE,
  CHUNK_OVERLAP,
  MIN_CHUNK_SIZE,
  L1_MAX_DRAWERS,
  L1_MAX_CHARS,
  READABLE_EXTENSIONS,
  SKIP_DIRS,
  DEFAULT_TOPIC_WINGS,
  DEFAULT_HALL_KEYWORDS,
  ProjectConfigSchema,
} from './types.js';

// Dialect (AAAK compression)
export { Dialect, EMOTION_CODES } from './dialect.js';

// Knowledge Graph
export { KnowledgeGraph } from './knowledge-graph.js';

// Palace Graph
export {
  buildGraph,
  traverse,
  findTunnels,
  graphStats,
} from './palace-graph.js';

// Layers (Memory Stack)
export { Layer0, Layer1, Layer2, Layer3, MemoryStack } from './layers.js';

// Mining
export {
  loadConfig,
  detectRoom,
  scanProject,
  processFile,
  mine,
  miningStatus,
} from './miner.js';

// Conversation Mining
export {
  chunkExchanges,
  detectConvoRoom,
  mineConvos,
} from './convo-miner.js';

// Entity Detection
export {
  scanForDetection,
  detectEntities,
  extractMemories,
} from './entity-detector.js';

// Search
export { searchMemories, search } from './searcher.js';

// ChromaDB operations
export {
  getCollection,
  fileAlreadyMined,
  addDrawer,
  deleteDrawer,
  searchDrawers,
  getDrawers,
  drawerCount,
  listWings,
  listRooms,
  getTaxonomy,
  checkDuplicate,
} from './chroma.js';
export type { ChromaCollection } from './chroma.js';

// Storage
export { openDatabase } from './storage.js';

// Configuration (NEW — ported from config.py)
export { MempalaceConfig, CONFIG_HALL_KEYWORDS, sanitizeName, sanitizeContent, MAX_NAME_LENGTH } from './config.js';

// Room Detection (NEW — ported from room_detector_local.py)
export {
  FOLDER_ROOM_MAP,
  detectRoomsFromFolders,
  detectRoomsFromFiles,
  detectRoomsLocal,
} from './room-detector.js';

// General Extractor (NEW — full port from general_extractor.py)
export { extractMemoriesFull } from './general-extractor.js';

// Split Mega-Files (NEW — ported from split_mega_files.py)
export {
  findSessionBoundaries,
  extractTimestamp,
  extractPeople,
  extractSubject,
  splitFile,
  splitMegaFiles,
} from './split-mega-files.js';

// Spellcheck (NEW — ported from spellcheck.py)
export {
  setSpeller,
  editDistance,
  spellcheckUserText,
  spellcheckTranscriptLine,
  spellcheckTranscript,
} from './spellcheck.js';

// Hooks (NEW — ported from hooks_cli.py)
export {
  hookStop,
  hookSessionStart,
  hookPrecompact,
  runHook,
} from './hooks.js';
export type { HookOutput, HookName, HarnessName } from './hooks.js';

// Instructions (NEW — ported from instructions_cli.py)
export { getInstructions, AVAILABLE_INSTRUCTIONS } from './instructions.js';
export type { InstructionName } from './instructions.js';

// Gitignore (NEW — ported from miner.py GitignoreMatcher)
export { GitignoreMatcher, loadGitignoreMatcher, isGitignored } from './utils/gitignore.js';

// Entity Registry (NEW — ported from entity_registry.py)
export { EntityRegistry, COMMON_ENGLISH_WORDS } from './entity-registry.js';

// Query Sanitizer (NEW — ported from query_sanitizer.py)
export { sanitizeQuery } from './query-sanitizer.js';
export type { SanitizeResult } from './query-sanitizer.js';

// Deduplication (NEW — ported from dedup.py)
export {
  getSourceGroups,
  dedupSourceGroup,
  showStats,
  dedupPalace,
  DEFAULT_THRESHOLD,
  MIN_DRAWERS_TO_CHECK,
} from './dedup.js';

// Exporter (NEW — ported from exporter.py)
export { exportPalace } from './exporter.js';

// Repair (NEW — ported from repair.py)
export { scanPalace, pruneCorrupt, rebuildIndex } from './repair.js';
export type { ScanResult } from './repair.js';

// Migrate (NEW — ported from migrate.py)
export {
  extractDrawersFromSqlite,
  detectChromadbVersion,
  containsPalaceDatabase,
  migrate,
} from './migrate.js';
export type { SqliteDrawer, MigrateResult } from './migrate.js';

// Onboarding (NEW — ported from onboarding.py)
export { DEFAULT_WINGS, quickSetup, runOnboarding } from './onboarding.js';
export type { PersonEntry, PalaceMode } from './onboarding.js';

// i18n (NEW — ported from i18n/__init__.py)
export { availableLanguages, loadLang, t, currentLang, getRegex } from './i18n.js';

// Backends (NEW — ported from backends/)
export type { BaseCollection } from './backends/base.js';
export { ChromaCollection as BackendChromaCollection, ChromaBackend } from './backends/chroma.js';

// Utilities
export { normalize } from './utils/normalize.js';
export { chunkText } from './utils/chunk.js';
export { resolvePath, ensureDir, expandHome } from './utils/paths.js';
