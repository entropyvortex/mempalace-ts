# MemPalace-TS Setup Guide

**TypeScript-native memory palace for AI agents**

A complete, zero-Python port of the MemPalace project. Provides persistent memory, knowledge graphs, semantic search, and automatic session saving for AI coding agents.

---

## Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Node.js | >= 20 | Required by engine constraints |
| pnpm | >= 10 | Enforced via `packageManager` field (`pnpm@10.11.0`) |
| ChromaDB server | Latest | Required for vector search features; runs on `localhost:8000` by default |

### Installing ChromaDB

```bash
pip install chromadb
chroma run --path /tmp/chroma-data
```

Or via Docker:

```bash
docker run -p 8000:8000 chromadb/chroma
```

---

## Installation

```bash
git clone <repo-url>
cd mempalace-ts
pnpm install
pnpm build
```

Verify the build:

```bash
pnpm test
```

The monorepo contains three packages:

- **`@mempalace-ts/core`** -- Core library (memory stack, mining, search, hooks, knowledge graph)
- **`@mempalace-ts/cli`** -- Command-line interface
- **`@mempalace-ts/mcp`** -- MCP server (Model Context Protocol)

---

## Setting Up with Claude Code

### 1. Install Hooks for Auto-Save

MemPalace hooks integrate with Claude Code's hook system to automatically save session context at regular intervals and before context compaction. Three hooks are available:

| Hook | Function | Purpose |
|---|---|---|
| `stop` | `hookStop` | Blocks every 15 exchanges to trigger an auto-save checkpoint |
| `precompact` | `hookPrecompact` | Blocks before compaction to save all context that would otherwise be lost |
| `session-start` | `hookSessionStart` | Initializes session tracking state |

#### Step 1: Create a hook runner script

Create a file at `./scripts/mempalace-hook.mjs` (or any convenient location):

```javascript
#!/usr/bin/env node
/**
 * Hook runner for Claude Code.
 * Reads JSON from stdin, calls the appropriate mempalace hook,
 * and writes JSON response to stdout.
 *
 * Usage: echo '{"session_id":"..."}' | node mempalace-hook.mjs <hook-name>
 */
import { runHook } from '@mempalace-ts/core';

const hookName = process.argv[2]; // "stop", "precompact", or "session-start"

let input = '';
process.stdin.setEncoding('utf-8');
for await (const chunk of process.stdin) {
  input += chunk;
}

const data = JSON.parse(input);
const result = runHook(hookName, 'claude-code', data);
process.stdout.write(JSON.stringify(result));
```

Make it executable:

```bash
chmod +x ./scripts/mempalace-hook.mjs
```

#### Step 2: Configure Claude Code hooks

Add the following to your project-level `.claude/settings.json` or your user-level `~/.claude/settings.json`:

```json
{
  "hooks": {
    "stop": [
      {
        "command": "node /absolute/path/to/mempalace-ts/scripts/mempalace-hook.mjs stop",
        "timeout": 10000
      }
    ],
    "precompact": [
      {
        "command": "node /absolute/path/to/mempalace-ts/scripts/mempalace-hook.mjs precompact",
        "timeout": 10000
      }
    ],
    "session-start": [
      {
        "command": "node /absolute/path/to/mempalace-ts/scripts/mempalace-hook.mjs session-start",
        "timeout": 10000
      }
    ]
  }
}
```

Replace `/absolute/path/to/mempalace-ts/` with the actual path to your installation.

#### How it works

- **Stop hook**: Every 15 human messages, the hook returns `{ "decision": "block", "reason": "..." }`, which instructs Claude Code to pause and save key topics, decisions, quotes, and code to the memory system before continuing.
- **Precompact hook**: When context compaction is about to occur, the hook always blocks to ensure comprehensive saving of all session context.
- **Session-start hook**: Initializes state tracking for the session. Returns no blocking decision.

Hook state is stored in `~/.mempalace/hook_state/` and logs are written to `~/.mempalace/hook_state/hook.log`.

### 2. MCP Server (Future)

The `@mempalace-ts/mcp` package contains a Model Context Protocol server. This is a work in progress and not yet fully implemented in the TypeScript port. When complete, it will allow Claude Code to access memory search and storage through MCP tool calls.

### 3. Programmatic Usage in Claude Code Sessions

You can import and use mempalace functions directly:

```typescript
import {
  searchMemories,
  mine,
  mineConvos,
  MemoryStack,
  MempalaceConfig,
  KnowledgeGraph,
} from '@mempalace-ts/core';

// Wake-up flow: load identity + essential memories
const stack = new MemoryStack();
const context = await stack.wakeUp();

// Search memories by query
const results = await searchMemories('authentication refactor decisions');

// Mine a project directory into the memory palace
await mine('/path/to/project');

// Mine conversation transcripts
await mineConvos('/path/to/transcripts');
```

#### Layer System

MemoryStack provides tiered memory retrieval:

| Layer | Name | Purpose |
|---|---|---|
| L0 | Identity | Core identity and personality (always loaded) |
| L1 | Essential | Most important memories, capped for context efficiency |
| L2 | On-demand | Retrieved when a specific topic is queried |
| L3 | Deep search | Full semantic search across the entire palace |

---

## Setting Up with Codex (OpenAI)

### 1. Hook Integration

MemPalace hooks support Codex as a harness out of the box. The hook system accepts `'codex'` as a harness name.

#### Create a hook runner for Codex

```javascript
#!/usr/bin/env node
import { runHook } from '@mempalace-ts/core';

const hookName = process.argv[2];

let input = '';
process.stdin.setEncoding('utf-8');
for await (const chunk of process.stdin) {
  input += chunk;
}

const data = JSON.parse(input);
const result = runHook(hookName, 'codex', data);
process.stdout.write(JSON.stringify(result));
```

#### Configure in your Codex hook system

Register the runner script for the `stop`, `precompact`, and `session-start` events according to your Codex environment's hook configuration. The input/output contract is the same:

- **Input** (stdin): JSON object with `session_id`, `transcript_path`, and `stop_hook_active` fields
- **Output** (stdout): JSON object, optionally containing `{ "decision": "block", "reason": "..." }`

### 2. Programmatic Usage

```typescript
import { searchMemories, mine, MemoryStack } from '@mempalace-ts/core';

// Load context at session start
const stack = new MemoryStack();
const context = await stack.wakeUp();

// Search for relevant memories mid-session
const results = await searchMemories('database migration strategy');

// Mine project files
await mine('/path/to/project');
```

### 3. Integration Patterns

- **Session start**: Call `MemoryStack.wakeUp()` to hydrate L0 + L1 context.
- **Mid-session**: Use `searchMemories()` for L2/L3 retrieval when the agent encounters a topic that needs deeper context.
- **Session end / checkpoints**: The hook system handles this automatically, or call `mineConvos()` on the transcript manually.
- **Project onboarding**: Run `mine()` on new project directories to build the memory palace with room/wing taxonomy.

---

## Running Tests

```bash
pnpm test           # Unit tests (vitest)
pnpm bench          # Performance benchmarks (requires a running ChromaDB instance)
```

Additional commands:

```bash
pnpm lint           # ESLint across all packages
pnpm typecheck      # TypeScript type checking (tsc --build)
pnpm clean          # Remove all build artifacts
```

---

## Architecture Overview

### Module Structure

```
packages/
  core/           Core library
    config        Palace configuration and project detection
    miner         File mining: scans projects, chunks text, stores in ChromaDB
    convo-miner   Conversation transcript mining
    searcher      Semantic search across the memory palace
    knowledge-graph   Entity/triple store backed by SQLite (better-sqlite3)
    palace-graph  Graph traversal and tunnel detection across wings/rooms
    layers        L0-L3 memory stack with tiered retrieval
    dialect       AAAK compression for token-efficient storage
    hooks         Session hooks for Claude Code and Codex
    entity-detector   Named entity recognition in text
    room-detector     Automatic room/wing classification
    instructions      Instruction templates for AI agents
    spellcheck        Transcript spellchecking
    split-mega-files  Large file splitting at session boundaries
  cli/            Command-line interface
  mcp/            MCP server (Model Context Protocol)
```

### Layer System

```
L0 (Identity)     Always loaded. Core identity, personality, preferences.
      |
L1 (Essential)    Top-priority memories. Capped by drawer count and char limit.
      |
L2 (On-demand)    Topic-specific retrieval. Loaded when a query matches.
      |
L3 (Deep search)  Full semantic vector search across ChromaDB.
```

### AAAK Dialect Compression

The Dialect module compresses memories using emotion codes and shorthand notation to reduce token usage while preserving semantic content. This is the "AAAK" (Abbreviated Adaptive Associative Knowledge) encoding.

### Wing and Room Taxonomy

Memories are organized into **wings** (broad categories) containing **rooms** (specific topics). The miner automatically detects appropriate rooms based on file paths, content patterns, and folder structure.

---

## Supply Chain Security

This project follows strict supply chain security practices. See [SECURITY.md](./SECURITY.md) for full details, including:

- All dependencies pinned to exact versions (no `^` or `~` ranges)
- Reproducible installs via `packageManager` field
- No `eval()`, `new Function()`, or dynamic code execution
- All SQL queries use parameterized statements
- No telemetry or phone-home behavior

---

## Troubleshooting

### ChromaDB connection refused

Ensure ChromaDB is running on `localhost:8000` (the default). Start it with:

```bash
chroma run --path /tmp/chroma-data
```

### Hook not firing

1. Check that the path in your `settings.json` is absolute and correct.
2. Verify the script is executable: `chmod +x scripts/mempalace-hook.mjs`
3. Check hook logs: `cat ~/.mempalace/hook_state/hook.log`
4. Test manually: `echo '{"session_id":"test"}' | node scripts/mempalace-hook.mjs stop`

### Build failures

Ensure you are using the correct pnpm version:

```bash
corepack enable
corepack prepare pnpm@10.11.0 --activate
pnpm install
pnpm build
```
