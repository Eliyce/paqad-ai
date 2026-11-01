import { existsSync, readFileSync } from 'node:fs';
import { execa } from 'execa';
import { join } from 'node:path';

import { parseCommandChain, runCommandChain } from '@/checks/command-chain.js';
import { readProjectProfile } from '@/core/project-profile.js';
import type { DeliveryShell } from '@/delivery/runner.js';
import { splitSkillFrontmatter } from '@/skills/frontmatter-parser.js';

import { readAuthoringConfig } from '../config.js';
import { option, raiseAuthoringDecision, readAuthoringDecision } from '../decisions.js';
import {
  hashFiles,
  hashFolder,
  hashFolderWithoutDescription,
  hashText,
  listFolderFiles,
} from '../hash.js';
import { lintSkillFolder } from '../lint/skill-lint.js';
import { enabledAdapters, SKILL_FILE } from '../paths.js';
import { checkSkillReferences, type BlockRunner } from '../tests/reference-checks.js';
import {
  readScriptTestResults,
  scanRiskyScripts,
  scriptReportsPass,
  skillTestLocation,
  type RiskFinding,
  type TestRun,
} from '../tests/script-contract.js';
import {
  AuthoringRefusal,
  clearWaiting,
  requireEarlierGates,
  setWaiting,
  type AuthoringWorkspace,
  type SkillWorkspace,
} from '../workspace.js';
import { draftFolder, draftLintsAsRuntime } from './draft.js';
import type { StageResult } from './result.js';

export const RISKY_FILE = 'risky-scripts.json';
export const ALLOW_OPTION = 'allow';
export const REMOVE_OPTION = 'remove';

export const SKILL_UNDER_TEST_ENV = 'PAQAD_SKILL_UNDER_TEST';

export type TestCommandRunner = (
  command: string,
  cwd: string,
  env: Record<string, string>,
) => Promise<TestRun>;

function shellWithEnv(cwd: string, env: Record<string, string>): DeliveryShell {
  return {
    async run(command, args) {
      const result = await execa(command, args, {
        cwd,
        env: { ...process.env, ...env },
        reject: false,
      });
      return {
        stdout: String(result.stdout ?? ''),
        stderr: String(result.stderr ?? ''),
        exitCode: typeof result.exitCode === 'number' ? result.exitCode : 1,
      };
    },
  };
}

export async function defaultTestRunner(
  command: string,
  cwd: string,
  env: Record<string, string> = {},
): Promise<TestRun> {
  const parsed = parseCommandChain(command);
  if (!parsed.ok) {
    throw new AuthoringRefusal(
      `the project test command "${command}" holds "${parsed.invalidToken}", which skill test does not run.`,
    );
  }
  const result = await runCommandChain(shellWithEnv(cwd, env), parsed.steps, cwd);
  return { exitCode: result.exitCode, failedTests: null };
}

interface RiskyEntry {
  script: string;
  hash: string;
  decision: string;
}

export interface SkillTestOptions {
  runTests?: TestCommandRunner;
  blockRunner?: BlockRunner;
  change?: string | null;
}

function scriptHash(folder: string, script: string): string {
  return hashText(readFileSync(join(folder, script.replace(/#.*$/u, '') || SKILL_FILE)));
}

export function riskyGate(
  workspace: AuthoringWorkspace,
  folder: string,
  findings: readonly RiskFinding[],
  change: string | null | undefined,
): { waiting: string[]; refused: string[] } {
  const entries = workspace.readJson<RiskyEntry[]>(RISKY_FILE) ?? [];
  const byScript = new Map<string, RiskFinding[]>();
  for (const finding of findings) {
    const key = finding.file.replace(/#.*$/u, '');
    byScript.set(key, [...(byScript.get(key) ?? []), finding]);
  }
  const waiting: string[] = [];
  const refused: string[] = [];
  const kept: RiskyEntry[] = [];
  for (const [script, found] of [...byScript.entries()].sort()) {
    const hash = scriptHash(folder, script);
    const entry = entries.find((item) => item.script === script && item.hash === hash);
    if (entry) {
      kept.push(entry);
      const record = readAuthoringDecision(workspace.projectRoot, entry.decision);
      if (record?.status !== 'resolved') waiting.push(entry.decision);
      else if (record.chosen !== ALLOW_OPTION) refused.push(script);
      continue;
    }
    const kinds = [...new Set(found.map((item) => item.kind))].join(', ');
    const where = found.map((item) => `line ${item.line} (${item.match})`).join(', ');
    const id = raiseAuthoringDecision(workspace.projectRoot, {
      category: 'authoring.risky_script',
      title: `The script ${script} in ${workspace.name} does ${kinds}. Allow it?`,
      context: `A static scan found ${kinds} in ${script}: ${where}. Nothing in it has run yet.`,
      options: [
        option(
          ALLOW_OPTION,
          'Allow it',
          `If you pick this, ${script} keeps that behaviour; any later edit to it asks again.`,
          `You give up: a ${workspace.kind} whose scripts cannot touch the network, packages or files.`,
        ),
        option(
          REMOVE_OPTION,
          'Remove that part',
          `If you pick this, the risky part of ${script} is taken out before its tests run.`,
          'You give up: whatever that part did.',
        ),
      ],
      recommendation: REMOVE_OPTION,
      change,
    });
    kept.push({ script, hash, decision: id });
    waiting.push(id);
  }
  workspace.writeJson(RISKY_FILE, kept);
  return { waiting, refused };
}

const PATH_FILTER_RUNNERS = /\b(?:vitest|jest|pytest|phpunit|pest|artisan\s+test|mocha)\b/u;
const PACKAGE_TEST = /^(npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b/u;

function packageTestScript(projectRoot: string): string {
  try {
    const parsed = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as {
      scripts?: Record<string, unknown>;
    };
    return typeof parsed.scripts?.test === 'string' ? parsed.scripts.test : '';
  } catch {
    return '';
  }
}

export function skillTestCommand(projectRoot: string, command: string, testDir: string): string {
  const manager = PACKAGE_TEST.exec(command)?.[1];
  const runner = manager === undefined ? command : packageTestScript(projectRoot);
  if (!PATH_FILTER_RUNNERS.test(runner)) return command;
  if (manager === 'npm' && !/\s--(?:\s|$)/u.test(command)) return `${command} -- ${testDir}`;
  return `${command} ${testDir}`;
}

export function testInputsHash(projectRoot: string, folder: string, testDir: string): string {
  const skillFiles = listFolderFiles(folder)
    .filter((file) => file.rel.startsWith('scripts/') || file.rel.startsWith('references/'))
    .map((file) => ({ rel: `skill/${file.rel}`, bytes: file.bytes }));
  const testFiles = listFolderFiles(join(projectRoot, testDir)).map((file) => ({
    rel: `tests/${file.rel}`,
    bytes: file.bytes,
  }));
  return hashFiles([...skillFiles, ...testFiles]);
}

export async function runProjectTests(input: {
  projectRoot: string;
  testDir: string;
  hasScripts: boolean;
  env: Record<string, string>;
  runTests?: TestCommandRunner;
}): Promise<{ run: TestRun; testCommand: string | null }> {
  if (!input.hasScripts) return { run: { exitCode: 0, failedTests: null }, testCommand: null };
  const command = readProjectProfile(input.projectRoot)?.commands?.test?.trim();
  if (!command) {
    throw new AuthoringRefusal(
      'S4 needs the project test command (commands.test in .paqad/project-profile.yaml), and there is none. ' +
        "Propose adding the stack's default test runner.",
    );
  }
  const testCommand = skillTestCommand(input.projectRoot, command, input.testDir);
  const run = await (input.runTests ?? defaultTestRunner)(
    testCommand,
    input.projectRoot,
    input.env,
  );
  return { run, testCommand };
}

function failReport(workspace: SkillWorkspace, reason: string, extra: object): string {
  return workspace.writeJson('script-tests.json', {
    gate: 'failed',
    stage: 'S4',
    reason,
    ...extra,
  });
}

export async function runSkillTest(
  workspace: SkillWorkspace,
  options: SkillTestOptions = {},
): Promise<StageResult> {
  requireEarlierGates(workspace, 'S4');
  const projectRoot = workspace.projectRoot;
  const folder = workspace.path(draftFolder(workspace));
  if (!existsSync(join(folder, SKILL_FILE))) {
    throw new AuthoringRefusal(
      `S4 can't start: ${workspace.relPath(draftFolder(workspace))} holds no draft. Run paqad-ai skill draft ${workspace.name} first.`,
    );
  }
  const config = readAuthoringConfig(projectRoot);
  const lint = lintSkillFolder(folder, {
    projectRoot,
    claudeCode: enabledAdapters(projectRoot).includes('claude-code'),
    bodyMaxTokens: config.skill_body_max_tokens,
    paqadRuntime: draftLintsAsRuntime(workspace),
  });
  const lintArtifact = workspace.writeJson('lint.json', {
    gate: lint.blocking === 0 ? 'passed' : 'failed',
    inputs_hash: hashFolder(folder),
    inputs_hash_without_description: hashFolderWithoutDescription(folder),
    ...lint,
  });
  if (lint.blocking > 0) {
    const artifact = failReport(workspace, 'the lint has blocking findings', {
      lint: { blocking: lint.blocking, warnings: lint.warnings },
    });
    return {
      ok: false,
      artifacts: [lintArtifact, artifact],
      lines: [
        ...lint.findings
          .filter((finding) => finding.severity === 'block')
          .map((finding) => `${finding.rule} ${finding.file}:${finding.line} ${finding.message}`),
        `S4 failed: ${lint.blocking} blocking lint finding${lint.blocking === 1 ? '' : 's'}. Fix the draft and rerun paqad-ai skill draft, then paqad-ai skill test ${workspace.name}.`,
      ],
    };
  }

  const split = splitSkillFrontmatter(readFileSync(join(folder, SKILL_FILE), 'utf8'));
  const risky = riskyGate(
    workspace,
    folder,
    scanRiskyScripts(folder, split.ok ? split.data : {}),
    options.change,
  );
  if (risky.refused.length > 0) {
    throw new AuthoringRefusal(
      `S4 can't run: the owner chose to remove the risky part of ${risky.refused.join(', ')}. Edit the draft, rerun paqad-ai skill draft, then paqad-ai skill test ${workspace.name}.`,
    );
  }
  if (risky.waiting.length > 0) {
    const resume = `paqad-ai skill test ${workspace.name}`;
    setWaiting(workspace, { stage: 'S4', decision: risky.waiting[0]!, resume });
    return {
      ok: false,
      decision: risky.waiting[0]!,
      artifacts: [lintArtifact, workspace.relPath(RISKY_FILE)],
      lines: [
        `S4 is waiting on decision ${risky.waiting.join(', ')} before any script runs. Once it is answered, run ${resume}.`,
      ],
    };
  }
  clearWaiting(workspace, 'S4');

  const references = checkSkillReferences({
    skillFolder: folder,
    projectRoot,
    runner: options.blockRunner,
  });
  const location = skillTestLocation(projectRoot, workspace.name);
  const scripts = listFolderFiles(folder)
    .map((file) => file.rel)
    .filter((rel) => rel.startsWith('scripts/'));
  const { run, testCommand } = await runProjectTests({
    projectRoot,
    testDir: location.dir,
    hasScripts: scripts.length > 0,
    env: { [SKILL_UNDER_TEST_ENV]: folder },
    runTests: options.runTests,
  });
  const reports = readScriptTestResults({ projectRoot, location, scripts, run });
  const scriptsPass = scriptReportsPass(reports);
  const passed = references.length === 0 && scriptsPass;
  const reasons: string[] = [];
  if (references.length > 0) reasons.push(`${references.length} reference check failure(s)`);
  if (!scriptsPass) reasons.push('a script contract check did not pass');
  const artifact = workspace.writeJson('script-tests.json', {
    gate: passed ? 'passed' : 'failed',
    stage: 'S4',
    ...(passed ? {} : { reason: reasons.join('; ') }),
    inputs_hash: testInputsHash(workspace.projectRoot, folder, location.dir),
    test_location: location.dir,
    test_command: testCommand,
    test_exit_code: run.exitCode,
    lint: { blocking: lint.blocking, warnings: lint.warnings },
    references,
    scripts: reports,
  });
  const lines: string[] = references.map(
    (finding) => `reference ${finding.file}:${finding.line} ${finding.message}`,
  );
  for (const report of reports) {
    for (const check of report.checks.filter((entry) => entry.status !== 'passed')) {
      lines.push(
        `${report.script} ${check.check}: ${check.status}${check.reason ? ` (${check.reason})` : ''}`,
      );
    }
    if (report.all_skipped)
      lines.push(`${report.script}: every test was skipped, so the gate fails.`);
  }
  lines.push(
    passed
      ? `S4 passed: no blocking lint finding, every reference check and every script contract check is green.`
      : `S4 failed: ${reasons.join('; ')}. The details are in ${artifact}.`,
  );
  return { ok: passed, artifacts: [lintArtifact, artifact], lines };
}
