/**
 * @module instructions
 * Instruction text output for MemPalace CLI commands.
 *
 * 1:1 PORT from original instructions_cli.py
 *
 * Each instruction lives as a .md file in the instructions/ directory
 * inside the package. The CLI reads and prints the file content.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const INSTRUCTIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'instructions');

export const AVAILABLE_INSTRUCTIONS = ['init', 'search', 'mine', 'help', 'status'] as const;
export type InstructionName = (typeof AVAILABLE_INSTRUCTIONS)[number];

/**
 * Read and return the instruction .md file content for the given name.
 *
 * Python: instructions_cli.py run_instructions(name)
 */
export function getInstructions(name: string): string {
  if (!AVAILABLE_INSTRUCTIONS.includes(name as InstructionName)) {
    throw new Error(
      `Unknown instructions: ${name}. Available: ${AVAILABLE_INSTRUCTIONS.join(', ')}`,
    );
  }

  const mdPath = join(INSTRUCTIONS_DIR, `${name}.md`);
  try {
    return readFileSync(mdPath, 'utf-8');
  } catch {
    throw new Error(`Instructions file not found: ${mdPath}`);
  }
}
