# Security Policy

## Dependency Policy

### Pinned Versions

All runtime dependencies are pinned to exact versions. No `^` or `~` ranges are used:

```json
"dependencies": {
  "better-sqlite3": "11.9.1",
  "chromadb": "1.9.2",
  "p-limit": "6.2.0",
  "yaml": "2.8.3",
  "zod": "4.3.6"
}
```

This eliminates supply chain risk from automatic minor/patch upgrades introducing compromised code.

### Reproducible Installs

The root `package.json` declares an exact `packageManager` field:

```json
"packageManager": "pnpm@10.11.0"
```

Combined with pnpm's lockfile, this ensures every install produces an identical `node_modules` tree regardless of when or where it runs.

### Restricted Build Scripts

The `onlyBuiltDependencies` field restricts which packages are allowed to run native build scripts during installation:

```json
"pnpm": {
  "onlyBuiltDependencies": ["better-sqlite3", "esbuild"]
}
```

All other packages are blocked from executing install/postinstall scripts, preventing a common supply chain attack vector.

---

## Dependency Inventory

| Package | Version | Purpose |
|---|---|---|
| `better-sqlite3` | 11.9.1 | SQLite3 native bindings for the knowledge graph (entity/triple store) |
| `chromadb` | 1.9.2 | Vector database client for semantic search across the memory palace |
| `p-limit` | 6.2.0 | Concurrency control for parallel file mining operations |
| `yaml` | 2.8.3 | YAML parser for project configuration files |
| `zod` | 4.3.6 | Runtime schema validation for configuration and hook inputs |

### Dev Dependencies (not shipped)

| Package | Version | Purpose |
|---|---|---|
| `@types/better-sqlite3` | 7.6.13 | TypeScript type definitions |
| `typescript` | 5.8.3 | TypeScript compiler |
| `vitest` | 3.2.1 | Test runner |
| `eslint` | 9.27.0 | Linter |
| `prettier` | 3.5.3 | Code formatter |
| `@typescript-eslint/*` | 8.32.1 | TypeScript ESLint integration |

---

## Code Security

### No Dynamic Code Execution

The codebase contains no instances of:

- `eval()`
- `new Function()`
- Dynamic `require()` or `import()` with user-supplied paths

### Parameterized SQL

All SQL queries in the knowledge graph module use parameterized statements. No query is built through string interpolation or concatenation:

```typescript
// Example pattern used throughout knowledge-graph.ts
db.prepare('SELECT * FROM entities WHERE name = ?').get(name);
```

### Input Sanitization

- Regex inputs are escaped via dedicated escape functions before being passed to `new RegExp()`
- Session IDs in the hook system are sanitized to alphanumeric characters, underscores, and hyphens only
- Hook input structure is validated before processing

### Filesystem Scoping

- File paths are resolved but scoped to user-configured directories
- The miner respects `.gitignore` rules via a dedicated `GitignoreMatcher`
- Skip directories (`node_modules`, `.git`, etc.) are enforced at scan time

### Network Boundaries

- The only network requests are to the configured ChromaDB endpoint (`localhost:8000` by default)
- No telemetry, analytics, or phone-home behavior
- No external API calls beyond ChromaDB

### Child Process Usage

The hook system (`hooks.ts`) uses `child_process.spawn` in a single, controlled case: triggering background auto-ingest when the `MEMPAL_DIR` environment variable is set. The command is hardcoded (not user-supplied) and the child process is detached and unreferenced.

---

## What We Don't Do

- **No telemetry or phone-home.** The library makes zero network requests except to the user's own configured ChromaDB instance.
- **No dynamic code execution.** No `eval()`, `new Function()`, or runtime code generation of any kind.
- **No credential storage.** The library does not store, manage, or transmit credentials, API keys, or tokens.
- **No network-supplied input reaching the filesystem.** Data from ChromaDB responses is never used to construct file paths or write to the filesystem.
- **No prototype pollution vectors.** Object construction uses typed interfaces and Zod schemas, not arbitrary key assignment from external input.

---

## Reporting Vulnerabilities

If you discover a security vulnerability in mempalace-ts, please report it responsibly:

1. **Do not** open a public GitHub issue for security vulnerabilities.
2. Send a detailed report to the project maintainers via email or a private GitHub Security Advisory.
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)
4. Allow up to 72 hours for an initial response.
5. We will coordinate disclosure timing with you and credit you in the advisory (unless you prefer otherwise).

We follow a coordinated disclosure model. Fixes will be released as soon as practical, and a public advisory will be issued once a patched version is available.

---

## Auditing

### Verify No Dynamic Execution

```bash
grep -r "eval\|Function(" packages/*/src/   # Should find zero matches
```

### Audit Child Process Usage

```bash
grep -r "exec\|spawn" packages/*/src/       # Only in hooks.ts (controlled spawn)
```

### Check for Known Vulnerabilities

```bash
pnpm audit
```

### Verify Pinned Dependencies

```bash
# Ensure no range specifiers in production dependencies
grep -E '["'"'"']\^|["'"'"']~' packages/core/package.json
# Should produce no output
```

### Review Network Calls

```bash
grep -r "fetch\|http\|https\|net\." packages/*/src/ --include="*.ts"
# Only chromadb-related references expected
```
