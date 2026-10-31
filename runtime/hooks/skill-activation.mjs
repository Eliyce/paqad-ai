#!/usr/bin/env node

import process from 'node:process';

function quickFilter(input) {
  try {
    const payload = JSON.parse(input);
    if (payload?.tool_name === 'Skill') return payload;
    if (payload?.tool_name !== 'Read') return null;
    const path = payload?.tool_input?.file_path;
    return typeof path === 'string' && /(^|[\\/])SKILL\.md$/.test(path) ? payload : null;
  } catch {
    return null;
  }
}

async function record(payload) {
  const { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync } =
    await import('node:fs');
  const { dirname, join } = await import('node:path');
  const core = await import('./lib/skill-activation-core.mjs');
  const gate = await import('./lib/paqad-disabled.mjs');
  const projectRoot = gate.resolveProjectRoot(process.env, payload);
  if (gate.isPaqadDisabled(projectRoot) || !gate.isProjectOnboarded(projectRoot)) return;
  const enabled = gate.readLayeredKey(
    projectRoot,
    'skill_orchestrator_enabled',
    'PAQAD_SKILL_ORCHESTRATOR_ENABLED',
  );
  if (enabled !== undefined && ['false', '0', 'no', 'off'].includes(enabled.trim().toLowerCase()))
    return;
  const entry = core.activationFromPayload(payload);
  const line = entry === null ? null : core.activationLine(entry);
  if (line === null) return;
  const file = join(projectRoot, core.ACTIVATIONS_REL);
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, line, 'utf8');
  if (statSync(file).size > core.PRUNE_THRESHOLD_BYTES) {
    const window = Number(process.env.PAQAD_AUTHORING_DARK_WINDOW_DAYS);
    writeFileSync(
      file,
      core.pruneActivationText(
        readFileSync(file, 'utf8'),
        new Date(),
        Number.isInteger(window) && window > 0 ? window : core.DEFAULT_DARK_WINDOW_DAYS,
      ),
      'utf8',
    );
  }
}

async function main() {
  let input = '';
  try {
    for await (const chunk of process.stdin) input += chunk;
    const payload = quickFilter(input);
    if (payload !== null) await record(payload);
  } catch {
    process.exitCode = 0;
  }
  process.exitCode = 0;
}

await main();
