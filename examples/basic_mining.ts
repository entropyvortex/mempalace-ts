#!/usr/bin/env npx tsx
/**
 * Example: mine a project folder into the palace.
 */

const projectDir = process.argv[2] || '~/projects/my_app';

console.log('Step 1: Initialize rooms from folder structure');
console.log(`  mempalace-ts init ${projectDir}`);
console.log('\nStep 2: Mine everything');
console.log(`  mempalace-ts mine ${projectDir}`);
console.log('\nStep 3: Search');
console.log("  mempalace-ts search 'why did we choose this approach'");
