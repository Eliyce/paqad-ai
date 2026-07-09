#!/usr/bin/env node
// agent-entry-prompt-gate.mjs — UserPromptSubmit hook (cross-platform port of
// agent-entry-prompt-gate.sh, #240) with the always-load fix (Part 0).
//
// Fires on every user prompt — including read-only Q&A — so the agent cannot answer
// in an onboarded project without first loading its provider entry file plus the
// framework and docs/instructions/{rules,stack,design-system,workflows}.
//
// THE ALWAYS-LOAD FIX. The previous gate emitted the precomputed [paqad-context]
// block (RAG buildout F2) BEFORE the load directive on every turn, so on a not-yet-
// loaded session the "load the framework first" instruction landed at the very
// bottom of a large injected block — buried, and outside the host's inline preview.
// Now, when the framework is not loaded, this gate emits ONLY the load directive
// (the context block is suppressed until the sentinel is fresh), so the one
// instruction that must be obeyed first owns the top of context and cannot be
// missed. Once loaded, the context block is injected exactly as before.
//
// Modes (PAQAD_AGENT_ENTRY_MODE): soft (default) prints the directive on stdout so
// the host injects it into context and the model loads before planning the turn;
// hard exits 2. Soft is the default because a hard exit-2 on UserPromptSubmit
// erases the user's prompt and the model never runs (so it can never load) — the
// real hard block is the PreToolUse gate, which makes editing impossible until the
// sentinel is fresh.
//
// Sentinel-freshness logic is shared with agent-entry-gate.mjs via
// lib/agent-entry-sentinel.mjs.

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { entryFile, sentinelState } from './lib/agent-entry-sentinel.mjs';
import { emitContext } from './lib/context-seam-emit.mjs';
import { isPaqadDisabled, resolveProjectRoot } from './lib/paqad-disabled.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

function reasonFor(state, ef) {
  switch (state) {
    case 'missing':
      return 'the per-session sentinel .paqad/.agent-entry-loaded is missing';
    case 'stale:entry-file':
      return `${ef} changed mid-session — the sentinel was invalidated`;
    case 'stale:framework-path':
      return '.paqad/framework-path.txt changed mid-session — the sentinel was invalidated';
    case 'stale:docs-instructions':
      return 'docs/instructions/ changed mid-session — the sentinel was invalidated';
    default:
      return `the sentinel is not fresh (${state})`;
  }
}

function directive(state, ef) {
  return [
    '[paqad] You MUST load the paqad framework before responding.',
    `[paqad] Reason: ${reasonFor(state, ef)}.`,
    '[paqad] Required steps, in order, before any other tool call or response:',
    `[paqad]   1. Read ${ef}`,
    '[paqad]   2. Resolve .paqad/framework-path.txt and load + follow the framework bootstrap (AGENT-BOOTSTRAP.md in the install)',
    '[paqad]   3. Load the rule contract artifact-first: read .paqad/context/session-context.md if it exists, else docs/instructions/rules in full; plus docs/instructions/{stack,design-system,workflows}',
    '[paqad]   4. Write .paqad/.agent-entry-loaded with timestamp + entry-file path',
    '[paqad] Only after step 4 may you address the prompt.',
    '',
  ].join('\n');
}

// RAG buildout F5 — fire a debounced, detached background refresh of the rule
// context so it tracks the files in play. Returns immediately; never blocks and
// never throws into the gate.
function fireContextRefresh() {
  try {
    const refresh = join(HERE, 'context-refresh-trigger.mjs');
    const child = spawn(process.execPath, [refresh], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  } catch {
    // best-effort
  }
}

// Issues #324, #336 — route THIS prompt to one of the 9 workflow outcomes with the
// deterministic classifier, record it in the per-session workflow-state (pause/resume),
// stash the lane for the next change-open (feature-development only), and emit ONE lean
// `[paqad]` line naming the outcome. Thin by contract: all logic lives in
// dist/pipeline/prompt-lane.js so it is coverage-counted; the hook only parses the
// prompt, lazy-imports, and prints. Best-effort — never breaks or delays a turn on
// failure, and a `no-workflow` prompt (small talk) prints nothing.
async function emitRoute(stdin, projectRoot) {
  try {
    const parsed = JSON.parse(stdin);
    const request = typeof parsed?.prompt === 'string' ? parsed.prompt : '';
    if (!request.trim()) {
      return;
    }
    const sessionId = typeof parsed?.session_id === 'string' ? parsed.session_id : null;
    const distUrl = new URL('../../dist/pipeline/prompt-lane.js', import.meta.url);
    const { runPromptRouteSeam } = await import(distUrl.href);
    const { narration } = await runPromptRouteSeam({
      projectRoot,
      request,
      sessionId,
      adapter: 'claude-code',
    });
    if (narration) {
      process.stdout.write(`${narration}\n`);
    }
  } catch {
    // Best-effort — a broken build or an unparseable prompt just skips the route line.
  }
}

async function main(stdin) {
  const projectRoot = resolveProjectRoot();

  // Issue #220 — when paqad is disabled, the gate is a pure no-op. This MUST
  // short-circuit before any stdout: an injected `[paqad]`/`[paqad-context]` line
  // would contaminate the OFF arm of an A/B comparison.
  if (isPaqadDisabled(projectRoot)) {
    return 0;
  }

  fireContextRefresh();

  const state = sentinelState(projectRoot);
  if (state !== 'fresh') {
    // ALWAYS-LOAD: emit ONLY the load directive — the [paqad-context] dump is
    // suppressed until the framework is loaded, so the directive can never be
    // buried under it.
    const message = directive(state, entryFile());
    if ((process.env.PAQAD_AGENT_ENTRY_MODE || 'soft') === 'hard') {
      process.stderr.write(message);
      return 2;
    }
    process.stdout.write(message);
    return 0;
  }

  // Fresh: the framework is loaded — now it is safe to inject the precomputed
  // [paqad-context] block (F2), then route THIS prompt + record the outcome.
  emitContext(stdin, projectRoot);
  await emitRoute(stdin, projectRoot);
  return 0;
}

let done = false;
const chunks = [];
const run = () => {
  if (done) return;
  done = true;
  main(Buffer.concat(chunks).toString('utf8'))
    // Never surface an error to the host; fall through and exit cleanly (code 0).
    .then((code) => process.exit(code))
    .catch(() => process.exit(0));
};

process.stdin.on('data', (chunk) => chunks.push(chunk));
process.stdin.on('end', run);
process.stdin.on('error', run);
process.stdin.resume();
