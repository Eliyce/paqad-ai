#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PLUGIN_MARKETPLACE, PLUGIN_REPO } from './assemble-plugin.mjs';
import { reportPluginSkills } from './check-plugin-skills.mjs';

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

if (!reportPluginSkills({ pluginRoot: repoRoot })) {
  console.error('[paqad] plugin skill check failed; fix the findings above.');
  process.exit(1);
}

if (!claudeAvailable()) {
  console.log('[paqad] claude CLI not found — skipping `claude plugin validate` (Part 1.3).');
  process.exit(0);
}

validate(repoRoot);

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
  const market = join(sandbox, 'marketplace');
  mkdirSync(join(market, '.claude-plugin'), { recursive: true });
  cpSync(
    join(repoRoot, '.claude-plugin', 'plugin.json'),
    join(market, '.claude-plugin', 'plugin.json'),
  );
  writeFileSync(
    join(market, '.claude-plugin', 'marketplace.json'),
    `${JSON.stringify(PLUGIN_MARKETPLACE, null, 2)}\n`,
  );
  cpSync(join(repoRoot, 'runtime'), join(market, 'runtime'), { recursive: true });
  validate(market);
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}

console.log(
  `[paqad] claude plugin validate passed (repo, tarball, and the ${PLUGIN_REPO} marketplace tree).`,
);
