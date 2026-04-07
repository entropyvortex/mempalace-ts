/**
 * @module knowledge-graph
 * Temporal entity-relationship knowledge graph backed by SQLite.
 *
 * CRITICAL — 1:1 PORT from original knowledge_graph.py
 *
 * Maps directly to:
 *   Python class: KnowledgeGraph
 *   Python file:  knowledge_graph.py
 *
 * The knowledge graph stores temporal triples (subject, predicate, object)
 * with validity windows (valid_from, valid_to). Facts can be invalidated
 * when they are no longer true, preserving the historical record.
 *
 * Schema (1:1 from Python):
 *   entities: id, name, type, properties, created_at
 *   triples:  id, subject, predicate, object, valid_from, valid_to,
 *             confidence, source_closet, source_file, extracted_at
 */

import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { formatDate } from './utils/date.js';
import { openDatabase } from './storage.js';
import { DEFAULT_KG_PATH } from './types.js';
import type {
  Entity,
  Triple,
  EntityRelationship,
  KnowledgeGraphStats,
  QueryDirection,
} from './types.js';

/** Row shape returned by triple queries with joined entity names. */
type TripleRow = Record<string, string | number | null> & {
  subject_name: string;
  object_name: string;
};

function rowToRelationship(row: TripleRow): EntityRelationship {
  return {
    id: String(row.id ?? ''),
    subject: row.subject_name,
    predicate: String(row.predicate ?? ''),
    object: row.object_name,
    valid_from: row.valid_from as string | null,
    valid_to: row.valid_to as string | null,
    confidence: Number(row.confidence ?? 1),
    source_closet: row.source_closet as string | null,
    source_file: row.source_file as string | null,
    extracted_at: String(row.extracted_at ?? ''),
    current: row.valid_to === null,
  };
}

/**
 * Temporal entity-relationship knowledge graph.
 *
 * 1:1 PORT from knowledge_graph.py KnowledgeGraph class.
 *
 * Python: class KnowledgeGraph:
 *   def __init__(self, db_path=None)
 *   def add_entity(name, entity_type="unknown", properties=None) -> str
 *   def add_triple(subject, predicate, obj, ...) -> str
 *   def invalidate(subject, predicate, obj, ended=None)
 *   def query_entity(name, as_of=None, direction="outgoing") -> list
 *   def query_relationship(predicate, as_of=None) -> list
 *   def timeline(entity_name=None) -> list
 *   def stats() -> dict
 *   def seed_from_entity_facts(entity_facts)
 */
export class KnowledgeGraph {
  private db: Database.Database;

  /**
   * Python: KnowledgeGraph.__init__(self, db_path=None)
   * TS: Opens or creates the SQLite database with the knowledge graph schema.
   *
   * @param dbPath - Path to the SQLite database file
   */
  constructor(dbPath: string = DEFAULT_KG_PATH) {
    this.db = openDatabase(dbPath);
  }

  /**
   * Add an entity to the knowledge graph.
   *
   * Python: KnowledgeGraph.add_entity(self, name, entity_type="unknown", properties=None) -> str
   * TS: this.addEntity(name, entityType, properties) -> string
   *
   * If an entity with the same name already exists, returns its existing ID.
   *
   * @param name - Entity name (e.g., "Alice", "Driftwood")
   * @param entityType - Entity type (e.g., "person", "project", "unknown")
   * @param properties - Optional properties dict
   * @returns Entity ID
   */
  addEntity(
    name: string,
    entityType: string = 'unknown',
    properties: Record<string, unknown> = {},
  ): string {
    // Python: Check if entity already exists by name
    const existing = this.db
      .prepare('SELECT id FROM entities WHERE name = ?')
      .get(name) as { id: string } | undefined;

    if (existing) return existing.id;

    const id = `e_${name.toLowerCase().replace(/\s+/g, '_')}_${randomUUID().slice(0, 8)}`;
    this.db
      .prepare('INSERT INTO entities (id, name, type, properties) VALUES (?, ?, ?, ?)')
      .run(id, name, entityType, JSON.stringify(properties));

    return id;
  }

  /**
   * Add a temporal triple (fact) to the knowledge graph.
   *
   * Python: KnowledgeGraph.add_triple(self, subject, predicate, obj,
   *           valid_from=None, valid_to=None, confidence=1.0,
   *           source_closet=None, source_file=None) -> str
   * TS: this.addTriple(subject, predicate, obj, options) -> string
   *
   * Automatically creates entities for subject and object if they don't exist.
   *
   * @param subject - Subject entity name
   * @param predicate - Relationship predicate (e.g., "works_on", "child_of")
   * @param obj - Object entity name
   * @param options - Optional fields: validFrom, validTo, confidence, sourceCloset, sourceFile
   * @returns Triple ID
   */
  addTriple(
    subject: string,
    predicate: string,
    obj: string,
    options: {
      validFrom?: string | null;
      validTo?: string | null;
      confidence?: number;
      sourceCloset?: string | null;
      sourceFile?: string | null;
    } = {},
  ): string {
    const {
      validFrom = null,
      validTo = null,
      confidence = 1.0,
      sourceCloset = null,
      sourceFile = null,
    } = options;

    // Python: Ensure both subject and object entities exist
    const subjectId = this.addEntity(subject);
    const objectId = this.addEntity(obj);

    // Python: t_{subject}_{predicate}_{object}_{uuid8}
    const id = `t_${subject.toLowerCase().replace(/\s+/g, '_')}_${predicate}_${obj.toLowerCase().replace(/\s+/g, '_')}_${randomUUID().slice(0, 8)}`;

    this.db
      .prepare(
        `INSERT INTO triples (id, subject, predicate, object, valid_from, valid_to, confidence, source_closet, source_file)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, subjectId, predicate, objectId, validFrom, validTo, confidence, sourceCloset, sourceFile);

    return id;
  }

  /**
   * Invalidate (end) a fact by setting its valid_to date.
   *
   * Python: KnowledgeGraph.invalidate(self, subject, predicate, obj, ended=None)
   * TS: this.invalidate(subject, predicate, obj, ended)
   *
   * Sets valid_to on all matching current triples (where valid_to IS NULL).
   *
   * @param subject - Subject entity name
   * @param predicate - Relationship predicate
   * @param obj - Object entity name
   * @param ended - End date (default: current date)
   */
  invalidate(subject: string, predicate: string, obj: string, ended?: string): void {
    const endDate = ended ?? formatDate(new Date());

    // Python: Find entity IDs by name
    const subjectRow = this.db
      .prepare('SELECT id FROM entities WHERE name = ?')
      .get(subject) as { id: string } | undefined;
    const objectRow = this.db
      .prepare('SELECT id FROM entities WHERE name = ?')
      .get(obj) as { id: string } | undefined;

    if (!subjectRow || !objectRow) return;

    // Python: UPDATE triples SET valid_to = ? WHERE subject = ? AND predicate = ? AND object = ? AND valid_to IS NULL
    this.db
      .prepare(
        `UPDATE triples SET valid_to = ?
         WHERE subject = ? AND predicate = ? AND object = ? AND valid_to IS NULL`,
      )
      .run(endDate, subjectRow.id, predicate, objectRow.id);
  }

  /**
   * Query all relationships for a given entity.
   *
   * Python: KnowledgeGraph.query_entity(self, name, as_of=None, direction="outgoing") -> list
   * TS: this.queryEntity(name, asOf, direction) -> EntityRelationship[]
   *
   * @param name - Entity name to query
   * @param asOf - Optional date filter (YYYY-MM-DD) — only return facts valid at this date
   * @param direction - "outgoing" (subject=entity), "incoming" (object=entity), or "both"
   * @returns Array of entity relationships
   */
  queryEntity(
    name: string,
    asOf?: string,
    direction: QueryDirection = 'outgoing',
  ): EntityRelationship[] {
    // Python: Find entity by name
    const entity = this.db
      .prepare('SELECT id FROM entities WHERE name = ?')
      .get(name) as { id: string } | undefined;

    if (!entity) return [];

    const results: EntityRelationship[] = [];

    // Python: Build query based on direction
    const queries: string[] = [];
    if (direction === 'outgoing' || direction === 'both') {
      queries.push(
        `SELECT t.*, e_sub.name as subject_name, e_obj.name as object_name
         FROM triples t
         JOIN entities e_sub ON t.subject = e_sub.id
         JOIN entities e_obj ON t.object = e_obj.id
         WHERE t.subject = ?`,
      );
    }
    if (direction === 'incoming' || direction === 'both') {
      queries.push(
        `SELECT t.*, e_sub.name as subject_name, e_obj.name as object_name
         FROM triples t
         JOIN entities e_sub ON t.subject = e_sub.id
         JOIN entities e_obj ON t.object = e_obj.id
         WHERE t.object = ?`,
      );
    }

    for (const sql of queries) {
      let fullSql = sql;
      const params: (string | number)[] = [entity.id];

      // Python: Time-window filter
      if (asOf) {
        fullSql += ` AND (t.valid_from IS NULL OR t.valid_from <= ?)
                      AND (t.valid_to IS NULL OR t.valid_to >= ?)`;
        params.push(asOf, asOf);
      }

      const rows = this.db.prepare(fullSql).all(...params) as TripleRow[];

      for (const row of rows) {
        results.push(rowToRelationship(row));
      }
    }

    return results;
  }

  /**
   * Query all triples with a given predicate.
   *
   * Python: KnowledgeGraph.query_relationship(self, predicate, as_of=None) -> list
   * TS: this.queryRelationship(predicate, asOf) -> EntityRelationship[]
   *
   * @param predicate - Relationship predicate to query
   * @param asOf - Optional date filter
   * @returns Array of matching relationships
   */
  queryRelationship(predicate: string, asOf?: string): EntityRelationship[] {
    let sql = `SELECT t.*, e_sub.name as subject_name, e_obj.name as object_name
               FROM triples t
               JOIN entities e_sub ON t.subject = e_sub.id
               JOIN entities e_obj ON t.object = e_obj.id
               WHERE t.predicate = ?`;
    const params: (string | number)[] = [predicate];

    if (asOf) {
      sql += ` AND (t.valid_from IS NULL OR t.valid_from <= ?)
               AND (t.valid_to IS NULL OR t.valid_to >= ?)`;
      params.push(asOf, asOf);
    }

    const rows = this.db.prepare(sql).all(...params) as TripleRow[];

    return rows.map(rowToRelationship);
  }

  /**
   * Get a chronological timeline for an entity or all entities.
   *
   * Python: KnowledgeGraph.timeline(self, entity_name=None) -> list
   * TS: this.timeline(entityName) -> EntityRelationship[]
   *
   * @param entityName - Optional entity name to filter timeline
   * @returns Array of relationships sorted chronologically
   */
  timeline(entityName?: string): EntityRelationship[] {
    let sql = `SELECT t.*, e_sub.name as subject_name, e_obj.name as object_name
               FROM triples t
               JOIN entities e_sub ON t.subject = e_sub.id
               JOIN entities e_obj ON t.object = e_obj.id`;
    const params: string[] = [];

    if (entityName) {
      const entity = this.db
        .prepare('SELECT id FROM entities WHERE name = ?')
        .get(entityName) as { id: string } | undefined;

      if (!entity) return [];

      sql += ' WHERE (t.subject = ? OR t.object = ?)';
      params.push(entity.id, entity.id);
    }

    sql += ' ORDER BY COALESCE(t.valid_from, t.extracted_at) ASC';

    const rows = this.db.prepare(sql).all(...params) as TripleRow[];

    return rows.map(rowToRelationship);
  }

  /**
   * Get knowledge graph statistics.
   *
   * Python: KnowledgeGraph.stats(self) -> dict
   * TS: this.stats() -> KnowledgeGraphStats
   *
   * @returns Object with entity/triple counts and relationship type listing
   */
  stats(): KnowledgeGraphStats {
    const entityCount = (
      this.db.prepare('SELECT COUNT(*) as count FROM entities').get() as { count: number }
    ).count;

    const tripleCount = (
      this.db.prepare('SELECT COUNT(*) as count FROM triples').get() as { count: number }
    ).count;

    const currentFacts = (
      this.db
        .prepare('SELECT COUNT(*) as count FROM triples WHERE valid_to IS NULL')
        .get() as { count: number }
    ).count;

    const expiredFacts = (
      this.db
        .prepare('SELECT COUNT(*) as count FROM triples WHERE valid_to IS NOT NULL')
        .get() as { count: number }
    ).count;

    const predicateRows = this.db
      .prepare('SELECT DISTINCT predicate FROM triples ORDER BY predicate')
      .all() as Array<{ predicate: string }>;

    return {
      entities: entityCount,
      triples: tripleCount,
      current_facts: currentFacts,
      expired_facts: expiredFacts,
      relationship_types: predicateRows.map((r) => r.predicate),
    };
  }

  /**
   * Seed the knowledge graph from entity facts (e.g., from entity detection).
   *
   * Python: KnowledgeGraph.seed_from_entity_facts(self, entity_facts)
   * TS: this.seedFromEntityFacts(entityFacts)
   *
   * @param entityFacts - Object with people and projects arrays
   */
  seedFromEntityFacts(entityFacts: {
    people?: Array<{ name: string }>;
    projects?: Array<{ name: string }>;
  }): void {
    const insertMany = this.db.transaction(() => {
      for (const person of entityFacts.people ?? []) {
        this.addEntity(person.name, 'person');
      }
      for (const project of entityFacts.projects ?? []) {
        this.addEntity(project.name, 'project');
      }
    });
    insertMany();
  }

  /**
   * Close the database connection.
   */
  close(): void {
    this.db.close();
  }
}
