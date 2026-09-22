#!/usr/bin/env node
// agent-entry-prompt-gate.mjs — UserPromptSubmit hook (cross-platform port of
// agent-entry-prompt-gate.sh, #240) with the always-load fix (Part 0) and Codex
// parity (issue #566).
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
// Host-aware via one argv (default `claude-code`; Codex passes `codex-cli`, #566):
//   - the routed outcome is recorded against the REAL host, so the session-route row
//     carries `adapter: "codex-cli"` (AC-8), and
//   - the injected text (directive or context block) is delivered to Codex through the
//     documented `additionalContext` JSON envelope, since Codex reads a UserPromptSubmit
//     hook's JSON output. Claude keeps plain stdout, byte-identical to before.
//
// Modes (PAQAD_AGENT_ENTRY_MODE): soft (default) injects the directive so the model
// loads before planning the turn; hard exits 2. Soft is the default because a hard
// exit-2 on UserPromptSubmit erases the user's prompt and the model never runs (so it
// can never load) — the real hard block is the PreToolUse gate.
//
// Sentinel-freshness logic is shared with agent-entry-gate.mjs via
// lib/agent-entry-sentinel.mjs.

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  ENABLEMENT_VERIFIED_LINE,
  loadSteps,
  specPipelineNudge,
} from './lib/agent-entry-directive.mjs';
import { entryFile, sentinelState } from './lib/agent-entry-sentinel.mjs';
import { emitContext } from './lib/context-seam-emit.mjs';
import { logHookFailure } from './lib/hook-log.mjs';
import { isPaqadDisabled, readLayeredKey, resolveProjectRoot } from './lib/paqad-disabled.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

// The host that invoked the hook (issue #566). Default `claude-code` keeps Claude's
// behaviour and output unchanged; Codex passes `codex-cli`.
const ADAPTER = process.argv[2] || undefined;

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

// The directive opens with the enablement verdict (issue #498, Part A): this gate
// already resolved enablement and short-circuits to silence when OFF (see main()),
// so its firing PROVES paqad is ON — the agent must not spend a tool call re-checking
// it. The numbered load steps come from the one shared module so this directive and
// the PreToolUse gate cannot drift.
function directive(state, ef) {
  return [
    ENABLEMENT_VERIFIED_LINE,
    '[paqad] You MUST load the paqad framework before responding.',
    `[paqad] Reason: ${reasonFor(state, ef)}.`,
    '[paqad] Required steps, in order, before any other tool call or response:',
    ...loadSteps(ef),
    '[paqad] Only after the final step may you address the prompt.',
    '',
  ].join('\n');
}

// Deliver the gate's injected text to the host. Claude reads plain stdout; Codex reads
// a UserPromptSubmit hook's JSON output, so its text rides the documented
// `additionalContext` envelope (issue #566). Nothing is written for an empty string.
function emitInjection(text) {
  if (!text) {
    return;
  }
  if (ADAPTER === 'codex-cli') {
    process.stdout.write(
      `${JSON.stringify({
        hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: text },
      })}\n`,
    );
    return;
  }
  process.stdout.write(text);
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

// Issues #324, #336, #566 — route THIS prompt to one of the workflow outcomes with the
// deterministic classifier, record it against the REAL host so the session-route row
// carries the adapter (AC-8), and append the ONE lean `[paqad]` outcome line to `sink`.
// Thin by contract: all logic lives in dist/pipeline/prompt-lane.js.
async function emitRoute(stdin, projectRoot, sink) {
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
      adapter: ADAPTER ?? 'claude-code',
    });
    if (narration) {
      sink(`${narration}\n`);
    }
  } catch (error) {
    // Best-effort for the HOST — the prompt still goes through — but never silent again
    // (issue #573). A swallowed ERR_MODULE_NOT_FOUND here hid a total routing outage for
    // ~10 weeks: no lane was ever recorded, so stage isolation could never trigger.
    logHookFailure(projectRoot, 'agent-entry-prompt-gate', error, 'routing this prompt');
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
    // suppressed until the framework is loaded, so the directive can never be buried.
    const message = directive(state, entryFile());
    if ((process.env.PAQAD_AGENT_ENTRY_MODE || 'soft') === 'hard') {
      process.stderr.write(message);
      return 2;
    }
    emitInjection(message);
    return 0;
  }

  // Fresh: the framework is loaded — inject the precomputed [paqad-context] block (F2),
  // then route THIS prompt + record the outcome. On Codex the pieces are buffered and
  // delivered as one additionalContext envelope; on Claude each is written straight to
  // stdout, preserving the exact prior output.
  let buffer = '';
  const sink = ADAPTER === 'codex-cli' ? (text) => (buffer += text) : (text) => emitInjection(text);
  emitContext(stdin, projectRoot, sink);
  await emitRoute(stdin, projectRoot, sink);
  // Issue #547 (FR-1.4) — one spec-pipeline nudge when the pipeline is on; silent otherwise.
  const nudge = specPipelineNudge(readLayeredKey, projectRoot);
  if (nudge) {
    sink(`${nudge}\n`);
  }
  if (ADAPTER === 'codex-cli') {
    emitInjection(buffer);
  }
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
