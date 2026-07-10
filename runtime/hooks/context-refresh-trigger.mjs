#!/usr/bin/env node
// context-refresh-trigger.mjs — prompt-time background refresh of the rule slice
// of the session-context artifact (RAG buildout F5).
//
// On each user prompt it fires a DETACHED `paqad-ai rag refresh-context` so the
// rule context (manifest + trigger-loaded full rule text) tracks the files in
// play. It does no heavy work itself: a cheap debounce-marker check, then a
// fire-and-forget spawn that returns immediately. The spawned CLI is
// single-flight-locked and atomic-swaps the artifact, so the seam (which only
// reads) is never blocked and never sees a half-written file. The refresh lands
// on the NEXT prompt (stale-while-revalidate); the always-resident manifest is
// already present meanwhile.
//
// Always exits 0 and stays silent: a missing `paqad-ai` on PATH (e.g. a dev tree)
// or any error just means no refresh this turn — never a broken prompt.

import { spawn } from 'node:child_process';
import { mkdirSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { isPaqadDisabled, readLayeredKey, resolveProjectRoot } from './lib/paqad-disabled.mjs';
import { isLeanRulesEnabledValue, isRagEnabledValue } from '../scripts/context-seam.mjs';

// Coalesce a burst of prompts: at most one refresh spawn per this window.
const DEBOUNCE_MS = 20_000;
const MARKER_REL = '.paqad/locks/rule-context.marker';

function withinDebounce(markerPath) {
  try {
    return Date.now() - statSync(markerPath).mtimeMs < DEBOUNCE_MS;
  } catch {
    return false; // no marker yet → not debounced
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
    } catch {
      // best-effort
    }
  }
}

function main() {
  try {
    const projectRoot = resolveProjectRoot();
    if (isPaqadDisabled(projectRoot)) return;
    // Issue #284 — refresh the rule slice on every install where lean loading is on
    // (its default) OR the RAG accelerator is on, so the artifact tracks the files in
    // play. With `lean_rules=false` AND rag off the trigger stays inert (today's
    // behaviour). The spawned worker no-ops the index/retrieval/drift parts when rag
    // is off, recomposing rule-only — no embedding, index, or provider call.
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

    // Fire-and-forget: the CLI single-flights + atomic-swaps. Detached + unref so
    // it outlives this hook and never blocks the prompt path.
    const child = spawn(
      'paqad-ai',
      ['rag', 'refresh-context', '--project-root', projectRoot, '--quiet'],
      { detached: true, stdio: 'ignore', windowsHide: true },
    );
    child.on('error', () => {}); // paqad-ai not on PATH (dev tree) → silently skip
    child.unref();
  } catch {
    // Never break a turn.
  }
}

main();
