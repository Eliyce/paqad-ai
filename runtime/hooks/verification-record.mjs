#!/usr/bin/env node
// Record-only completion hook for hosts whose native "agent finished" hook must
// never disrupt the agent — Codex CLI's `Stop`, Gemini CLI's `AfterAgent`, etc.
//
// It runs the same verification backstop Claude Code's `Stop` hook runs, purely
// for its side effect: when enterprise evidence is enabled it writes the
// evidence ledger / receipt / AI-BOM under `.paqad/ledger/`. Unlike
// `verification-completion.mjs` (Claude's hook, which exits 2 on a blocking
// verdict so the host surfaces it to the model), this hook ALWAYS exits 0 and
// emits nothing on stdout/stderr. That guarantees a failing gate, an infra
// error, or our human-readable summary can never halt the host, trigger a retry
// loop, or be misread by a host that parses Stop-hook stdout as a control
// "decision". Enforcement stays the git/CI backstop's job (verify-backstop.mjs).

import process from 'node:process';

import { runVerificationBackstop } from '../scripts/verify-backstop.mjs';

// Drain stdin (the host pipes a Stop/AfterAgent JSON payload we do not need) so
// the process does not hang on the pipe, then run the verification.
let input = '';
process.stdin.on('data', (chunk) => {
  input += chunk;
});
process.stdin.on('end', () => {
  void main();
});
// If stdin is already closed (no pipe), `end` may not fire — guard with resume.
process.stdin.resume();

const silent = { write: () => true };

async function main() {
  void input;
  try {
    await runVerificationBackstop({
      origin: 'hook-completion',
      softFail: true,
      projectRoot: process.cwd(),
      stdout: silent,
      stderr: silent,
    });
  } catch {
    // Record-only: a broken install or a thrown error must never disrupt the
    // host agent. The ledger simply is not written this run.
  }
  process.exit(0);
}
