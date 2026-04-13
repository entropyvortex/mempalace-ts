/**
 * @module onboarding
 * MemPalace first-run setup.
 *
 * 1:1 PORT from original onboarding.py
 *
 * Maps directly to:
 *   Python file: onboarding.py — run_onboarding(), quick_setup(), DEFAULT_WINGS
 *
 * Asks the user:
 *   1. How they're using MemPalace (work / personal / combo)
 *   2. Who the people in their life are (names, nicknames, relationships)
 *   3. What their projects are
 *   4. What they want their wings called
 *
 * Seeds the entity_registry with confirmed data so MemPalace knows your world
 * from minute one — before a single session is indexed.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { EntityRegistry, COMMON_ENGLISH_WORDS } from './entity-registry.js';
import { detectEntities, scanForDetection } from './entity-detector.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A person entry from onboarding input. */
export interface PersonEntry {
  name: string;
  relationship: string;
  context: string;
}

/** The mode of MemPalace usage. */
export type PalaceMode = 'work' | 'personal' | 'combo';

// ---------------------------------------------------------------------------
// Default wing taxonomies by mode
// Python: onboarding.py — DEFAULT_WINGS
// ---------------------------------------------------------------------------

export const DEFAULT_WINGS: Record<PalaceMode, readonly string[]> = {
  work: [
    'projects',
    'clients',
    'team',
    'decisions',
    'research',
  ],
  personal: [
    'family',
    'health',
    'creative',
    'reflections',
    'relationships',
  ],
  combo: [
    'family',
    'work',
    'health',
    'creative',
    'projects',
    'reflections',
  ],
};

// ---------------------------------------------------------------------------
// Helpers
// Python: onboarding.py — _hr(), _header(), _ask(), _yn()
// ---------------------------------------------------------------------------

const HR_WIDTH = 58;

function hr(): void {
  console.log(`\n${'─'.repeat(HR_WIDTH)}`);
}

function header(text: string): void {
  console.log(`\n${'='.repeat(HR_WIDTH)}`);
  console.log(`  ${text}`);
  console.log('='.repeat(HR_WIDTH));
}

async function ask(
  rl: ReturnType<typeof createInterface>,
  prompt: string,
  defaultVal?: string,
): Promise<string> {
  const suffix = defaultVal ? ` [${defaultVal}]` : '';
  const answer = (await rl.question(`  ${prompt}${suffix}: `)).trim();
  return answer || defaultVal || '';
}

async function yn(
  rl: ReturnType<typeof createInterface>,
  prompt: string,
  defaultVal: 'y' | 'n' = 'y',
): Promise<boolean> {
  const hint = defaultVal === 'y' ? 'Y/n' : 'y/N';
  const answer = (await rl.question(`  ${prompt} [${hint}]: `)).trim().toLowerCase();
  if (!answer) return defaultVal === 'y';
  return answer.startsWith('y');
}

// ---------------------------------------------------------------------------
// Step 1: Mode selection
// Python: onboarding.py — _ask_mode()
// ---------------------------------------------------------------------------

async function askMode(rl: ReturnType<typeof createInterface>): Promise<PalaceMode> {
  header('Welcome to MemPalace');
  console.log(`
  MemPalace is a personal memory system. To work well, it needs to know
  a little about your world — who the people are, what the projects
  are, and how you want your memory organized.

  This takes about 2 minutes. You can always update it later.
`);
  console.log('  How are you using MemPalace?');
  console.log();
  console.log('    [1]  Work     — notes, projects, clients, colleagues, decisions');
  console.log('    [2]  Personal — diary, family, health, relationships, reflections');
  console.log('    [3]  Both     — personal and professional mixed');
  console.log();

  while (true) {
    const choice = (await rl.question('  Your choice [1/2/3]: ')).trim();
    if (choice === '1') return 'work';
    if (choice === '2') return 'personal';
    if (choice === '3') return 'combo';
    console.log('  Please enter 1, 2, or 3.');
  }
}

// ---------------------------------------------------------------------------
// Step 2: People
// Python: onboarding.py — _ask_people()
// ---------------------------------------------------------------------------

async function askPeople(
  rl: ReturnType<typeof createInterface>,
  mode: PalaceMode,
): Promise<{ people: PersonEntry[]; aliases: Record<string, string> }> {
  const people: PersonEntry[] = [];
  const aliases: Record<string, string> = {}; // nickname → full name

  if (mode === 'personal' || mode === 'combo') {
    hr();
    console.log(`
  Personal world — who are the important people in your life?

  Format: name, relationship (e.g. "Riley, daughter" or just "Devon")
  For nicknames, you'll be asked separately.
  Type 'done' when finished.
`);
    while (true) {
      const entry = (await rl.question('  Person: ')).trim();
      if (entry.toLowerCase() === 'done' || entry === '') break;
      const parts = entry.split(',', 2).map((p) => p.trim());
      const name = parts[0];
      const relationship = parts[1] ?? '';
      if (name) {
        const nick = (await rl.question(`  Nickname for ${name}? (or enter to skip): `)).trim();
        if (nick) {
          aliases[nick] = name;
        }
        people.push({ name, relationship, context: 'personal' });
      }
    }
  }

  if (mode === 'work' || mode === 'combo') {
    hr();
    console.log(`
  Work world — who are the colleagues, clients, or collaborators
  you'd want to find in your notes?

  Format: name, role (e.g. "Ben, co-founder" or just "Sarah")
  Type 'done' when finished.
`);
    while (true) {
      const entry = (await rl.question('  Person: ')).trim();
      if (entry.toLowerCase() === 'done' || entry === '') break;
      const parts = entry.split(',', 2).map((p) => p.trim());
      const name = parts[0];
      const role = parts[1] ?? '';
      if (name) {
        people.push({ name, relationship: role, context: 'work' });
      }
    }
  }

  return { people, aliases };
}

// ---------------------------------------------------------------------------
// Step 3: Projects
// Python: onboarding.py — _ask_projects()
// ---------------------------------------------------------------------------

async function askProjects(
  rl: ReturnType<typeof createInterface>,
  mode: PalaceMode,
): Promise<string[]> {
  if (mode === 'personal') return [];

  hr();
  console.log(`
  What are your main projects? (These help MemPalace distinguish project
  names from person names — e.g. "Lantern" the project vs. "Lantern" the word.)

  Type 'done' when finished.
`);
  const projects: string[] = [];
  while (true) {
    const proj = (await rl.question('  Project: ')).trim();
    if (proj.toLowerCase() === 'done' || proj === '') break;
    if (proj) projects.push(proj);
  }
  return projects;
}

// ---------------------------------------------------------------------------
// Step 4: Wings
// Python: onboarding.py — _ask_wings()
// ---------------------------------------------------------------------------

async function askWings(
  rl: ReturnType<typeof createInterface>,
  mode: PalaceMode,
): Promise<string[]> {
  const defaults = DEFAULT_WINGS[mode];
  hr();
  console.log(`
  Wings are the top-level categories in your memory palace.

  Suggested wings for ${mode} mode:
    ${defaults.join(', ')}

  Press enter to keep these, or type your own comma-separated list.
`);
  const custom = (await rl.question('  Wings: ')).trim();
  if (custom) {
    return custom.split(',').map((w) => w.trim()).filter(Boolean);
  }
  return [...defaults];
}

// ---------------------------------------------------------------------------
// Step 5: Auto-detect from files
// Python: onboarding.py — _auto_detect()
// ---------------------------------------------------------------------------

/**
 * Scan directory for additional entity candidates.
 * Python: onboarding.py — _auto_detect()
 */
function autoDetect(
  directory: string,
  knownPeople: PersonEntry[],
): { name: string; confidence: number; signal_count: number }[] {
  const knownNames = new Set(knownPeople.map((p) => p.name.toLowerCase()));

  try {
    const files = scanForDetection(directory);
    if (files.length === 0) return [];
    const detected = detectEntities(files);
    return detected.people.filter(
      (e) => !knownNames.has(e.name.toLowerCase()) && e.confidence >= 0.7,
    );
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Step 6: Ambiguity warnings
// Python: onboarding.py — _warn_ambiguous()
// ---------------------------------------------------------------------------

/**
 * Flag names that are also common English words.
 * Returns list of ambiguous names for user awareness.
 * Python: onboarding.py — _warn_ambiguous()
 */
function warnAmbiguous(people: PersonEntry[]): string[] {
  const ambiguous: string[] = [];
  for (const p of people) {
    if (COMMON_ENGLISH_WORDS.has(p.name.toLowerCase())) {
      ambiguous.push(p.name);
    }
  }
  return ambiguous;
}

// ---------------------------------------------------------------------------
// AAAK Bootstrap Generation
// Python: onboarding.py — _generate_aaak_bootstrap()
// ---------------------------------------------------------------------------

/**
 * Generate AAAK entity registry + critical facts bootstrap from onboarding data.
 * These files teach the AI about the user's world from session one.
 * Python: onboarding.py — _generate_aaak_bootstrap()
 */
function generateAaakBootstrap(
  people: PersonEntry[],
  projects: string[],
  wings: string[],
  mode: PalaceMode,
  configDir?: string,
): void {
  const mempalaceDir = configDir ?? join(homedir(), '.mempalace');
  mkdirSync(mempalaceDir, { recursive: true });

  // Build AAAK entity codes (first 3 letters of name, uppercase)
  const entityCodes: Record<string, string> = {};
  const usedCodes = new Set<string>();

  for (const p of people) {
    const name = p.name;
    let code = name.slice(0, 3).toUpperCase();
    // Handle collisions
    if (usedCodes.has(code)) {
      code = name.slice(0, 4).toUpperCase();
    }
    entityCodes[name] = code;
    usedCodes.add(code);
  }

  // AAAK entity registry
  const registryLines: string[] = [
    '# AAAK Entity Registry',
    '# Auto-generated by mempalace init. Update as needed.',
    '',
    '## People',
  ];

  for (const p of people) {
    const name = p.name;
    const code = entityCodes[name];
    const rel = p.relationship;
    registryLines.push(rel ? `  ${code}=${name} (${rel})` : `  ${code}=${name}`);
  }

  if (projects.length > 0) {
    registryLines.push('', '## Projects');
    for (const proj of projects) {
      const code = proj.slice(0, 4).toUpperCase();
      registryLines.push(`  ${code}=${proj}`);
    }
  }

  registryLines.push(
    '',
    '## AAAK Quick Reference',
    '  Symbols: \u2661=love \u2605=importance \u26A0=warning \u2192=relationship |=separator',
    '  Structure: KEY:value | GROUP(details) | entity.attribute',
    '  Read naturally \u2014 expand codes, treat *markers* as emotional context.',
  );

  writeFileSync(join(mempalaceDir, 'aaak_entities.md'), registryLines.join('\n'), 'utf-8');

  // Critical facts bootstrap (pre-palace — before any mining)
  const factsLines: string[] = [
    '# Critical Facts (bootstrap \u2014 will be enriched after mining)',
    '',
  ];

  const personalPeople = people.filter((p) => p.context === 'personal');
  const workPeople = people.filter((p) => p.context === 'work');

  if (personalPeople.length > 0) {
    factsLines.push('## People (personal)');
    for (const p of personalPeople) {
      const code = entityCodes[p.name];
      const rel = p.relationship;
      factsLines.push(rel ? `- **${p.name}** (${code}) \u2014 ${rel}` : `- **${p.name}** (${code})`);
    }
    factsLines.push('');
  }

  if (workPeople.length > 0) {
    factsLines.push('## People (work)');
    for (const p of workPeople) {
      const code = entityCodes[p.name];
      const rel = p.relationship;
      factsLines.push(rel ? `- **${p.name}** (${code}) \u2014 ${rel}` : `- **${p.name}** (${code})`);
    }
    factsLines.push('');
  }

  if (projects.length > 0) {
    factsLines.push('## Projects');
    for (const proj of projects) {
      factsLines.push(`- **${proj}**`);
    }
    factsLines.push('');
  }

  factsLines.push(
    '## Palace',
    `Wings: ${wings.join(', ')}`,
    `Mode: ${mode}`,
    '',
    '*This file will be enriched by palace_facts.py after mining.*',
  );

  writeFileSync(join(mempalaceDir, 'critical_facts.md'), factsLines.join('\n'), 'utf-8');
}

// ---------------------------------------------------------------------------
// Main onboarding flow
// Python: onboarding.py — run_onboarding()
// ---------------------------------------------------------------------------

/**
 * Run the full interactive onboarding flow.
 * Returns the seeded EntityRegistry.
 * Python: onboarding.py — run_onboarding()
 *
 * Uses readline from node:readline/promises for interactive prompts.
 */
export async function runOnboarding(
  directory: string = '.',
  configDir?: string,
  autoDetectEnabled: boolean = true,
): Promise<EntityRegistry> {
  const rl = createInterface({ input: stdin, output: stdout });

  try {
    // Step 1: Mode
    const mode = await askMode(rl);

    // Step 2: People
    const { people, aliases } = await askPeople(rl, mode);

    // Step 3: Projects
    const projects = await askProjects(rl, mode);

    // Step 4: Wings (stored in config, not registry — just show user)
    const wings = await askWings(rl, mode);

    // Step 5: Auto-detect additional people from files
    if (autoDetectEnabled && await yn(rl, '\nScan your files for additional names we might have missed?')) {
      const scanDir = await ask(rl, 'Directory to scan', directory);
      const detected = autoDetect(scanDir, people);
      if (detected.length > 0) {
        hr();
        console.log(`\n  Found ${detected.length} additional name candidates:\n`);
        for (const e of detected) {
          const pct = `${Math.round(e.confidence * 100)}%`;
          console.log(`    ${e.name.padEnd(20)} confidence=${pct}  (${e.signal_count} signals)`);
        }
        console.log();
        if (await yn(rl, '  Add any of these to your registry?')) {
          for (const e of detected) {
            const ans = (await rl.question(`    ${e.name} — (p)erson, (s)kip? `)).trim().toLowerCase();
            if (ans === 'p') {
              const rel = (await rl.question(`    Relationship/role for ${e.name}? `)).trim();
              let ctx: string;
              if (mode === 'personal') {
                ctx = 'personal';
              } else if (mode === 'work') {
                ctx = 'work';
              } else {
                const ctxInput = (await rl.question('    Context — (p)ersonal or (w)ork? ')).trim().toLowerCase();
                ctx = ctxInput.startsWith('w') ? 'work' : 'personal';
              }
              people.push({ name: e.name, relationship: rel, context: ctx });
            }
          }
        }
      }
    }

    // Step 6: Warn about ambiguous names
    const ambiguous = warnAmbiguous(people);
    if (ambiguous.length > 0) {
      hr();
      console.log(`
  Heads up — these names are also common English words:
    ${ambiguous.join(', ')}

  MemPalace will check the context before treating them as person names.
  For example: "I picked up Riley" → person.
               "Have you ever tried" → adverb.
`);
    }

    // Build and save registry
    const registry = EntityRegistry.load(configDir);
    registry.seed(mode, people, projects, aliases);

    // Generate AAAK entity registry + critical facts bootstrap
    generateAaakBootstrap(people, projects, wings, mode, configDir);

    // Summary
    header('Setup Complete');
    console.log();
    console.log(`  ${registry.summary()}`);
    console.log(`\n  Wings: ${wings.join(', ')}`);
    console.log('\n  AAAK entity registry: ~/.mempalace/aaak_entities.md');
    console.log('  Critical facts bootstrap: ~/.mempalace/critical_facts.md');
    console.log('\n  Your AI will know your world from the first session.');
    console.log();

    return registry;
  } finally {
    rl.close();
  }
}

// ---------------------------------------------------------------------------
// Quick setup (non-interactive, for testing)
// Python: onboarding.py — quick_setup()
// ---------------------------------------------------------------------------

/**
 * Programmatic setup without interactive prompts.
 * Used in tests and benchmark scripts.
 * Python: onboarding.py — quick_setup()
 *
 * @param mode - Palace mode ('work' | 'personal' | 'combo')
 * @param people - List of person entries
 * @param projects - List of project names
 * @param aliases - Nickname-to-canonical-name mapping
 * @param configDir - Optional config directory path
 */
export function quickSetup(
  mode: PalaceMode,
  people: PersonEntry[],
  projects: string[] = [],
  aliases: Record<string, string> = {},
  configDir?: string,
): EntityRegistry {
  const registry = EntityRegistry.load(configDir);
  registry.seed(mode, people, projects, aliases);
  return registry;
}
