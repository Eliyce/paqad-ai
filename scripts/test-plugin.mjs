#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIN_ENGINE = [2, 1, 301];

function claudeVersion() {
  try {
    const out = execFileSync('claude', ['--version'], { encoding: 'utf8' });
    const match = out.match(/(\d+)\.(\d+)\.(\d+)/);
    return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
  } catch {
    return null;
  }
}

function newEnough(have) {
  for (let i = 0; i < 3; i += 1) {
    if (have[i] !== MIN_ENGINE[i]) return have[i] > MIN_ENGINE[i];
  }
  return true;
}

const version = claudeVersion();
if (!version || !newEnough(version)) {
  const found = version ? `found ${version.join('.')}` : 'not found';
  console.log(
    `[paqad] claude CLI 2.1.301+ ${found}; skipping \`claude plugin test\` (the HUD mod needs that version).`,
  );
  process.exit(0);
}

const manifest = JSON.parse(readFileSync(join(repoRoot, '.claude-plugin', 'plugin.json'), 'utf8'));
const hooksRel = manifest.hooks;
const hooks = JSON.parse(readFileSync(join(repoRoot, hooksRel), 'utf8'));
const sandbox = mkdtempSync(join(tmpdir(), 'paqad-plugin-test-'));
try {
  const staged = {
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    hooks: hooksRel,
    types: manifest.types,
  };
  mkdirSync(join(sandbox, '.claude-plugin'), { recursive: true });
  writeFileSync(join(sandbox, '.claude-plugin', 'plugin.json'), JSON.stringify(staged, null, 2));
  mkdirSync(dirname(join(sandbox, hooksRel)), { recursive: true });
  writeFileSync(join(sandbox, hooksRel), JSON.stringify({ modules: hooks.modules }, null, 2));
  const modRel = join('runtime', 'claude-plugin', 'mod');
  cpSync(join(repoRoot, modRel), join(sandbox, modRel), {
    recursive: true,
    filter: (src) => !src.includes(`${join(modRel, '.claude-plugin')}`),
  });
  const result = spawnSync('claude', ['plugin', 'test', sandbox], { stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`[paqad] claude plugin test failed (exit ${result.status}).`);
    process.exit(result.status ?? 1);
  }
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}

console.log('[paqad] claude plugin test passed.');
