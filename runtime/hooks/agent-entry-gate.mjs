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

import process from 'node:process';

import { entryFile, sentinelState } from './lib/agent-entry-sentinel.mjs';
import { isPaqadDisabled, resolveProjectRoot } from './lib/paqad-disabled.mjs';

function main() {
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

  const ef = entryFile();
  process.stderr.write(
    [
      '[paqad] Blocked: load the paqad framework before editing.',
      '[paqad] Required steps:',
      `[paqad]   1. Read ${ef}`,
      '[paqad]   2. Resolve .paqad/framework-path.txt and load + follow the framework bootstrap (AGENT-BOOTSTRAP.md in the install)',
      '[paqad]   3. Load docs/instructions/{rules,stack,design-system,workflows}',
      '[paqad]   4. Write .paqad/.agent-entry-loaded with timestamp + entry-file path',
      '',
    ].join('\n'),
  );
  return 2;
}

process.exit(main());
