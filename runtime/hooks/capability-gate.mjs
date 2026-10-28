#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

import { isDirectEntry } from './lib/direct-entry.mjs';

import { sentinelState } from './lib/agent-entry-sentinel.mjs';
import { agentIdFromStdin, sessionIdFromStdin } from './lib/context-seam-emit.mjs';
import { editTargets } from './lib/edit-targets.mjs';
import { gateFailureMessage } from './lib/gate-failure.mjs';
import {
  appendHooksLog,
  hookStandsDown,
  isManagedRoute,
  isPaqadDisabled,
  isSchemaVersionError,
  MANAGED_BLOCK_LINE,
  parseHookPayload,
  readFlooredMode,
  resolveProjectRoot,
} from './lib/paqad-disabled.mjs';
import { stopHookActiveFromStdin } from './lib/loop-guard.mjs';
import { refreshHudFromHook } from './lib/hud-snapshot.mjs';

const RULE_SCRIPT_MAP_REL = 'docs/instructions/rules/rule-script-map.yml';
const RULE_COMPLIANCE_MODES = ['off', 'warn', 'strict'];
const STAGES_MODES = ['off', 'warn', 'strict'];

const SEAM = process.argv[2] === 'completion' ? 'completion' : 'pre-mutation';
const ADAPTER = process.argv[3] || undefined;

const ASK_OFF_ROUTE =
  '[paqad] You allowed this edit once in the paqad HUD, but only Claude Code can ask you to approve it, so it stays blocked.';

export function preToolUseAsk(result, seam = SEAM, adapter = ADAPTER) {
  if (seam !== 'pre-mutation' || adapter !== undefined) return null;
  if (typeof result?.ask !== 'string' || result.ask === '') return null;
  const output = {
    hookEventName: 'PreToolUse',
    permissionDecision: 'ask',
    permissionDecisionReason: result.ask,
    ...(result.context ? { additionalContext: result.context } : {}),
  };
  return `${JSON.stringify({ hookSpecificOutput: output })}\n`;
}

function seamHasWork(projectRoot, seam) {
  if (seam === 'pre-mutation') {
    return true;
  }
  const stagesMode = readFlooredMode(
    projectRoot,
    'stages_mode',
    'PAQAD_STAGES_MODE',
    STAGES_MODES,
    'strict',
  );
  if (stagesMode !== 'off') {
    return true;
  }
  if (!existsSync(join(projectRoot, RULE_SCRIPT_MAP_REL))) {
    return false;
  }
  const mode = readFlooredMode(
    projectRoot,
    'rule_compliance',
    'PAQAD_RULE_COMPLIANCE',
    RULE_COMPLIANCE_MODES,
    'warn',
  );
  return mode !== 'off';
}

function parsePayload(input) {
  try {
    const payload = JSON.parse(input);
    const targets = editTargets(payload);
    return {
      toolName: payload?.tool_name,
      targetPath: targets[0],
      targetPaths: targets.length > 0 ? targets : undefined,
      transcriptPath: payload?.transcript_path,
      sessionId: payload?.session_id,
      adapter: ADAPTER,
      toolUseId: typeof payload?.tool_use_id === 'string' ? payload.tool_use_id : undefined,
      toolInput: payload?.tool_input,
    };
  } catch {
    /* v8 ignore next 2 */
    return undefined;
  }
}

export function entryLoadedProbe(projectRoot, input) {
  return () => {
    try {
      const state = sentinelState(
        projectRoot,
        process.env,
        agentIdFromStdin(input),
        sessionIdFromStdin(input),
      );
      return state === 'fresh';
    } catch {
      return false;
    }
  };
}

async function deferredForBackgroundStage(projectRoot, input) {
  const payload = parseHookPayload(input);
  const tasks = payload && Array.isArray(payload.background_tasks) ? payload.background_tasks : [];
  if (tasks.length === 0) {
    return false;
  }
  try {
    const distUrl = new URL('../../dist/stage-evidence/completion-deferred.js', import.meta.url);
    const { deferCompletionForBackgroundStage } = await import(distUrl.href);
    const result = deferCompletionForBackgroundStage({
      projectRoot,
      backgroundTasks: tasks,
      sessionId: payload?.session_id,
      adapter: ADAPTER ?? 'claude-code',
      record: false,
    });
    return result.deferred && result.reason !== 'between stages';
  } catch {
    return false;
  }
}

export async function main(input, seam = SEAM) {
  const startedAt = Date.now();
  try {
    const projectRoot = resolveProjectRoot(process.env, parseHookPayload(input));
    const managed = isManagedRoute(process.env);
    if (!managed && (isPaqadDisabled(projectRoot) || hookStandsDown(parseHookPayload(input)))) {
      return 0;
    }

    if (seam === 'completion' && (await deferredForBackgroundStage(projectRoot, input))) {
      return 0;
    }

    if (!seamHasWork(projectRoot, seam)) return 0;

    const distUrl = new URL('../../dist/kernel/gate.js', import.meta.url);
    const { runCapabilityGate } = await import(distUrl.href);

    const result = await runCapabilityGate({
      projectRoot,
      seam,
      payload: parsePayload(input),
      entryLoaded: entryLoadedProbe(projectRoot, input),
      startedAt,
    });
    if (result.block) {
      const message = result.narration ? `${result.narration}\n${result.summary}` : result.summary;
      const body = result.context ? `${message}\n${result.context}` : message;
      process.stderr.write(managed ? `${body}\n${MANAGED_BLOCK_LINE}\n` : `${body}\n`);
      if (seam === 'completion' && stopHookActiveFromStdin(input)) {
        process.stderr.write(
          '[paqad] already surfaced this turn — not blocking again so the session can end (git/CI remains the hard gate).\n',
        );
        return 0;
      }
      return 2;
    }
    if (result.ask) {
      const answer = preToolUseAsk(result, seam, ADAPTER);
      if (answer === null) {
        process.stderr.write(`${ASK_OFF_ROUTE}\n`);
        return 2;
      }
      process.stdout.write(answer);
      return 0;
    }
    if (seam === 'pre-mutation' && result.context && ADAPTER === undefined) {
      process.stdout.write(
        `${JSON.stringify({
          hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: result.context },
        })}\n`,
      );
    }
    return 0;
  } catch (error) {
    if (isSchemaVersionError(error)) {
      try {
        appendHooksLog(
          resolveProjectRoot(process.env, parseHookPayload(input)),
          'capability-gate skipped: .paqad layout written by a newer paqad; run `claude plugin update paqad@eliyce`',
        );
      } catch {}
      return 0;
    }
    if (seam === 'pre-mutation') {
      process.stderr.write(`${gateFailureMessage('capability', error)}\n`);
      return 2;
    }
    return 0;
  }
}

if (isDirectEntry(import.meta.url)) {
  let input = '';
  process.stdin.on('data', (chunk) => {
    input += chunk;
  });
  process.stdin.on('end', () => {
    main(input).then(async (code) => {
      if (SEAM === 'completion') await refreshHudFromHook(input, 'capability-gate-completion');
      process.exit(code);
    });
  });
  process.stdin.resume();
}
