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

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

import { isPaqadDisabled, readFlooredMode, resolveProjectRoot } from './lib/paqad-disabled.mjs';

// Mirrors PATHS.RULE_SCRIPT_MAP — kept in sync by hand (runtime mjs has no dist).
const RULE_SCRIPT_MAP_REL = 'docs/instructions/rules/rule-script-map.yml';
const RULE_COMPLIANCE_MODES = ['off', 'warn', 'strict'];

// The host seam this invocation evaluates. Defaults to pre-mutation; the adapter
// wires `completion` explicitly on the Stop seam.
const SEAM = process.argv[2] === 'completion' ? 'completion' : 'pre-mutation';

/**
 * Cheap, dist-less check for whether this seam has any kernel work to do, so the
 * common edit pays no dist-import cost. Today the only kernel-bound capability is
 * rule-scripts: it has work only when a rule-script map exists AND rule_compliance
 * is not floored to off (the team value is a floor; local/env may only RAISE).
 */
function seamHasWork(projectRoot) {
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

async function main() {
  try {
    const projectRoot = resolveProjectRoot();
    if (isPaqadDisabled(projectRoot)) return 0;
    if (!seamHasWork(projectRoot)) return 0;

    // Lazy-load the compiled executor only once there is real work. Resolved
    // relative to this module so it works installed, vendored, or in the repo
    // (mirrors verify-backstop.mjs / rule-script-enforce.mjs).
    const distUrl = new URL('../../dist/kernel/gate.js', import.meta.url);
    const { runCapabilityGate } = await import(distUrl.href);

    const result = await runCapabilityGate({ projectRoot, seam: SEAM });
    if (result.block) {
      process.stderr.write(`${result.summary}\n`);
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

// Drain stdin (the host pipes a tool/Stop payload we do not need) then enforce.
let input = '';
process.stdin.on('data', (chunk) => {
  input += chunk;
});
process.stdin.on('end', () => {
  void input;
  main().then((code) => process.exit(code));
});
process.stdin.resume();
