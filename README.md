# MemPalace-TS

TypeScript-native port of the MemPalace AI memory system.

**WORK IN PROGRESS - CAUTION**

## What is this

MemPalace-TS is a complete TypeScript port of the [Python MemPalace](https://github.com/yourpalal/mempalace) project, rewritten from scratch with idiomatic TypeScript patterns. It provides persistent, layered memory for AI coding agents -- identity, context retrieval, semantic search, and knowledge graphs -- backed by ChromaDB and SQLite. This is a library-first design for integration with TypeScript-based AI tooling and Node.js hook systems.

## Motivation

I am involved in harness development and agent coordination theory so memory is an implicit area of interest.

I prefer Typescript than Python, some people like eggs boiled, some prefer raw; thats individuality.

## Security First

> **This project treats supply chain security as a first-class requirement.**

- **5 production dependencies** -- reduced from the Python original's equivalent count by eliminating `uuid` and `date-fns` in favor of Node.js built-ins
- **All dependencies pinned** to exact versions (no `^` or `~` ranges)
- **Zero dynamic execution** -- no `eval()`, `new Function()`, or dynamic `require()`/`import()`
- **Parameterized SQL** throughout -- no string interpolation in queries
- **Zod-validated config** -- all external JSON is schema-validated at load time
- **Publish-safe** -- the `files` field restricts the npm package to `dist/` only
- See **[SECURITY.md](SECURITY.md)** for the full audit, dependency inventory, and verification commands

## Quick Start

```bash
npm install @mempalace-ts/core
```

```typescript
import { MemoryStack, KnowledgeGraph, searchMemories } from '@mempalace-ts/core';

// Wake up with identity + essential context
const stack = new MemoryStack();
const context = await stack.wakeUp();

// Search memories
const results = await searchMemories({ query: 'auth decisions' });

// Knowledge graph
const kg = new KnowledgeGraph();
kg.addTriple('Alice', 'works_on', 'ProjectX', { validFrom: '2025-01-01' });
```

## Integration with AI Tools

MemPalace-TS integrates with AI coding agents through its hook system:

- **Claude Code** -- hooks for auto-save on stop, precompact, and session-start events
- **Codex (OpenAI)** -- same hook contract, configured for the Codex harness

See **[SETUP.md](SETUP.md)** for detailed installation and configuration instructions.

## Architecture

### Layer System

Memory retrieval is organized into four tiers:

| Layer | Name | Description |
|-------|------|-------------|
| L0 | Identity | Core identity and personality. Always loaded. |
| L1 | Essential | High-priority memories, capped for context efficiency. |
| L2 | On-demand | Topic-specific retrieval when a query matches. |
| L3 | Deep search | Full semantic vector search across ChromaDB. |

### Palace Metaphor

Memories are organized into a spatial hierarchy: **wings** (broad categories) containing **rooms** (specific topics), connected by **halls** and **tunnels**. The miner automatically classifies content into this taxonomy based on file paths and content patterns. **Drawers** hold individual memory items within rooms.

### AAAK Dialect Compression

The Dialect module compresses memories using emotion codes and shorthand notation (Abbreviated Adaptive Associative Knowledge) to reduce token usage while preserving semantic content.

### Knowledge Graph

An entity-triple store backed by SQLite (`better-sqlite3`) with temporal metadata. Supports time-scoped queries over relationships between entities.

## Type Safety

- `strict: true` TypeScript with zero `any` in the public API
- Zod runtime validation at all external boundaries
- `ReadonlySet` for immutable constants
- Proper ESM with Node16 module resolution
- ChromaDB types wrapped once in a single module (no scattered casts)

## Testing

```bash
pnpm test    # 138 unit tests
pnpm bench   # Performance benchmarks (requires ChromaDB)
```

Test structure mirrors the Python original with full parity.

## Parity with Python

| Module | Status |
|--------|--------|
| Config | Complete |
| Miner | Complete |
| Convo Miner | Complete |
| Searcher | Complete |
| Knowledge Graph | Complete |
| Palace Graph | Complete |
| Layers (L0-L3) | Complete |
| Dialect (AAAK) | Complete |
| Hooks | Complete |
| Entity Detector | Complete |
| Room Detector | Complete |
| Spellcheck | Complete |
| Split Mega Files | Complete |
| General Extractor | Complete |
| Instructions | Complete |

## License

MIT
