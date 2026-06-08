#!/usr/bin/env node
// Unused-API check for the engine extension surface contract (PQD-92, AC4).
//
// Parses docs/extension-surface.md and reports every documented entry whose
// symbol is not referenced anywhere under src/ (outside its own declaring
// module). Exits 0 by default (warning mode); pass --strict to exit 1 when
// orphans are found, e.g. once the document is populated and stable.
//
//   node scripts/check-surface-orphans.mjs [--strict]

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { findOrphans, parseSurfaceDoc, SURFACE_DOC_PATH } from './lib/surface-doc.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const strict = process.argv.includes('--strict');

function collectSourceFiles(dir) {
  const out = [];
  for (const dirent of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, dirent.name);
    if (dirent.isDirectory()) {
      out.push(...collectSourceFiles(full));
    } else if (dirent.name.endsWith('.ts') && !dirent.name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

function collectUsedSymbols(entries) {
  const srcDir = join(repoRoot, 'src');
  const sourceFiles = statSyncSafe(srcDir) ? collectSourceFiles(srcDir) : [];
  const fileText = new Map();
  for (const file of sourceFiles) {
    fileText.set(relative(repoRoot, file).replaceAll('\\', '/'), readFileSync(file, 'utf8'));
  }

  const used = new Set();
  for (const entry of entries) {
    const pattern = new RegExp(`\\b${escapeRegExp(entry.symbol)}\\b`, 'u');
    for (const [path, text] of fileText) {
      if (path === entry.engineModule) {
        continue; // a symbol's own declaring module does not count as a consumer
      }
      if (pattern.test(text)) {
        used.add(entry.symbol);
        break;
      }
    }
  }
  return used;
}

function statSyncSafe(path) {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

const markdown = readFileSync(join(repoRoot, ...SURFACE_DOC_PATH.split('/')), 'utf8');
const entries = parseSurfaceDoc(markdown);
const orphans = findOrphans(entries, collectUsedSymbols(entries));

if (orphans.length === 0) {
  console.log(`✓ No orphaned entries in ${SURFACE_DOC_PATH} (${entries.length} entries checked).`);
  process.exit(0);
}

console.log(`Found ${orphans.length} orphaned entr${orphans.length === 1 ? 'y' : 'ies'}:`);
for (const orphan of orphans) {
  console.log(`  - ${orphan.symbol} (${orphan.engineModule}, ${orphan.stability})`);
  console.log(`    → ${orphan.recommendation}`);
}
process.exit(strict ? 1 : 0);
