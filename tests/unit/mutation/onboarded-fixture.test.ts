import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { execaSync } from 'execa';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import YAML from 'yaml';

import { runCli } from '@/cli/index.js';
import type { RunMutationGateOptions } from '@/mutation/runner.js';
import { runMutationGate } from '@/mutation/runner.js';
import type { BackstopMutationDeps } from '@/mutation/backstop.js';
import type { VerificationEvidence } from '@/core/types/verification-evidence.js';
import { VERIFICATION_EVIDENCE_RELATIVE_PATH } from '@/verification/evidence.js';
import { runRepositoryVerification } from '@/verification/repository/run-repository-verification.js';

import { seedDetectionFixtures } from '../../shared/detection-fixtures.js';

const STRYKER_REPORT = 'reports/mutation/mutation.json';

interface FixtureMutant {
  file: string;
  line: number;
  operator: string;
}

function git(root: string, args: string[]): void {
  execaSync('git', args, { cwd: root });
}

function write(root: string, rel: string, content: string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content, 'utf8');
}

function failing(verdict: { gates: { gate: string; status: string }[] }): string[] {
  return verdict.gates.filter((entry) => entry.status === 'fail').map((entry) => entry.gate);
}

function porcelain(root: string): string {
  return execaSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: root }).stdout;
}

describe('mutation testing on a fresh onboarded fixture', () => {
  let tmp: string;
  let project: string;
  let survivor: FixtureMutant;
  let testCommand: string;

  beforeEach(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'paqad-mutation-e2e-'));
    seedDetectionFixtures(tmp);
    project = join(tmp, 'new-react');
    await runCli(['node', 'paqad-ai', 'onboard', '--project-root', project, '--stack', 'react']);

    write(project, 'stryker.conf.json', '{ "testRunner": "vitest" }\n');
    write(project, '.gitignore', 'node_modules/\nreports/\n');
    git(project, ['init', '-q', '-b', 'main']);
    git(project, ['config', 'user.email', 'test@paqad.dev']);
    git(project, ['config', 'user.name', 'paqad test']);
    git(project, ['config', 'commit.gpgsign', 'false']);
    write(project, '.git/info/exclude', '.paqad/\n');
    git(project, ['add', '-A']);
    git(project, ['commit', '-qm', 'onboarded base']);

    write(
      project,
      'src/App.tsx',
      'export default function App() { return 1 > 0 ? null : null; }\n',
    );
    write(project, 'src/App.test.tsx', 'import App from "./App";\ntest("app", () => App());\n');

    survivor = { file: 'src/App.tsx', line: 1, operator: 'ConditionalExpression' };
    write(
      project,
      STRYKER_REPORT,
      JSON.stringify({
        files: {
          [survivor.file]: {
            mutants: [
              {
                status: 'Survived',
                mutatorName: survivor.operator,
                location: { start: { line: survivor.line } },
              },
              {
                status: 'Killed',
                mutatorName: 'EqualityOperator',
                location: { start: { line: 1 } },
              },
            ],
          },
        },
      }),
    );

    const profile = YAML.parse(
      readFileSync(join(project, '.paqad/project-profile.yaml'), 'utf8'),
    ) as { commands: { test: string } };
    testCommand = profile.commands.test;
  }, 120_000);

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  function setMode(mode: string): void {
    const policy = join(project, '.paqad/configs/.config.policy');
    const existing = existsSync(policy) ? readFileSync(policy, 'utf8') : '';
    writeFileSync(policy, `${existing}\nmutation_mode=${mode}\n`, 'utf8');
  }

  function deps() {
    const runTestCommand = vi.fn(async () => ({ exitCode: 0 }));
    const runMutation = vi.fn((options: RunMutationGateOptions) => runMutationGate(options));
    const mutationDeps: BackstopMutationDeps = {
      runTestCommand,
      runMutation,
      runner: { execute: async () => ({ exitCode: 0, stdout: '', stderr: '' }) },
    };
    return { runTestCommand, runMutation, mutationDeps };
  }

  async function verify(mutationDeps: BackstopMutationDeps) {
    const verdict = await runRepositoryVerification({
      projectRoot: project,
      origin: 'ci-backstop',
      mutationDeps,
    });
    const gate = verdict.gates.find((entry) => entry.gate === 'mutation-testing');
    return { verdict, gate };
  }

  it('AC-18: warn on ci-backstop reads a survivor as inconclusive and records it in the evidence', async () => {
    setMode('warn');
    const { runTestCommand, mutationDeps } = deps();
    const before = porcelain(project);

    const { gate } = await verify(mutationDeps);

    expect(testCommand.length).toBeGreaterThan(0);
    expect(runTestCommand).toHaveBeenCalledWith(testCommand, project);
    expect(gate?.status).toBe('inconclusive');
    expect(gate?.detail).toContain(`${survivor.file}:${survivor.line} (${survivor.operator})`);

    const evidence = JSON.parse(
      readFileSync(join(project, VERIFICATION_EVIDENCE_RELATIVE_PATH), 'utf8'),
    ) as VerificationEvidence;
    const mutationGate = evidence.gates.find((entry) => entry.name === 'mutation-testing');
    expect(mutationGate?.status).toBe('inconclusive');
    expect(mutationGate?.failures).toEqual([
      expect.objectContaining({
        file: survivor.file,
        line: survivor.line,
        message: `Surviving mutant (${survivor.operator})`,
      }),
    ]);
    expect(porcelain(project)).toBe(before);
  }, 120_000);

  it('AC-19: strict on ci-backstop blocks on the same survivor', async () => {
    setMode('strict');
    const strict = await verify(deps().mutationDeps);

    expect(strict.gate?.status).toBe('fail');
    expect(strict.gate?.detail).toContain(`${survivor.file}:${survivor.line}`);
    expect(strict.verdict.ok).toBe(false);
    expect(failing(strict.verdict)).toEqual(['mutation-testing']);
  }, 120_000);

  it('reads the rules load as not required on ci-backstop, so no gate fails in warn', async () => {
    setMode('warn');
    const { verdict } = await verify(deps().mutationDeps);

    expect(verdict.gates.find((entry) => entry.gate === 'rules-loaded')).toMatchObject({
      status: 'skipped',
      skip_kind: 'not-required',
      detail: 'No session loads rules on CI, so the load was not required here.',
    });
    expect(failing(verdict)).toEqual([]);
  }, 120_000);

  it('AC-23: the detected stack profile reaches selectMutationTool and selects Stryker', async () => {
    setMode('warn');
    const { runMutation, mutationDeps } = deps();

    await verify(mutationDeps);

    expect(runMutation).toHaveBeenCalledTimes(1);
    const options = runMutation.mock.calls[0]![0];
    expect(options.stackProfile).not.toBeNull();
    expect(options.stackProfile?.frameworks).toContain('react');
    expect(options.testsGreen).toBe(true);
    expect(await runMutation.mock.results[0]!.value).toMatchObject({ tool: 'stryker' });
  }, 120_000);

  it('AC-23: with no mutation tool configured the gate reads did not run, naming the tool', async () => {
    setMode('warn');
    rmSync(join(project, 'stryker.conf.json'));
    const { mutationDeps } = deps();

    const { verdict, gate } = await verify(mutationDeps);

    expect(gate?.status).toBe('skipped');
    expect(gate?.skip_kind).toBe('did-not-run');
    expect(gate?.detail).toContain('no mutation tool is configured');
    expect(failing(verdict)).not.toContain('mutation-testing');
  }, 120_000);
});
