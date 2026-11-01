#!/usr/bin/env node

import process from 'node:process';

function quickFilter(input) {
  try {
    const payload = JSON.parse(input);
    if (payload?.hook_event_name === 'SubagentStop') return payload;
    if (payload?.hook_event_name !== undefined && payload.hook_event_name !== 'PostToolUse') {
      return null;
    }
    return payload?.tool_name === 'Agent' || payload?.tool_name === 'Task' ? payload : null;
  } catch {
    return null;
  }
}

async function record(payload) {
  const fs = await import('node:fs');
  const { basename, dirname, join } = await import('node:path');
  const core = await import('./lib/agent-delegation-core.mjs');
  const gate = await import('./lib/paqad-disabled.mjs');
  const projectRoot = gate.resolveProjectRoot(process.env, payload);
  if (gate.isPaqadDisabled(projectRoot) || !gate.isProjectOnboarded(projectRoot)) return;
  const enabled = gate.readLayeredKey(
    projectRoot,
    'agent_orchestrator_enabled',
    'PAQAD_AGENT_ORCHESTRATOR_ENABLED',
  );
  if (enabled !== undefined && ['false', '0', 'no', 'off'].includes(enabled.trim().toLowerCase()))
    return;
  const entry = core.delegationFromPayload(payload);
  const line = entry === null ? null : core.delegationLine(entry);
  if (line === null) return;
  const file = join(projectRoot, core.DELEGATIONS_REL);
  fs.mkdirSync(dirname(file), { recursive: true });
  fs.appendFileSync(file, line, 'utf8');
  const fd = fs.openSync(file, 'r');
  let text;
  try {
    if (fs.fstatSync(fd).size <= core.PRUNE_THRESHOLD_BYTES) return;
    text = fs.readFileSync(fd, 'utf8');
  } finally {
    fs.closeSync(fd);
  }
  const window = Number(
    gate.readLayeredKey(
      projectRoot,
      'authoring_dark_window_days',
      'PAQAD_AUTHORING_DARK_WINDOW_DAYS',
    ),
  );
  const pruned = core.pruneDelegationText(
    text,
    new Date(),
    Number.isInteger(window) && window > 0 ? window : core.DEFAULT_DARK_WINDOW_DAYS,
  );
  const tmp = join(dirname(file), `.${basename(file)}.${process.pid}.tmp`);
  try {
    fs.writeFileSync(tmp, pruned, 'utf8');
    fs.renameSync(tmp, file);
  } catch (error) {
    fs.rmSync(tmp, { force: true });
    throw error;
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
