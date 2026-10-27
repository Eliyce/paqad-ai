#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { mkdirSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { logHookFailure } from './lib/hook-log.mjs';
import {
  appendHooksLog,
  isPaqadDisabled,
  readLayeredKey,
  resolveProjectRoot,
} from './lib/paqad-disabled.mjs';
import { isLeanRulesEnabledValue, isRagEnabledValue } from '../scripts/context-seam.mjs';

const DEBOUNCE_MS = 120_000;
const MARKER_REL = '.paqad/locks/rule-context.marker';
const LOW_PRIORITY = 10;

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

function logId(id) {
  return typeof id === 'string' && id.trim().length > 0
    ? id.trim().replace(/[^A-Za-z0-9_-]/g, '_')
    : 'none';
}

function lowerPriority(pid) {
  if (typeof pid !== 'number') return;
  try {
    os.setPriority(pid, LOW_PRIORITY);
  } catch {}
}

async function loadLock(projectRoot) {
  try {
    const lockUrl = new URL('../../dist/background/refresh-context-lock.js', import.meta.url);
    return await import(lockUrl.href);
  } catch (error) {
    logHookFailure(projectRoot, 'context-refresh-trigger', error, 'loading the refresh lock');
    return null;
  }
}

async function main() {
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

    const lock = await loadLock(projectRoot);
    if (!lock) return;
    const outcome = lock.takeRefreshContextLock(projectRoot);
    if (!outcome.acquired) return;

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
    let child;
    try {
      child = spawn(process.execPath, [cliPath, ...args], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        env: { ...process.env, [lock.REFRESH_CONTEXT_LOCK_HELD_ENV]: '1' },
      });
    } catch (error) {
      lock.releaseRefreshContextLock(projectRoot);
      logHookFailure(projectRoot, 'context-refresh-trigger', error, 'spawning the refresh');
      return;
    }
    child.on('error', () => lock.releaseRefreshContextLock(projectRoot));
    child.on('exit', (code, signal) => {
      if (code !== 0 || signal !== null) lock.releaseRefreshContextLock(projectRoot);
    });
    lowerPriority(child.pid);
    appendHooksLog(
      projectRoot,
      `context-refresh-trigger spawn reason=${outcome.reclaimedStale ? 'stale-lock-reclaimed' : 'lock-free'} session=${logId(sessionId)} count=1`,
    );
  } catch {}
}

main();
