#!/usr/bin/env node
// Surface-drift check for the engine extension surface contract (PQD-92, AC2/AC3).
//
// Fails when a public export barrel changed in the current branch without the
// surface document being amended in the same change set. Mirrors the
// ExtensionSurfaceGate so local runs and verification agree. The symbol-granular
// view is not meaningful for `export *` barrels, so enforcement is barrel-level.
//
//   node scripts/check-surface-drift.mjs [--base <ref>]
//
// The base ref defaults to $SURFACE_DRIFT_BASE, then origin/main.

import { execFileSync } from 'node:child_process';

import { evaluateBarrelDrift, PUBLIC_BARRELS, SURFACE_DOC_PATH } from './lib/surface-doc.mjs';

function resolveBase() {
  const flagIndex = process.argv.indexOf('--base');
  if (flagIndex !== -1 && process.argv[flagIndex + 1]) {
    return process.argv[flagIndex + 1];
  }
  return process.env.SURFACE_DRIFT_BASE || 'origin/main';
}

function changedFilesSince(base) {
  const output = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], {
    encoding: 'utf8',
  });
  return output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

const base = resolveBase();
let changedFiles;
try {
  changedFiles = changedFilesSince(base);
} catch (error) {
  console.error(
    `Could not diff against ${base}: ${error instanceof Error ? error.message : error}`,
  );
  process.exit(2);
}

const result = evaluateBarrelDrift(changedFiles);

if (!result.violation) {
  console.log(
    result.changedBarrels.length === 0
      ? `✓ No public export barrel changed since ${base}.`
      : `✓ Public export barrel changed and ${SURFACE_DOC_PATH} amended in the same change.`,
  );
  process.exit(0);
}

console.error(
  `✗ ${result.changedBarrels.join(', ')} changed without amending ${SURFACE_DOC_PATH}.`,
);
console.error(
  `  Update ${SURFACE_DOC_PATH} in the same change when adding, removing, or renaming a public export.`,
);
console.error(`  Tracked barrels: ${PUBLIC_BARRELS.join(', ')}`);
process.exit(1);
