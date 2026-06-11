#!/usr/bin/env node
// Issue #117 (C-1 + C-6) — completion (Stop) hook. The moment the host agent
// finishes, run the existing VerificationGateRunner against the working tree —
// independent of whether the agent chose to run the workflow's verification
// phase — and surface one trust verdict. A blocking contract violation exits 2
// (the host agent surfaces stderr to the model); a clean change exits 0.
//
// Fast-feedback layer only: it soft-fails on infra errors (a missing build, an
// import failure) so a broken install never wedges the agent. The
// non-bypassable layer is the git/CI backstop (verify-backstop.mjs), which
// fails hard.

import process from 'node:process';

import { runVerificationBackstop } from '../scripts/verify-backstop.mjs';

// Drain stdin (the host passes a Stop-hook JSON payload we do not need) so the
// process does not hang waiting on the pipe, then run the verification.
let input = '';
process.stdin.on('data', (chunk) => {
  input += chunk;
});
process.stdin.on('end', () => {
  void main();
});
// If stdin is already closed (no pipe), `end` may not fire — guard with resume.
process.stdin.resume();

async function main() {
  void input;
  const code = await runVerificationBackstop({
    origin: 'hook-completion',
    softFail: true,
    projectRoot: process.cwd(),
  });
  process.exit(code);
}
