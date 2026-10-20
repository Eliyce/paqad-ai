#!/usr/bin/env node

import { chmodSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXECUTABLE_EXTENSIONS = new Set(['.sh', '.mjs']);

const runtimeDir = dirname(dirname(fileURLToPath(import.meta.url)));
const TARGET_DIRS = [join(runtimeDir, 'hooks'), join(runtimeDir, 'scripts')];

function chmodExecutablesIn(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      chmodExecutablesIn(full);
      continue;
    }
    const dot = entry.name.lastIndexOf('.');
    const ext = dot === -1 ? '' : entry.name.slice(dot);
    if (!EXECUTABLE_EXTENSIONS.has(ext)) continue;
    try {
      const mode = statSync(full).mode & 0o777;
      chmodSync(full, mode | 0o111);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[paqad] could not make ${full} executable: ${message}\n`);
    }
  }
}

try {
  for (const dir of TARGET_DIRS) {
    chmodExecutablesIn(dir);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[paqad] postinstall hook-permission step skipped: ${message}\n`);
}

process.exit(0);
