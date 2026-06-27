#!/usr/bin/env node
// rule-script-enforce.mjs — live rule-script enforcement (RAG buildout F6).
//
// The linchpin that makes smart rule loading (F4/F5) safe: scripted rules are
// enforced from the WORKING TREE regardless of whether their text is loaded into
// context. Registered for both `PreToolUse` (Edit/Write/NotebookEdit) and `Stop`:
//   - PreToolUse fires before an edit and sees the disk state from prior in-turn
//     edits, so a violation already on disk fails loud before more is piled on.
//   - Stop fires when the agent finishes and checks the full change.
//
// Enforcement is INDEPENDENT of the injection accelerator (`rag_enabled`): it is
// a safety backstop, not context. It is gated only by paqad being enabled, the
// `rule_compliance` mode (off | warn | strict; default warn), and a rule-script
// map actually existing.
//
// Blocking is strict-only: in strict mode a deterministic violation exits 2 (the
// host surfaces stderr to the model); warn mode surfaces findings on stdout and
// exits 0. Any infra error soft-fails to exit 0 so a broken install never wedges
// the agent — the non-bypassable layer stays the git/CI backstop.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

import { isPaqadDisabled, readLayeredKey, resolveProjectRoot } from './lib/paqad-disabled.mjs';

// Mirrors PATHS.RULE_SCRIPT_MAP — kept in sync by hand (runtime mjs has no dist).
const RULE_SCRIPT_MAP_REL = 'docs/instructions/rules/rule-script-map.yml';

function resolveMode(projectRoot) {
  const raw = readLayeredKey(projectRoot, 'rule_compliance', 'PAQAD_RULE_COMPLIANCE');
  const value = (raw ?? 'warn').trim().toLowerCase();
  return value === 'off' || value === 'strict' ? value : 'warn';
}

async function main() {
  try {
    const projectRoot = resolveProjectRoot();
    if (isPaqadDisabled(projectRoot)) return 0;

    const mode = resolveMode(projectRoot);
    if (mode === 'off') return 0;

    // Fast-skip the common case: no rule-script map → nothing to enforce, and we
    // never pay the dist import cost on a normal edit.
    if (!existsSync(join(projectRoot, RULE_SCRIPT_MAP_REL))) return 0;

    // Lazy-load the compiled enforcement API only once there is real work.
    // Resolved relative to this module so it works installed, vendored, or in the
    // repo (mirrors verify-backstop.mjs).
    const distUrl = new URL('../../dist/rule-scripts/index.js', import.meta.url);
    const { enforceRuleScripts } = await import(distUrl.href);

    const result = await enforceRuleScripts({ projectRoot, mode });
    if (!result.ran || result.violations.length === 0) return 0;

    if (result.blocking) {
      process.stderr.write(`${result.summary}\n`);
      return 2;
    }
    process.stdout.write(`${result.summary}\n`);
    return 0;
  } catch {
    // Soft-fail: an infra error (missing build, import failure) must never wedge
    // the agent. Enforcement still happens at the git/CI backstop.
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
