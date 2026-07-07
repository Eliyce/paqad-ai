#!/usr/bin/env node
// agent-entry-gate.mjs — PreToolUse hook (cross-platform port of agent-entry-gate.sh, #240).
//
// Blocks any code-mutating tool call (Edit/Write/NotebookEdit) until the agent has
// loaded its provider entry file (CLAUDE.md, AGENTS.md, …) plus the framework entry
// and docs/instructions/{rules,stack,design-system,workflows}, and written the
// per-session sentinel at .paqad/.agent-entry-loaded. This is the HARD teeth behind
// "always load the entry file" (Part 0): no code can change without loading first.
//
// Sentinel-freshness logic is shared with agent-entry-prompt-gate.mjs via
// lib/agent-entry-sentinel.mjs so the two gates cannot drift.
//
// Exit codes:
//   0  → allow the tool call
//   2  → block the tool call (the host surfaces stderr to the model)

import { realpathSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { entryFile, sentinelState } from './lib/agent-entry-sentinel.mjs';
import { isPaqadDisabled, resolveProjectRoot } from './lib/paqad-disabled.mjs';

/** True when the pending tool call writes the agent-entry sentinel itself. The
 *  bootstrap's final step IS a Write of `.paqad/.agent-entry-loaded` — gating it
 *  deadlocks turn one (issue #307): this gate's own remediation says "Write the
 *  sentinel" while blocking exactly that Write. Bookkeeping, never a code change. */
export function isSentinelWrite(input) {
  try {
    const payload = JSON.parse(input);
    const toolInput = payload?.tool_input ?? {};
    const target = toolInput.file_path ?? toolInput.notebook_path ?? '';
    return target.replace(/\\/g, '/').endsWith('.paqad/.agent-entry-loaded');
  } catch {
    return false;
  }
}

export function main(input) {
  const projectRoot = resolveProjectRoot();

  // Issue #220 — when paqad is disabled (or env-overridden off), the gate is a
  // pure no-op: never block, write nothing. Disabled converges with a missing
  // package (a vanilla baseline). Checked before any blocking logic.
  if (isPaqadDisabled(projectRoot)) {
    return 0;
  }

  if (sentinelState(projectRoot) === 'fresh') {
    return 0;
  }

  if (isSentinelWrite(input)) {
    return 0;
  }

  const ef = entryFile();
  process.stderr.write(
    [
      '[paqad] Blocked: load the paqad framework before editing.',
      '[paqad] Required steps:',
      `[paqad]   1. Read ${ef}`,
      '[paqad]   2. Resolve .paqad/framework-path.txt and load + follow the framework bootstrap (AGENT-BOOTSTRAP.md in the install)',
      '[paqad]   3. Load the rule contract artifact-first: read .paqad/context/session-context.md if it exists, else docs/instructions/rules in full; plus docs/instructions/{stack,design-system,workflows}',
      '[paqad]   4. Write .paqad/.agent-entry-loaded with timestamp + entry-file path',
      '',
    ].join('\n'),
  );
  return 2;
}

// Drain stdin (the host pipes the PreToolUse payload; the sentinel-write exemption
// reads the pending edit's target from it) then gate. Guarded so importing this
// module for tests runs nothing. The guard resolves the entry path with
// realpathSync (the host invokes hooks through the symlinked install, and macOS
// aliases /tmp → /private/tmp) — a raw argv[1] compare would MISS and silently
// no-op the gate (the #303 gotcha).
if (isDirectEntry()) {
  let input = '';
  process.stdin.on('data', (chunk) => {
    input += chunk;
  });
  process.stdin.on('end', () => {
    process.exit(main(input));
  });
  process.stdin.resume();
}

/** True when this module is the process entry point, symlink-safe (see above). */
function isDirectEntry() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return false;
  }
}
