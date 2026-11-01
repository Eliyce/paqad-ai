import { existsSync } from 'node:fs';

import {
  hashAgentFile,
  hashAgentText,
  hashFiles,
  listFolderFiles,
  withoutDescription,
} from '../hash.js';
import {
  AGENT_PERMISSION_ALLOW,
  raiseAgentPermissionDecision,
  readAuthoringDecision,
} from '../decisions.js';
import {
  lintAgentInProject,
  PERMISSIONS_FILE,
  POWER_RULES,
  type AgentLintResult,
} from '../lint/agent-lint.js';
import {
  agentTestLocation,
  HOOK_CONTRACT_CHECKS,
  readScriptTestResults,
  scanRiskyText,
  scriptReportsPass,
} from '../tests/script-contract.js';
import {
  AuthoringRefusal,
  clearWaiting,
  requireEarlierGates,
  setWaiting,
  type AuthoringWorkspace,
} from '../workspace.js';
import { agentDraftFile, readAgentDraftSource } from './agent-draft.js';
import { DRAFT_DIR } from './draft.js';
import type { StageResult } from './result.js';
import { RISKY_FILE, riskyGate, runProjectTests, type TestCommandRunner } from './test.js';

export const AGENT_UNDER_TEST_ENV = 'PAQAD_AGENT_UNDER_TEST';

export interface AgentTestOptions {
  runTests?: TestCommandRunner;
  change?: string | null;
}

export function draftHookScripts(workspace: AuthoringWorkspace): string[] {
  return readAgentDraftSource(workspace)?.hook_scripts ?? [];
}

export function draftAgentHash(workspace: AuthoringWorkspace): string {
  return hashAgentFile(
    workspace.dir,
    agentDraftFile(workspace),
    draftHookScripts(workspace),
    workspace.path(DRAFT_DIR),
  );
}

export function draftAgentHashWithoutDescription(workspace: AuthoringWorkspace): string {
  return hashAgentText(
    withoutDescription(workspace.read(agentDraftFile(workspace)) ?? ''),
    draftHookScripts(workspace),
    workspace.path(DRAFT_DIR),
  );
}

export function agentTestInputsHash(workspace: AuthoringWorkspace, testDir: string): string {
  const tests = listFolderFiles(`${workspace.projectRoot}/${testDir}`).map((file) => ({
    rel: `tests/${file.rel}`,
    bytes: file.bytes,
  }));
  return hashFiles([
    { rel: 'agent', bytes: Buffer.from(draftAgentHashWithoutDescription(workspace)) },
    ...tests,
  ]);
}

export function readPermissionIds(workspace: AuthoringWorkspace): string[] {
  return workspace.readJson<string[]>(PERMISSIONS_FILE) ?? [];
}

function onlyPowerFindings(lint: AgentLintResult): boolean {
  const blocking = lint.findings.filter((finding) => finding.severity === 'block');
  return (
    lint.powers.length > 0 &&
    blocking.length > 0 &&
    blocking.every((finding) => POWER_RULES.includes(finding.rule))
  );
}

function permissionGate(
  workspace: AuthoringWorkspace,
  lint: AgentLintResult,
  change: string | null | undefined,
): StageResult | null {
  if (!onlyPowerFindings(lint)) return null;
  const powers = lint.powers.join(', ');
  const resume = `paqad-ai agent test ${workspace.name}`;
  const ids = readPermissionIds(workspace);
  const latest = ids.at(-1);
  const record = latest === undefined ? null : readAuthoringDecision(workspace.projectRoot, latest);
  if (record !== null && record.status !== 'resolved') {
    setWaiting(workspace, { stage: 'S4', decision: record.id, resume });
    return {
      ok: false,
      decision: record.id,
      artifacts: [workspace.relPath(PERMISSIONS_FILE)],
      lines: [
        `S4 is waiting on decision ${record.id} for the powers ${powers}. Once it is answered, run ${resume}.`,
      ],
    };
  }
  if (record !== null && record.chosen !== AGENT_PERMISSION_ALLOW) {
    throw new AuthoringRefusal(
      `S4 can't pass: the owner chose to remove ${powers} (decision ${record.id}). Take them out of the agent, rerun paqad-ai agent draft, then ${resume}.`,
    );
  }
  const id = raiseAgentPermissionDecision(workspace.projectRoot, {
    agent: workspace.name,
    powers: lint.powers,
    fileHash: lint.file_hash,
    change,
  });
  workspace.writeJson(PERMISSIONS_FILE, [...ids, id]);
  setWaiting(workspace, { stage: 'S4', decision: id, resume });
  return {
    ok: false,
    decision: id,
    artifacts: [workspace.relPath(PERMISSIONS_FILE)],
    lines: [
      `${workspace.name} asks for ${powers}, so S4 is waiting on decision ${id} (authoring.agent_permission). Once it is answered, run ${resume}.`,
    ],
  };
}

export async function runAgentTest(
  workspace: AuthoringWorkspace,
  options: AgentTestOptions = {},
): Promise<StageResult> {
  requireEarlierGates(workspace, 'S4');
  const projectRoot = workspace.projectRoot;
  const draft = agentDraftFile(workspace);
  if (!existsSync(workspace.path(draft))) {
    throw new AuthoringRefusal(
      `S4 can't start: ${workspace.relPath(draft)} holds no draft. Run paqad-ai agent draft ${workspace.name} first.`,
    );
  }
  const lint = lintAgentInProject(projectRoot, workspace.path(draft), {
    hookScriptRoot: workspace.path(DRAFT_DIR),
  });
  const lintArtifact = workspace.writeJson('lint.json', {
    gate: lint.blocking === 0 ? 'passed' : 'failed',
    inputs_hash: draftAgentHash(workspace),
    inputs_hash_without_description: draftAgentHashWithoutDescription(workspace),
    ...lint,
  });
  const permission = permissionGate(workspace, lint, options.change);
  if (permission !== null)
    return { ...permission, artifacts: [lintArtifact, ...permission.artifacts] };
  if (lint.blocking > 0) {
    const artifact = workspace.writeJson('script-tests.json', {
      gate: 'failed',
      stage: 'S4',
      reason: 'the lint has blocking findings',
      lint: { blocking: lint.blocking, warnings: lint.warnings },
    });
    return {
      ok: false,
      artifacts: [lintArtifact, artifact],
      lines: [
        ...lint.findings
          .filter((finding) => finding.severity === 'block')
          .map((finding) => `${finding.rule} ${finding.file}:${finding.line} ${finding.message}`),
        `S4 failed: ${lint.blocking} blocking lint finding${lint.blocking === 1 ? '' : 's'}. Fix the agent, rerun paqad-ai agent draft, then paqad-ai agent test ${workspace.name}.`,
      ],
    };
  }

  const scripts = draftHookScripts(workspace);
  const folder = workspace.path(DRAFT_DIR);
  const findings = scripts.flatMap((script) =>
    scanRiskyText(script, workspace.read(`${DRAFT_DIR}/${script}`) ?? ''),
  );
  const risky = riskyGate(workspace, folder, findings, options.change);
  if (risky.refused.length > 0) {
    throw new AuthoringRefusal(
      `S4 can't run: the owner chose to remove the risky part of ${risky.refused.join(', ')}. Edit the hook script, rerun paqad-ai agent draft, then paqad-ai agent test ${workspace.name}.`,
    );
  }
  if (risky.waiting.length > 0) {
    const resume = `paqad-ai agent test ${workspace.name}`;
    setWaiting(workspace, { stage: 'S4', decision: risky.waiting[0]!, resume });
    return {
      ok: false,
      decision: risky.waiting[0]!,
      artifacts: [lintArtifact, workspace.relPath(RISKY_FILE)],
      lines: [
        `S4 is waiting on decision ${risky.waiting.join(', ')} before any hook script runs. Once it is answered, run ${resume}.`,
      ],
    };
  }
  clearWaiting(workspace, 'S4');

  const location = agentTestLocation(projectRoot, workspace.name);
  const { run, testCommand } = await runProjectTests({
    projectRoot,
    testDir: location.dir,
    hasScripts: scripts.length > 0,
    env: { [AGENT_UNDER_TEST_ENV]: workspace.path(draft) },
    runTests: options.runTests,
  });
  const reports = readScriptTestResults({
    projectRoot,
    location,
    scripts,
    run,
    checks: HOOK_CONTRACT_CHECKS,
  });
  const passed = run.exitCode === 0 && scriptReportsPass(reports);
  const artifact = workspace.writeJson('script-tests.json', {
    gate: passed ? 'passed' : 'failed',
    stage: 'S4',
    ...(passed ? {} : { reason: 'a hook script test did not pass' }),
    inputs_hash: agentTestInputsHash(workspace, location.dir),
    file_hash: draftAgentHash(workspace),
    test_location: location.dir,
    test_command: testCommand,
    test_exit_code: run.exitCode,
    lint: { blocking: lint.blocking, warnings: lint.warnings },
    scripts: reports,
  });
  const lines: string[] = [];
  for (const report of reports) {
    for (const check of report.checks.filter((entry) => entry.status !== 'passed')) {
      lines.push(
        `${report.script} ${check.check}: ${check.status}${check.reason ? ` (${check.reason})` : ''}`,
      );
    }
    if (report.all_skipped) {
      lines.push(`${report.script}: every test was skipped, so the gate fails.`);
    }
  }
  lines.push(
    passed
      ? scripts.length === 0
        ? 'S4 passed: no blocking lint finding, and the agent names no hook script to test.'
        : `S4 passed: no blocking lint finding, and the tests for ${scripts.join(', ')} are green under ${testCommand}.`
      : `S4 failed: a hook script test did not pass. The details are in ${artifact}.`,
  );
  if (passed) lines.push(`Next: paqad-ai agent eval plan ${workspace.name}`);
  return { ok: passed, artifacts: [lintArtifact, artifact], lines };
}
