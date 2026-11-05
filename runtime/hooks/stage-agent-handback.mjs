#!/usr/bin/env node

import process from 'node:process';

import {
  appendHooksLog,
  isPaqadDisabled,
  isProjectOnboarded,
  parseHookPayload,
  resolveProjectRoot,
  standDownReason,
} from './lib/paqad-disabled.mjs';

const LOG_PREFIX = 'stage-agent-handback';

function logKey(value) {
  return typeof value === 'string' && value.trim() !== ''
    ? value
        .trim()
        .replace(/[^A-Za-z0-9_-]/g, '_')
        .slice(0, 128)
    : 'none';
}

function errorMessage(error) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/\s+/g, ' ')
    .slice(0, 300);
}

async function importDist(relative) {
  return import(new URL(`../../dist/${relative}`, import.meta.url).href);
}

async function main(input) {
  const hookPayload = parseHookPayload(input);
  const projectRoot = resolveProjectRoot(process.env, hookPayload);
  try {
    if (isPaqadDisabled(projectRoot) || !isProjectOnboarded(projectRoot)) return 0;
    const standDown = standDownReason(hookPayload);
    if (standDown !== null) {
      appendHooksLog(
        projectRoot,
        `${LOG_PREFIX}: stood-down agent=${logKey(hookPayload?.agent_id)} reason=${standDown}`,
      );
      return 0;
    }
    const { decideHandback } = await importDist('stage-isolation/stage-handback.js');
    const decision = decideHandback({ projectRoot, payload: JSON.parse(input) });
    if (decision.exit !== 2) return 0;
    appendHooksLog(projectRoot, `${LOG_PREFIX}: refused agent=${logKey(hookPayload?.agent_id)}`);
    process.stderr.write(`${decision.reason}\n`);
    return 2;
  } catch (error) {
    try {
      appendHooksLog(
        projectRoot,
        `${LOG_PREFIX}: failed agent=${logKey(hookPayload?.agent_id)}: ${errorMessage(error)}`,
      );
    } catch {}
    return 0;
  }
}

let input = '';
process.stdin.on('data', (chunk) => {
  input += chunk;
});
process.stdin.on('end', () => {
  main(input).then(
    (code) => process.exit(code),
    () => process.exit(0),
  );
});
process.stdin.resume();
