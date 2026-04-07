/**
 * Knowledge Graph tests — parity with original Python test_config.py + knowledge_graph.py behavior.
 *
 * Tests the temporal entity-relationship graph:
 *   - Entity creation and deduplication
 *   - Triple creation with validity windows
 *   - Invalidation (ending facts)
 *   - Directional queries (outgoing, incoming, both)
 *   - Time-filtered queries (as_of)
 *   - Timeline generation
 *   - Statistics
 *   - Seeding from entity facts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { KnowledgeGraph } from '../src/knowledge-graph.js';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

describe('KnowledgeGraph', () => {
  let kg: KnowledgeGraph;
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'mempalace-test-'));
    dbPath = join(tempDir, 'test_kg.sqlite3');
    kg = new KnowledgeGraph(dbPath);
  });

  afterEach(() => {
    kg.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Entity Management
  // 1:1 PORT from knowledge_graph.py test patterns
  // -------------------------------------------------------------------------

  it('should add entities and return IDs', () => {
    const id1 = kg.addEntity('Alice', 'person');
    const id2 = kg.addEntity('Driftwood', 'project');

    expect(id1).toMatch(/^e_alice_/);
    expect(id2).toMatch(/^e_driftwood_/);
  });

  it('should deduplicate entities by name', () => {
    const id1 = kg.addEntity('Alice', 'person');
    const id2 = kg.addEntity('Alice', 'person');

    expect(id1).toBe(id2);
  });

  it('should add entity with properties', () => {
    const id = kg.addEntity('Bob', 'person', { role: 'engineer' });
    expect(id).toMatch(/^e_bob_/);
  });

  // -------------------------------------------------------------------------
  // Triple Management
  // Python: KnowledgeGraph.add_triple() behavior
  // -------------------------------------------------------------------------

  it('should add triples', () => {
    const tripleId = kg.addTriple('Alice', 'works_on', 'Driftwood');
    expect(tripleId).toMatch(/^t_alice_works_on_driftwood_/);
  });

  it('should auto-create entities when adding triples', () => {
    kg.addTriple('Charlie', 'loves', 'Coffee');
    const stats = kg.stats();
    expect(stats.entities).toBe(2); // Charlie + Coffee
    expect(stats.triples).toBe(1);
  });

  it('should add triples with validity windows', () => {
    kg.addTriple('Alice', 'works_at', 'Acme', {
      validFrom: '2020-01-01',
      validTo: '2023-06-30',
    });
    kg.addTriple('Alice', 'works_at', 'Newcorp', {
      validFrom: '2023-07-01',
    });

    // Query as of 2022 — should find Acme
    const results2022 = kg.queryEntity('Alice', '2022-06-01', 'outgoing');
    expect(results2022.some((r) => r.object === 'Acme')).toBe(true);
    expect(results2022.some((r) => r.object === 'Newcorp')).toBe(false);

    // Query as of 2024 — should find Newcorp
    const results2024 = kg.queryEntity('Alice', '2024-01-01', 'outgoing');
    expect(results2024.some((r) => r.object === 'Newcorp')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Invalidation
  // Python: KnowledgeGraph.invalidate() behavior
  // -------------------------------------------------------------------------

  it('should invalidate facts', () => {
    kg.addTriple('Alice', 'works_at', 'Acme');

    // Before invalidation
    let results = kg.queryEntity('Alice', undefined, 'outgoing');
    expect(results).toHaveLength(1);
    expect(results[0].current).toBe(true);

    // Invalidate
    kg.invalidate('Alice', 'works_at', 'Acme', '2023-12-31');

    // After invalidation — query without date shows the expired fact
    results = kg.queryEntity('Alice', undefined, 'outgoing');
    expect(results).toHaveLength(1);
    expect(results[0].current).toBe(false);
    expect(results[0].valid_to).toBe('2023-12-31');
  });

  // -------------------------------------------------------------------------
  // Queries
  // Python: KnowledgeGraph.query_entity() with direction
  // -------------------------------------------------------------------------

  it('should query outgoing relationships', () => {
    kg.addTriple('Alice', 'manages', 'Bob');
    kg.addTriple('Alice', 'manages', 'Charlie');

    const results = kg.queryEntity('Alice', undefined, 'outgoing');
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.object).sort()).toEqual(['Bob', 'Charlie']);
  });

  it('should query incoming relationships', () => {
    kg.addTriple('Alice', 'manages', 'Bob');
    kg.addTriple('Charlie', 'mentors', 'Bob');

    const results = kg.queryEntity('Bob', undefined, 'incoming');
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.subject).sort()).toEqual(['Alice', 'Charlie']);
  });

  it('should query both directions', () => {
    kg.addTriple('Alice', 'manages', 'Bob');
    kg.addTriple('Bob', 'works_on', 'Driftwood');

    const results = kg.queryEntity('Bob', undefined, 'both');
    expect(results).toHaveLength(2);
  });

  it('should query relationships by predicate', () => {
    kg.addTriple('Alice', 'works_on', 'Driftwood');
    kg.addTriple('Bob', 'works_on', 'Driftwood');
    kg.addTriple('Charlie', 'manages', 'Alice');

    const worksOn = kg.queryRelationship('works_on');
    expect(worksOn).toHaveLength(2);
    expect(worksOn.every((r) => r.predicate === 'works_on')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Timeline
  // Python: KnowledgeGraph.timeline()
  // -------------------------------------------------------------------------

  it('should return chronological timeline', () => {
    kg.addTriple('Alice', 'joined', 'Acme', { validFrom: '2020-01-01' });
    kg.addTriple('Alice', 'promoted_to', 'Senior', { validFrom: '2022-06-01' });
    kg.addTriple('Alice', 'left', 'Acme', { validFrom: '2023-12-01' });

    const timeline = kg.timeline('Alice');
    expect(timeline).toHaveLength(3);
    // Should be sorted by valid_from
    expect(timeline[0].predicate).toBe('joined');
    expect(timeline[1].predicate).toBe('promoted_to');
    expect(timeline[2].predicate).toBe('left');
  });

  it('should return full timeline when no entity specified', () => {
    kg.addTriple('Alice', 'works_on', 'Driftwood', { validFrom: '2023-01-01' });
    kg.addTriple('Bob', 'works_on', 'Starship', { validFrom: '2023-06-01' });

    const timeline = kg.timeline();
    expect(timeline).toHaveLength(2);
  });

  // -------------------------------------------------------------------------
  // Statistics
  // Python: KnowledgeGraph.stats()
  // -------------------------------------------------------------------------

  it('should return correct stats', () => {
    kg.addTriple('Alice', 'works_on', 'Driftwood');
    kg.addTriple('Bob', 'works_on', 'Driftwood');
    kg.invalidate('Bob', 'works_on', 'Driftwood');

    const stats = kg.stats();
    expect(stats.entities).toBe(3); // Alice, Bob, Driftwood
    expect(stats.triples).toBe(2);
    expect(stats.current_facts).toBe(1); // Alice → Driftwood
    expect(stats.expired_facts).toBe(1); // Bob → Driftwood (invalidated)
    expect(stats.relationship_types).toContain('works_on');
  });

  // -------------------------------------------------------------------------
  // Seeding
  // Python: KnowledgeGraph.seed_from_entity_facts()
  // -------------------------------------------------------------------------

  it('should seed from entity facts', () => {
    kg.seedFromEntityFacts({
      people: [{ name: 'Alice' }, { name: 'Bob' }],
      projects: [{ name: 'Driftwood' }],
    });

    const stats = kg.stats();
    expect(stats.entities).toBe(3);
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  it('should return empty results for unknown entities', () => {
    const results = kg.queryEntity('NonExistent');
    expect(results).toHaveLength(0);
  });

  it('should handle invalidation of non-existent triples', () => {
    // Should not throw
    kg.invalidate('NonExistent', 'fake_predicate', 'Also_NonExistent');
  });

  it('should return empty timeline for unknown entity', () => {
    const timeline = kg.timeline('NonExistent');
    expect(timeline).toHaveLength(0);
  });
});
