#!/usr/bin/env node
// capability-gate.mjs — the Capability Kernel host seam (buildout F3).
//
// ONE host hook that runs every kernel-bound capability registered at a lifecycle
// seam, replacing the single-purpose rule-script-enforce.mjs. The seam is passed
// as the first argv (`pre-mutation` for Claude PreToolUse, `completion` for Stop);
// the dist executor (`runCapabilityGate`) iterates the registry for that seam and
// returns one block/allow decision.
//
//   - PreToolUse fires before a mutating edit and sees prior in-turn disk state,
//     so a violation already on disk fails loud before more is piled on.
//   - Stop fires when the agent finishes and checks the full change.
//
// Blocking is strict-only: a blocking outcome exits 2 (the host surfaces stderr to
// the model); advisory findings surface on stdout and exit 0. Any infra error
// soft-fails to exit 0 so a broken install never wedges the agent.
//
// Dist-less fast-skips (no dist import on the common path): paqad disabled, no
// rule-script map, or rule_compliance=off. These are the cheap triggers of the one
// capability currently folded into the seam (rule-scripts); as F6 folds in
// stages/decision-pause/delivery, this pre-check generalises per-capability.

import { existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { isPaqadDisabled, readFlooredMode, resolveProjectRoot } from './lib/paqad-disabled.mjs';
import { stopHookActiveFromStdin } from './lib/loop-guard.mjs';

// Mirrors PATHS.RULE_SCRIPT_MAP — kept in sync by hand (runtime mjs has no dist).
const RULE_SCRIPT_MAP_REL = 'docs/instructions/rules/rule-script-map.yml';
const RULE_COMPLIANCE_MODES = ['off', 'warn', 'strict'];
const STAGES_MODES = ['off', 'warn', 'strict'];

// The host seam this invocation evaluates. Defaults to pre-mutation; the adapter
// wires `completion` explicitly on the Stop seam.
const SEAM = process.argv[2] === 'completion' ? 'completion' : 'pre-mutation';

/**
 * Cheap, dist-less check for whether this seam has any kernel work to do, so the
 * common edit pays no dist-import cost. Two kernel-bound capabilities today:
 *   - stages (RCA fix B) — block-forward runs on EVERY enabled project by default
 *     (stages_mode defaults to strict), independent of any rule-script map, so the
 *     executor must load whenever stages is not floored off.
 *   - rule-scripts — has work only when a rule-script map exists AND rule_compliance
 *     is not floored to off (the team value is a floor; local/env may only RAISE).
 */
function seamHasWork(projectRoot) {
  const stagesMode = readFlooredMode(
    projectRoot,
    'stages_mode',
    'PAQAD_STAGES_MODE',
    STAGES_MODES,
    'strict',
  );
  if (stagesMode !== 'off') {
    return true;
  }
  if (!existsSync(join(projectRoot, RULE_SCRIPT_MAP_REL))) {
    return false;
  }
  const mode = readFlooredMode(
    projectRoot,
    'rule_compliance',
    'PAQAD_RULE_COMPLIANCE',
    RULE_COMPLIANCE_MODES,
    'warn',
  );
  return mode !== 'off';
}

/**
 * Parse the host PreToolUse/Stop stdin payload into the kernel `CapabilityPayload`
 * (tool name, edit target, transcript path, session id). Best-effort: a missing or
 * malformed payload yields `undefined`, and every capability treats that as "no
 * payload" — only the decision-pause self-arm reads it. Never throws.
 */
function parsePayload(input) {
  try {
    const payload = JSON.parse(input);
    const toolInput = payload?.tool_input ?? {};
    return {
      toolName: payload?.tool_name,
      targetPath: toolInput.file_path ?? toolInput.notebook_path,
      transcriptPath: payload?.transcript_path,
      sessionId: payload?.session_id,
    };
  } catch {
    /* v8 ignore next 2 */
    return undefined;
  }
}

export async function main(input, seam = SEAM) {
  try {
    const projectRoot = resolveProjectRoot();
    if (isPaqadDisabled(projectRoot)) return 0;
    if (!seamHasWork(projectRoot)) return 0;

    // Lazy-load the compiled executor only once there is real work. Resolved
    // relative to this module so it works installed, vendored, or in the repo
    // (mirrors verify-backstop.mjs / rule-script-enforce.mjs).
    const distUrl = new URL('../../dist/kernel/gate.js', import.meta.url);
    const { runCapabilityGate } = await import(distUrl.href);

    const result = await runCapabilityGate({
      projectRoot,
      seam,
      payload: parsePayload(input),
    });
    if (result.block) {
      process.stderr.write(`${result.summary}\n`);
      // Loop guard (fix #2) — the completion (Stop) seam is the only one the host
      // re-runs after forcing a continuation. When Claude marks this Stop as a
      // continuation of a prior block (`stop_hook_active`), the gate has already
      // bitten once, so blocking again would loop on an unresolvable outcome:
      // surface the summary (above) but exit non-blocking. The pre-mutation seam
      // is a PreToolUse deny, not a Stop loop, so it always keeps its teeth. git/CI
      // remain the hard, non-bypassable layer.
      if (seam === 'completion' && stopHookActiveFromStdin(input)) {
        process.stderr.write(
          '[paqad] already surfaced this turn — not blocking again so the session can end (git/CI remains the hard gate).\n',
        );
        return 0;
      }
      return 2;
    }
    if (result.summary) {
      process.stdout.write(`${result.summary}\n`);
    }
    return 0;
  } catch {
    // Soft-fail: an infra error (missing build, import failure) must never wedge
    // the agent. Enforcement still happens at the next seam / completion run.
    return 0;
  }
}

// Drain stdin (the host pipes the tool/Stop payload) then enforce. The payload is
// parsed lazily inside main() and only the decision-pause self-arm reads it. Guarded
// so importing this module for tests runs nothing. The guard resolves the entry
// path with realpathSync: the host invokes this hook through the symlinked install
// (~/.paqad-ai/current → the package runtime), and macOS also aliases /tmp →
// /private/tmp, so a raw argv[1] compare would MISS the match and silently no-op
// the whole gate. Comparing realpaths is symlink-safe.
if (isDirectEntry()) {
  let input = '';
  process.stdin.on('data', (chunk) => {
    input += chunk;
  });
  process.stdin.on('end', () => {
    main(input).then((code) => process.exit(code));
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
