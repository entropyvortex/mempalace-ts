#!/usr/bin/env node
/**
 * @module cli
 * CLI entry point for mempalace-ts.
 *
 * 1:1 PORT from original cli.py
 *
 * Commands:
 *   init <dir>                — Detect rooms, setup config
 *   mine <dir>                — Mine project files
 *   mine <dir> --mode convos  — Mine conversations
 *   search "query"            — Semantic search
 *   wake-up                   — L0 + L1 context
 *   compress                  — AAAK compress
 *   status                    — Show palace contents
 *   split <dir>               — Split mega-files into per-session files
 *   repair                    — Rebuild vector index
 *   hook run                  — Run hook logic (stdin JSON → stdout JSON)
 *   instructions <name>       — Output skill instructions
 */

import { Command } from 'commander';
import {
  mine,
  mineConvos,
  search,
  MemoryStack,
  Dialect,
  miningStatus,
  getCollection,
  getDrawers,
  loadConfig,
  scanProject,
  resolvePath,
  ensureDir,
  // NEW modules
  MempalaceConfig,
  detectRoomsLocal,
  scanForDetection,
  detectEntities,
  splitMegaFiles,
  runHook,
  getInstructions,
  AVAILABLE_INSTRUCTIONS,
} from '@mempalace-ts/core';
import { writeFileSync, existsSync, cpSync, rmSync } from 'node:fs';
import { join, basename } from 'node:path';
import { stringify as yamlStringify } from 'yaml';
import type { ExtractMode, HookName, HarnessName } from '@mempalace-ts/core';

const program = new Command();

program
  .name('mempalace-ts')
  .description('TypeScript-native memory palace for AI agents')
  .version('1.0.0');

// ---------------------------------------------------------------------------
// init — Detect rooms, setup config (enhanced with entity detection + room detector)
// Python: cli.py cmd_init
// ---------------------------------------------------------------------------
program
  .command('init')
  .argument('<dir>', 'Project directory to initialize')
  .option('--yes', 'Auto-accept all detected entities (non-interactive)')
  .description('Initialize a mempalace config for a project directory')
  .action(async (dir: string, opts) => {
    const resolved = resolvePath(dir);
    const configPath = join(resolved, 'mempalace.yaml');

    if (existsSync(configPath)) {
      console.log(`Config already exists: ${configPath}`);
      return;
    }

    ensureDir(resolved);

    // Pass 1: auto-detect people and projects from file content
    console.log(`\n  Scanning for entities in: ${dir}`);
    const files = scanForDetection(resolved);
    if (files.length > 0) {
      console.log(`  Reading ${files.length} files...`);
      const detected = detectEntities(files);
      const total = detected.people.length + detected.projects.length + detected.uncertain.length;
      if (total > 0) {
        console.log(`  Detected: ${detected.people.length} people, ${detected.projects.length} projects`);
        // Save confirmed entities
        if (detected.people.length > 0 || detected.projects.length > 0) {
          const entitiesPath = join(resolved, 'entities.json');
          writeFileSync(entitiesPath, JSON.stringify({
            people: detected.people,
            projects: detected.projects,
          }, null, 2));
          console.log(`  Entities saved: ${entitiesPath}`);
        }
      } else {
        console.log('  No entities detected — proceeding with directory-based rooms.');
      }
    }

    // Pass 2: detect rooms from folder structure (using new room-detector module)
    const { rooms, source } = detectRoomsLocal(resolved);
    const projectName = basename(resolved).toLowerCase().replace(/[\s-]/g, '_');

    console.log(`\n${'='.repeat(55)}`);
    console.log('  MemPalace Init — Local setup');
    console.log(`${'='.repeat(55)}`);
    console.log(`\n  WING: ${projectName}`);
    console.log(`  (${files.length} files found, rooms detected from ${source})\n`);
    for (const room of rooms) {
      console.log(`    ROOM: ${room.name}`);
      console.log(`          ${room.description}`);
    }
    console.log(`\n${'─'.repeat(55)}`);

    const config = {
      wing: `wing_${projectName}`,
      rooms,
    };

    writeFileSync(configPath, yamlStringify(config), 'utf-8');
    console.log(`\n  Config saved: ${configPath}`);
    console.log(`\n  Next step:`);
    console.log(`    mempalace-ts mine ${dir}`);
    console.log(`\n${'='.repeat(55)}\n`);

    // Initialize global config
    new MempalaceConfig().init();
  });

// ---------------------------------------------------------------------------
// mine — Mine project files or conversations (enhanced with gitignore support)
// Python: cli.py cmd_mine
// ---------------------------------------------------------------------------
program
  .command('mine')
  .argument('<dir>', 'Directory to mine')
  .option('--palace <path>', 'Palace path')
  .option('--wing <name>', 'Wing name override')
  .option('--agent <name>', 'Agent name', 'mempalace')
  .option('--limit <n>', 'Max files to process', '0')
  .option('--dry-run', 'Preview only')
  .option('--mode <mode>', 'Mining mode: projects or convos', 'projects')
  .option('--extract <mode>', 'Extract mode for convos: exchange or general', 'exchange')
  .option('--no-gitignore', "Don't respect .gitignore files when scanning")
  .option('--include-ignored <paths...>', 'Always scan these paths even if ignored')
  .description('Mine files into the memory palace')
  .action(async (dir: string, opts) => {
    const limit = parseInt(opts.limit, 10);
    const dryRun = opts.dryRun ?? false;

    // Parse include-ignored (supports comma-separated)
    const includeIgnored: string[] = [];
    for (const raw of opts.includeIgnored ?? []) {
      includeIgnored.push(...raw.split(',').map((s: string) => s.trim()).filter(Boolean));
    }

    if (opts.mode === 'convos') {
      console.log(`Mining conversations from: ${dir}`);
      const result = await mineConvos({
        convoDir: dir,
        palacePath: opts.palace,
        wing: opts.wing,
        agent: opts.agent,
        limit,
        dryRun,
        extractMode: opts.extract as ExtractMode,
      });
      console.log(`Files processed: ${result.filesProcessed}`);
      console.log(`Drawers added: ${result.drawersAdded}`);
    } else {
      console.log(`Mining project files from: ${dir}`);
      const result = await mine({
        projectDir: dir,
        palacePath: opts.palace,
        wingOverride: opts.wing,
        agent: opts.agent,
        limit,
        dryRun,
        respectGitignore: opts.gitignore !== false,
        includeIgnored,
      });
      console.log(`Files processed: ${result.filesProcessed}`);
      console.log(`Drawers added: ${result.drawersAdded}`);
    }
  });

// ---------------------------------------------------------------------------
// search — Semantic search
// Python: cli.py cmd_search
// ---------------------------------------------------------------------------
program
  .command('search')
  .argument('<query>', 'Search query')
  .option('--palace <path>', 'Palace path')
  .option('--wing <name>', 'Filter by wing')
  .option('--room <name>', 'Filter by room')
  .option('--results <n>', 'Number of results', '5')
  .description('Search the memory palace')
  .action(async (query: string, opts) => {
    await search({
      query,
      wing: opts.wing,
      room: opts.room,
      nResults: parseInt(opts.results, 10),
    });
  });

// ---------------------------------------------------------------------------
// wake-up — Load L0 + L1 context
// Python: cli.py cmd_wakeup
// ---------------------------------------------------------------------------
program
  .command('wake-up')
  .option('--palace <path>', 'Palace path')
  .option('--wing <name>', 'Filter by wing')
  .description('Generate wake-up context (L0 + L1)')
  .action(async (opts) => {
    const stack = new MemoryStack(opts.palace);
    const context = await stack.wakeUp(opts.wing);
    console.log(context);
  });

// ---------------------------------------------------------------------------
// compress — AAAK compression
// Python: cli.py cmd_compress
// ---------------------------------------------------------------------------
program
  .command('compress')
  .option('--palace <path>', 'Palace path')
  .option('--wing <name>', 'Wing to compress')
  .option('--dry-run', 'Preview only')
  .option('--config <path>', 'Entity config JSON (e.g. entities.json)')
  .description('Compress drawers using AAAK dialect')
  .action(async (opts) => {
    let dialect: InstanceType<typeof Dialect>;

    // Load dialect config if available
    const configPath = opts.config;
    if (configPath && existsSync(configPath)) {
      dialect = Dialect.fromConfig(configPath);
      console.log(`  Loaded entity config: ${configPath}`);
    } else {
      dialect = new Dialect();
    }

    const collection = await getCollection();
    const drawers = await getDrawers(collection, opts.wing);

    const wingLabel = opts.wing ? ` in wing '${opts.wing}'` : '';
    if (drawers.length === 0) {
      console.log(`\n  No drawers found${wingLabel}.`);
      return;
    }

    console.log(`\n  Compressing ${drawers.length} drawers${wingLabel}...`);
    console.log();

    let totalOriginal = 0;
    let totalCompressed = 0;

    for (const drawer of drawers) {
      const compressed = dialect.compress(drawer.content, {
        wing: String(drawer.metadata.wing ?? ''),
        room: String(drawer.metadata.room ?? ''),
      });
      const stats = dialect.compressionStats(drawer.content, compressed);
      totalOriginal += stats.original_tokens;
      totalCompressed += stats.compressed_tokens;

      if (opts.dryRun) {
        const wing = drawer.metadata.wing ?? '?';
        const room = drawer.metadata.room ?? '?';
        const source = basename(String(drawer.metadata.source_file ?? '?'));
        console.log(`  [${wing}/${room}] ${source}`);
        console.log(`    ${stats.original_tokens}t -> ${stats.compressed_tokens}t (${stats.ratio.toFixed(1)}x)`);
        console.log(`    ${compressed}`);
        console.log();
      }
    }

    const ratio = totalCompressed > 0 ? (totalOriginal / totalCompressed).toFixed(1) : '0';
    console.log(`  Total: ${totalOriginal}t -> ${totalCompressed}t (${ratio}x compression)`);
    if (opts.dryRun) {
      console.log('  (dry run -- nothing stored)');
    }
  });

// ---------------------------------------------------------------------------
// split — Split concatenated mega-files (NEW)
// Python: cli.py cmd_split
// ---------------------------------------------------------------------------
program
  .command('split')
  .argument('<dir>', 'Directory containing transcript files')
  .option('--output-dir <path>', 'Write split files here (default: same directory)')
  .option('--dry-run', 'Show what would be split without writing files')
  .option('--min-sessions <n>', 'Only split files with at least N sessions', '2')
  .description('Split concatenated transcript mega-files into per-session files')
  .action(async (dir: string, opts) => {
    splitMegaFiles({
      sourceDir: dir,
      outputDir: opts.outputDir,
      minSessions: parseInt(opts.minSessions, 10),
      dryRun: opts.dryRun ?? false,
    });
  });

// ---------------------------------------------------------------------------
// repair — Rebuild palace vector index (NEW)
// Python: cli.py cmd_repair
// ---------------------------------------------------------------------------
program
  .command('repair')
  .option('--palace <path>', 'Palace path')
  .description('Rebuild palace vector index from stored data')
  .action(async (opts) => {
    const config = new MempalaceConfig();
    const palacePath: string = opts.palace ?? config.palacePath;

    if (!existsSync(palacePath)) {
      console.log(`\n  No palace found at ${palacePath}`);
      return;
    }

    console.log(`\n${'='.repeat(55)}`);
    console.log('  MemPalace Repair');
    console.log(`${'='.repeat(55)}\n`);
    console.log(`  Palace: ${palacePath}`);

    try {
      const collection = await getCollection();
      const total = await collection.count();
      console.log(`  Drawers found: ${total}`);

      if (total === 0) {
        console.log('  Nothing to repair.');
        return;
      }

      // Extract all drawers in batches
      console.log('\n  Extracting drawers...');
      const batchSize = 5000;
      const allIds: string[] = [];
      const allDocs: string[] = [];
      const allMetas: Record<string, unknown>[] = [];
      let offset = 0;

      while (offset < total) {
        const batch = await collection.get({
          limit: batchSize,
          offset,
          include: ['documents' as any, 'metadatas' as any],
        });
        allIds.push(...(batch.ids ?? []));
        allDocs.push(...((batch.documents ?? []) as string[]));
        allMetas.push(...((batch.metadatas ?? []) as Record<string, unknown>[]));
        offset += batchSize;
      }
      console.log(`  Extracted ${allIds.length} drawers`);

      // Backup
      const backupPath = palacePath + '.backup';
      if (existsSync(backupPath)) {
        rmSync(backupPath, { recursive: true, force: true });
      }
      console.log(`  Backing up to ${backupPath}...`);
      cpSync(palacePath, backupPath, { recursive: true });

      // Rebuild — get a fresh collection and re-add all drawers
      console.log('  Rebuilding collection...');
      // Delete all existing drawers and re-add them
      await collection.delete({ ids: allIds });
      console.log('  Cleared existing drawers');

      let filed = 0;
      for (let i = 0; i < allIds.length; i += batchSize) {
        const batchIds = allIds.slice(i, i + batchSize);
        const batchDocs = allDocs.slice(i, i + batchSize);
        const batchMetas = allMetas.slice(i, i + batchSize);
        await collection.add({
          ids: batchIds,
          documents: batchDocs,
          metadatas: batchMetas as any,
        });
        filed += batchIds.length;
        console.log(`  Re-filed ${filed}/${allIds.length} drawers...`);
      }

      console.log(`\n  Repair complete. ${filed} drawers rebuilt.`);
      console.log(`  Backup saved at ${backupPath}`);
      console.log(`\n${'='.repeat(55)}\n`);
    } catch (e) {
      console.log(`  Error: ${(e as Error).message}`);
      console.log('  Cannot recover — palace may need to be re-mined from source files.');
    }
  });

// ---------------------------------------------------------------------------
// hook — Run hook logic (NEW)
// Python: cli.py cmd_hook
// ---------------------------------------------------------------------------
const hookCmd = program
  .command('hook')
  .description('Run hook logic (reads JSON from stdin, outputs JSON to stdout)');

hookCmd
  .command('run')
  .requiredOption('--hook <name>', 'Hook name: session-start, stop, precompact')
  .requiredOption('--harness <name>', 'Harness type: claude-code, codex')
  .description('Execute a hook')
  .action(async (opts) => {
    // Read JSON from stdin
    let data: Record<string, unknown> = {};
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) {
        chunks.push(chunk);
      }
      const input = Buffer.concat(chunks).toString('utf-8');
      if (input.trim()) {
        data = JSON.parse(input);
      }
    } catch {
      data = {};
    }

    const result = runHook(
      opts.hook as HookName,
      opts.harness as HarnessName,
      data,
    );
    console.log(JSON.stringify(result, null, 2));
  });

// ---------------------------------------------------------------------------
// instructions — Output skill instructions (NEW)
// Python: cli.py cmd_instructions
// ---------------------------------------------------------------------------
const instrCmd = program
  .command('instructions')
  .description('Output skill instructions to stdout');

for (const name of AVAILABLE_INSTRUCTIONS) {
  instrCmd
    .command(name)
    .description(`Output ${name} instructions`)
    .action(() => {
      try {
        console.log(getInstructions(name));
      } catch (e) {
        console.error((e as Error).message);
        process.exit(1);
      }
    });
}

// ---------------------------------------------------------------------------
// status — Show palace contents
// Python: cli.py cmd_status
// ---------------------------------------------------------------------------
program
  .command('status')
  .option('--palace <path>', 'Palace path')
  .description('Show memory palace status')
  .action(async (_opts) => {
    try {
      const result = await miningStatus();
      console.log(`\nMemory Palace Status`);
      console.log(`  Total drawers: ${result.drawerCount}`);
      console.log(`  Wings:`);
      for (const [wing, count] of Object.entries(result.wings)) {
        console.log(`    ${wing}: ${count} drawers`);
      }
    } catch (e) {
      console.log('Palace not initialized or ChromaDB not running.');
      console.log('Run: mempalace-ts init <dir>');
    }
  });

program.parse();
