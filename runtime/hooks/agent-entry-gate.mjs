#!/usr/bin/env node
// agent-entry-gate.mjs — PreToolUse hook (cross-platform port of agent-entry-gate.sh, #240).
//
// Blocks any code-mutating tool call (Edit/Write/NotebookEdit) until the agent has
// loaded its provider entry file (CLAUDE.md, AGENTS.md, …) plus the framework entry
// and docs/instructions/{rules,stack,design-system,workflows}, and written the
// per-session sentinel at .paqad/.agent-entry-loaded.d/<session id> (the legacy
// .paqad/.agent-entry-loaded when the host sends no session id, issue #582). This
// is the HARD teeth behind "always load the entry file" (Part 0): no code can change
// without loading first.
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

import { ENABLEMENT_VERIFIED_LINE, loadSteps } from './lib/agent-entry-directive.mjs';
import { editTargets } from './lib/edit-targets.mjs';
import {
  agentEntryMarkerRelative,
  entryFile,
  sentinelRelative,
  sentinelState,
  stampAgentEntryMarker,
  stampSessionSentinel,
} from './lib/agent-entry-sentinel.mjs';
import { agentIdFromStdin, sessionIdFromStdin } from './lib/context-seam-emit.mjs';
import { isPaqadDisabled, resolveProjectRoot } from './lib/paqad-disabled.mjs';

/** True when the pending tool call writes the agent-entry sentinel itself. The
 *  bootstrap's final step IS a Write of `.paqad/.agent-entry-loaded` — gating it
 *  deadlocks turn one (issue #307): this gate's own remediation says "Write the
 *  sentinel" while blocking exactly that Write. Bookkeeping, never a code change.
 *
 *  Also exempts a write to a per-agent entry marker under `.paqad/session/agent-entry/`
 *  (issue #567): a stage subagent clears its own keyed gate by creating that marker, and the
 *  create must not itself be blocked. Bash creation is ungated already; this covers the Write
 *  tool.
 *
 *  And exempts a write to a per-session sentinel under `.paqad/.agent-entry-loaded.d/`
 *  (issue #582), the file the gate names when the host sends a session id. */
export function isSentinelWrite(input) {
  try {
    const payload = JSON.parse(input);
    // Host-agnostic: read the edited path(s) through the shared extractor so a Codex
    // `apply_patch` that writes the sentinel is exempted too (issue #566), not just
    // Claude's `file_path`. Exempt when ANY edited path is the sentinel or a per-agent marker.
    return editTargets(payload).some((target) => {
      const norm = target.replace(/\\/g, '/');
      return (
        norm.endsWith('.paqad/.agent-entry-loaded') ||
        /(^|\/)\.paqad\/\.agent-entry-loaded\.d\/[^/]+$/.test(norm) ||
        norm.includes('/.paqad/session/agent-entry/')
      );
    });
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

  // Issue #567 — when this call is inside a subagent, the payload carries a distinct
  // `agent_id` (the `session_id` is the orchestrator's), so the sentinel is keyed on it: a
  // stage subagent must prove its OWN cold framework load and cannot ride the orchestrator's.
  // Undefined on the main thread ⇒ the unkeyed sentinel, unchanged.
  const agentId = agentIdFromStdin(input);
  // Issue #582 — on the main thread the sentinel is keyed on the payload's session id, so a
  // SessionStart in another session of this checkout cannot remove it.
  const sessionId = sessionIdFromStdin(input);

  if (sentinelState(projectRoot, process.env, agentId, sessionId) === 'fresh') {
    return 0;
  }

  if (isSentinelWrite(input)) {
    // The bootstrap's sentinel Write is the load confirmation. Inside a subagent, promote it
    // into this agent's per-agent marker (the base sentinel the agent writes is keyed on the
    // shared parent session, so it cannot represent this agent), clearing its own keyed gate.
    if (agentId) {
      stampAgentEntryMarker(projectRoot, agentId);
    } else if (sessionId) {
      // Issue #582 — a main-thread Write of the legacy file (older router wording) still
      // clears THIS session's own gate, the same way #567 promotes it for a subagent.
      stampSessionSentinel(projectRoot, sessionId, entryFile());
    }
    return 0;
  }

  // This gate, like the prompt-gate, short-circuits to a no-op when paqad is OFF
  // (above), so reaching here proves paqad is ON — state that verdict, and build the
  // numbered steps from the one shared module so the two directives cannot drift
  // (issue #498, Part A).
  const ef = entryFile();
  // Issue #567 — inside a subagent the base sentinel belongs to the orchestrator, so name the
  // per-agent marker THIS agent must record (it cannot read its own agent_id; the gate can).
  // Appended only when an agent_id is present, so the main-thread directive is unchanged and the
  // shared step prose (loadSteps) still matches the prompt-gate byte-for-byte (#498 AC-3).
  const markerRel = agentId ? agentEntryMarkerRelative(agentId) : null;
  // Issue #582 — name the file this session is checked against. Inside a subagent the keyed
  // marker is what clears the gate, so step 5 keeps the legacy wording the subagent line cites.
  const sentinelRel = agentId ? sentinelRelative(undefined) : sentinelRelative(sessionId);
  const subagentLine = markerRel
    ? [
        `[paqad] You are a paqad stage subagent. After loading, record THIS agent's own load by ` +
          `creating ${markerRel} (Write it, or \`mkdir -p .paqad/session/agent-entry && touch ${markerRel}\`); ` +
          'then retry your edit. Writing .paqad/.agent-entry-loaded with the Write tool clears it too.',
      ]
    : [];
  process.stderr.write(
    [
      '[paqad] Blocked: load the paqad framework before editing.',
      ENABLEMENT_VERIFIED_LINE,
      '[paqad] Required steps:',
      ...loadSteps(ef, sentinelRel),
      ...subagentLine,
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
