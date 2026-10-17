#!/usr/bin/env node
// Run `claude plugin validate` against the repo root and the packed npm tarball (issue #616,
// Part 1.3). Validation runs only when the `claude` CLI is present; otherwise it prints a skip note
// and exits 0, so CI stays green on a runner without Claude Code installed. A real validation
// failure (non-zero exit) fails the step; "passed with warnings" (the inherent npm-source warning)
// exits 0 and is allowed.

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function claudeAvailable() {
  try {
    execFileSync('claude', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function validate(target) {
  const result = spawnSync('claude', ['plugin', 'validate', target], { stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`[paqad] claude plugin validate failed for ${target} (exit ${result.status}).`);
    process.exit(result.status ?? 1);
  }
}

if (!claudeAvailable()) {
  console.log('[paqad] claude CLI not found — skipping `claude plugin validate` (Part 1.3).');
  process.exit(0);
}

// 1. The repo root (validates .claude-plugin/marketplace.json).
validate(repoRoot);

// 2. The packed tarball (validates the shipped .claude-plugin/plugin.json, with no marketplace).
const sandbox = mkdtempSync(join(tmpdir(), 'paqad-plugin-validate-'));
try {
  execFileSync('npm', ['pack', '--pack-destination', sandbox], { cwd: repoRoot, stdio: 'ignore' });
  const tarball = readdirSync(sandbox).find((f) => f.endsWith('.tgz'));
  if (!tarball) {
    console.error('[paqad] npm pack produced no tarball to validate.');
    process.exit(1);
  }
  execFileSync('tar', ['-xzf', join(sandbox, tarball), '-C', sandbox], { stdio: 'ignore' });
  validate(join(sandbox, 'package'));
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}

console.log('[paqad] claude plugin validate passed (repo + tarball).');
