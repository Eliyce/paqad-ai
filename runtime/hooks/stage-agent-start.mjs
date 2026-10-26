#!/usr/bin/env node

import process from 'node:process';

import {
  appendHooksLog,
  hookStandsDown,
  isPaqadDisabled,
  isProjectOnboarded,
  parseHookPayload,
  resolveProjectRoot,
} from './lib/paqad-disabled.mjs';
import { stampAgentEntryMarker } from './lib/agent-entry-sentinel.mjs';

const LOG_PREFIX = 'stage-agent-start';

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

// The stage agent is now running: one `started` stage-agent row in the change's ledger lets the
// turn-end backstop hold its judgement on every host, with or without background_tasks.
async function recordStart(projectRoot, payload) {
  try {
    const { recordStageAgentStart } = await importDist('stage-isolation/subagent-completion.js');
    recordStageAgentStart({ projectRoot, payload });
  } catch {
    /* v8 ignore next */
  }
}

async function seed(projectRoot, payload) {
  const agent = logKey(payload.agent_id);
  let stage = 'unknown';
  try {
    const { seedStageAgent, stageHelperStage } = await importDist('stage-isolation/stage-brief.js');
    const resolved = stageHelperStage(payload.agent_type);
    if (!resolved) {
      appendHooksLog(projectRoot, `${LOG_PREFIX}: skipped agent=${agent} stage=none`);
      return;
    }
    stage = resolved;
    process.stdout.write(seedStageAgent(stage, projectRoot, payload));
    stampAgentEntryMarker(projectRoot, payload.agent_id);
    await recordStart(projectRoot, payload);
    appendHooksLog(projectRoot, `${LOG_PREFIX}: seeded agent=${agent} stage=${stage}`);
  } catch (error) {
    appendHooksLog(
      projectRoot,
      `${LOG_PREFIX}: failed agent=${agent} stage=${stage}: ${errorMessage(error)}`,
    );
  }
}

async function main(input) {
  const hookPayload = parseHookPayload(input);
  const projectRoot = resolveProjectRoot(process.env, hookPayload);
  try {
    if (
      isPaqadDisabled(projectRoot) ||
      !isProjectOnboarded(projectRoot) ||
      hookStandsDown(hookPayload)
    ) {
      return;
    }
    let payload;
    try {
      payload = JSON.parse(input);
    } catch {
      return;
    }
    if (!payload || typeof payload !== 'object') {
      return;
    }
    await seed(projectRoot, payload);
  } catch (error) {
    appendHooksLog(
      projectRoot,
      `${LOG_PREFIX}: failed agent=none stage=none: ${errorMessage(error)}`,
    );
  }
}

let input = '';
process.stdin.on('data', (chunk) => {
  input += chunk;
});
process.stdin.on('end', () => {
  main(input).finally(() => {
    process.exitCode = 0;
  });
});
process.stdin.resume();
