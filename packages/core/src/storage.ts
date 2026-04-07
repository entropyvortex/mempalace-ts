/**
 * @module storage
 * SQLite storage via better-sqlite3 for the knowledge graph.
 *
 * 1:1 PORT from original knowledge_graph.py SQLite schema.
 * Provides the database layer that KnowledgeGraph uses.
 */

import Database from 'better-sqlite3';
import { resolvePath, ensureDir } from './utils/paths.js';
import { dirname } from 'node:path';
import { DEFAULT_KG_PATH } from './types.js';

/**
 * SQL schema for the knowledge graph.
 * Python: knowledge_graph.py __init__ CREATE TABLE statements
 */
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS entities (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT DEFAULT 'unknown',
    properties TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS triples (
    id TEXT PRIMARY KEY,
    subject TEXT NOT NULL,
    predicate TEXT NOT NULL,
    object TEXT NOT NULL,
    valid_from TEXT,
    valid_to TEXT,
    confidence REAL DEFAULT 1.0,
    source_closet TEXT,
    source_file TEXT,
    extracted_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (subject) REFERENCES entities(id),
    FOREIGN KEY (object) REFERENCES entities(id)
  );

  CREATE INDEX IF NOT EXISTS idx_triples_subject ON triples(subject);
  CREATE INDEX IF NOT EXISTS idx_triples_object ON triples(object);
  CREATE INDEX IF NOT EXISTS idx_triples_predicate ON triples(predicate);
  CREATE INDEX IF NOT EXISTS idx_triples_valid ON triples(valid_from, valid_to);
  CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name);
`;

/**
 * Open or create a SQLite database with the knowledge graph schema.
 *
 * Python: knowledge_graph.py KnowledgeGraph.__init__() database setup
 *
 * @param dbPath - Path to the SQLite database file (default: ~/.mempalace/knowledge_graph.sqlite3)
 * @returns better-sqlite3 Database instance with WAL mode enabled
 */
export function openDatabase(dbPath: string = DEFAULT_KG_PATH): Database.Database {
  const resolved = resolvePath(dbPath);
  ensureDir(dirname(resolved));
  const db = new Database(resolved);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);
  return db;
}
