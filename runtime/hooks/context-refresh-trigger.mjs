#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { mkdirSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isPaqadDisabled, readLayeredKey, resolveProjectRoot } from './lib/paqad-disabled.mjs';
import { isLeanRulesEnabledValue, isRagEnabledValue } from '../scripts/context-seam.mjs';

const DEBOUNCE_MS = 20_000;
const MARKER_REL = '.paqad/locks/rule-context.marker';

function withinDebounce(markerPath) {
  try {
    return Date.now() - statSync(markerPath).mtimeMs < DEBOUNCE_MS;
  } catch {
    return false;
  }
}

function touch(markerPath) {
  try {
    mkdirSync(dirname(markerPath), { recursive: true });
    writeFileSync(markerPath, '');
  } catch {
    try {
      const now = new Date();
      utimesSync(markerPath, now, now);
    } catch {}
  }
}

function main() {
  try {
    const projectRoot = resolveProjectRoot();
    if (isPaqadDisabled(projectRoot)) return;
    const ragEnabled = isRagEnabledValue(
      readLayeredKey(projectRoot, 'rag_enabled', 'PAQAD_RAG_ENABLED'),
    );
    const leanEnabled = isLeanRulesEnabledValue(
      readLayeredKey(projectRoot, 'lean_rules', 'PAQAD_LEAN_RULES'),
    );
    if (!ragEnabled && !leanEnabled) {
      return;
    }

    const markerPath = join(projectRoot, MARKER_REL);
    if (withinDebounce(markerPath)) return;
    touch(markerPath);

    const sessionId = process.argv[2];
    const args = ['rag', 'refresh-context', '--project-root', projectRoot, '--quiet'];
    if (typeof sessionId === 'string' && sessionId.trim().length > 0) {
      args.push('--session', sessionId.trim());
    }
    const cliPath = join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      'dist',
      'cli',
      'index.js',
    );
    const child = spawn(process.execPath, [cliPath, ...args], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.on('error', () => {});
    child.unref();
  } catch {}
}

main();
