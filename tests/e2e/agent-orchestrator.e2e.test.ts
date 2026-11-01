import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import YAML from 'yaml';
import { afterAll, describe, expect, it } from 'vitest';

import { AdapterFactory } from '@/adapters/factory.js';
import { parseAgentSource } from '@/authoring/package/agent-render.js';
import { runAgentDraft } from '@/authoring/stages/agent-draft.js';
import { runAgentEvalPlan, runAgentEvalRecord } from '@/authoring/stages/agent-eval.js';
import { runAgentEvidence } from '@/authoring/stages/agent-evidence.js';
import { runAgentIntake } from '@/authoring/stages/agent-intake.js';
import { runAgentJustify } from '@/authoring/stages/agent-justify.js';
import { runAgentRelease } from '@/authoring/stages/agent-release.js';
import { runAgentTest } from '@/authoring/stages/agent-test.js';
import { runDelegationPlan, runDelegationRecord } from '@/authoring/stages/delegation.js';
import { defaultTestRunner } from '@/authoring/stages/test.js';
import { AgentWorkspace } from '@/authoring/workspace.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import { resolveSessionId } from '@/rag-ledger/session.js';
import { bundleCompletenessGate } from '@/verification/repository/bundle-completeness-gate.js';

import {
  AGENT_INTAKE,
  AGENT_NAME,
  AGENT_SOURCES,
  AGENT_TRACE,
  addCase,
  writeTrials,
} from '../shared/agent-pipeline.js';

const REPO = resolve(import.meta.dirname, '../..');
const FIXTURES = join(REPO, 'tests/fixtures/authoring');
const VITEST = join(REPO, 'node_modules/vitest/vitest.mjs');
const AGENT_LINE = `The agent ${AGENT_NAME} changed but never went through its checks. Run paqad-ai agent status ${AGENT_NAME}.`;
const LARAVEL = join(FIXTURES, 'laravel-project');
const PHP = spawnSync('php', ['--version'], { encoding: 'utf8' });
const LARAVEL_READY = PHP.status === 0 && existsSync(join(LARAVEL, 'vendor/autoload.php'));
const LARAVEL_SKIP_REASON =
  PHP.status !== 0
    ? 'php is not installed, so the Laravel half of the agent e2e is skipped'
    : 'tests/fixtures/authoring/laravel-project/vendor is missing (run composer install there), so the Laravel half is skipped';

const created: string[] = [];

afterAll(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

function copyProject(fixture: string): string {
  const root = join(REPO, '.paqad/tmp', `e2e-agent-${fixture}-${process.pid}-${created.length}`);
  rmSync(root, { recursive: true, force: true });
  cpSync(join(FIXTURES, fixture), root, { recursive: true });
  created.push(root);
  if (existsSync(join(root, '.env.example')))
    cpSync(join(root, '.env.example'), join(root, '.env'));
  mkdirSync(join(root, '.paqad'), { recursive: true });
  mkdirSync(join(root, 'home'), { recursive: true });
  writeFileSync(
    join(root, '.paqad/onboarding-manifest.json'),
    JSON.stringify({
      adapter: 'claude-code',
      generated_artifacts: [{ path: AdapterFactory.create('codex-cli').getConfigPath() }],
    }),
  );
  writeFileSync(join(root, '.paqad/.config'), 'model_fast=fast-m\nmodel_reasoning=strong-m\n');
  return root;
}

function profile(root: string, testCommand: string): void {
  writeFileSync(
    join(root, '.paqad/project-profile.yaml'),
    YAML.stringify({
      project: { name: 'fixture', id: 'fixture' },
      commands: { test: testCommand },
    }),
  );
}

function place(root: string, from: string, to: string): void {
  mkdirSync(join(root, to, '..'), { recursive: true });
  cpSync(join(root, from), join(root, to));
}

function throughDraft(root: string, hook: { from: string; to: string }): AgentWorkspace {
  const workspace = new AgentWorkspace(root, AGENT_NAME);
  workspace.write('task.md', '# Task\n\nReview a migration.\n\n## Restriction\n\nNo edits.\n');
  for (const run of [1, 2, 3]) workspace.write(`baseline/run-${run}.md`, `run ${run}\n`);
  workspace.writeJson(
    'baseline/verdicts.json',
    [1, 2, 3].map((run) => ({
      run,
      passed: run === 1,
      note: 'n',
      tokens: 4000,
      duration_ms: 1000,
      verbose_tokens_in_main: 100,
    })),
  );
  expect(
    runAgentJustify(workspace, {
      reason: 'restriction',
      taskText: workspace.read('task.md')!,
    }).ok,
  ).toBe(true);
  expect(runAgentIntake(workspace, YAML.stringify(AGENT_INTAKE)).ok).toBe(true);
  expect(runAgentEvidence(workspace, { sourcesText: AGENT_SOURCES, userHome: null }).ok).toBe(true);
  place(root, `agent/${AGENT_NAME}.md`, `drafts/${AGENT_NAME}.md`);
  place(root, hook.from, hook.to);
  const draft = runAgentDraft(workspace, {
    file: `drafts/${AGENT_NAME}.md`,
    traceText: AGENT_TRACE,
  });
  expect(draft.ok).toBe(true);
  return workspace;
}

async function throughEvalsAndDelegation(workspace: AgentWorkspace): Promise<void> {
  addCase(workspace, 'drops-column', { adversarial: true });
  addCase(workspace, 'clean-migration', { clean_input: true });
  expect(runAgentEvalPlan(workspace, { probe: () => null }).ok).toBe(true);
  writeTrials(workspace, (trial) => ({ passed: trial.arm === 'with_agent' }));
  expect((await runAgentEvalRecord(workspace)).ok).toBe(true);
  const requests = [
    ...Array.from({ length: 9 }, (_, i) => ({
      id: `p${i}`,
      request: `review migration ${i}`,
      should_delegate: true,
    })),
    ...Array.from({ length: 9 }, (_, i) => ({
      id: `n${i}`,
      request: `rename ${i}`,
      should_delegate: false,
    })),
  ];
  runDelegationPlan(workspace, JSON.stringify(requests));
  const ids = requests.map((entry) => entry.id);
  const record = runDelegationRecord(
    workspace,
    JSON.stringify({
      iterations: [
        {
          iteration: 1,
          description:
            'Use this agent when a change adds a database migration. For example "review this migration" or "is this migration safe to run".',
          source: 'host',
          results: ids.flatMap((id) =>
            [1, 2, 3].map((run) => ({ id, run, fired: id.startsWith('p') })),
          ),
        },
      ],
      fresh: Array.from({ length: 5 }, (_, i) => ({
        request: `fresh ${i}`,
        should_delegate: true,
        runs: [true, true, true],
      })),
      cost_usd: 0.1,
    }),
  );
  expect(record.ok).toBe(true);
}

function gateDetail(
  root: string,
  dirName: string,
  changedFiles: string[],
): { status: string; detail: string } {
  const gate = bundleCompletenessGate({
    projectRoot: root,
    sessionId: 'ses-e2e-agent',
    dirName,
    mode: 'strict',
    origin: 'hook-completion',
    isFeatureDev: true,
    changeMetrics: null,
    config: {
      lane: 'full',
      ruleComplianceOn: false,
      metricsEnabled: false,
      duplicationOn: false,
      featureReport: false,
      ragEnabled: false,
      enterprise: false,
      evidenceLedger: false,
      aiBom: false,
      specPipelineStrict: false,
      specPipelineEnabled: false,
      expertsEnabled: false,
      specFrozenBeforePipeline: false,
      stageIsolationExpected: false,
      stageIsolationUnresolved: false,
    },
    changedFiles,
  });
  return { status: gate?.status ?? 'none', detail: gate?.detail ?? '' };
}

describe('agent orchestrator e2e: npm project with Vitest', () => {
  it('AC-14, AC-15, AC-21: hook script tests pass under npm test, release writes the Claude file and the SDK form, and the change ends green only with the record', async () => {
    const root = copyProject('npm-project');
    const command = `node "${VITEST}" run --config vitest.config.mjs`;
    profile(root, command);
    const previousHome = process.env.HOME;
    process.env.HOME = join(root, 'home');
    try {
      const sessionId = resolveSessionId(root, 'ses-e2e-agent');
      const dirName = openFeatureChange(root, sessionId, {
        adapter: 'claude-code',
        title: 'add migration reviewer',
        lane: 'graduated',
      });
      const workspace = throughDraft(root, {
        from: 'agent/hooks/block-edits.mjs',
        to: '.claude/hooks/block-edits.mjs',
      });
      place(
        root,
        'agent/tests/block-edits.test.ts.fixture',
        `tests/agents/${AGENT_NAME}/block-edits.test.ts`,
      );
      const s4 = await runAgentTest(workspace);
      expect(s4.ok).toBe(true);
      expect(s4.lines.join('\n')).toContain('S4 passed');

      await throughEvalsAndDelegation(workspace);
      const claudeFile = `.claude/agents/${AGENT_NAME}.md`;
      const baseline = gateDetail(root, dirName, ['src/a.ts']);
      mkdirSync(join(root, '.claude/agents'), { recursive: true });
      writeFileSync(join(root, claudeFile), readFileSync(join(root, `drafts/${AGENT_NAME}.md`)));
      const missing = gateDetail(root, dirName, [claudeFile]);
      expect(missing.status).toBe('fail');
      expect(missing.detail).toContain(AGENT_LINE);
      rmSync(join(root, claudeFile));

      const release = runAgentRelease(workspace, { sessionId });
      expect(release.ok).toBe(true);
      const claude = parseAgentSource(readFileSync(join(root, claudeFile), 'utf8'));
      const sdk = JSON.parse(
        readFileSync(
          join(root, `.paqad/authoring/agents/${AGENT_NAME}/${AGENT_NAME}.agent.json`),
          'utf8',
        ),
      ) as { tools: string[]; model: string; prompt: string; maxBudgetUsd?: number };
      expect(sdk.tools).toEqual(claude.tools);
      expect(sdk.model).toBe(claude.model);
      expect(sdk.prompt).toBe(claude.body);
      expect(sdk.maxBudgetUsd).toBeUndefined();
      const evidence = JSON.parse(
        readFileSync(join(root, `.paqad/authoring/agents/${AGENT_NAME}/evidence.json`), 'utf8'),
      ) as { deployable: Record<string, boolean> };
      expect(evidence.deployable['claude-code']).toBe(true);
      expect(evidence.deployable['codex-cli']).toBe(false);
      expect(existsSync(join(root, `.codex/agents/${AGENT_NAME}.toml`))).toBe(false);
      expect(release.lines.join('\n')).toMatch(
        /not deployable on codex-cli.*blocking PreToolUse hook/,
      );

      expect(gateDetail(root, dirName, [claudeFile]).detail).not.toContain(AGENT_LINE);
      expect(gateDetail(root, dirName, ['src/a.ts'])).toEqual(baseline);

      const normal = await defaultTestRunner(command, root);
      expect(normal.exitCode).toBe(0);
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
    }
  }, 180_000);
});

describe('agent orchestrator e2e: Laravel project with Pest', () => {
  it.skipIf(!LARAVEL_READY)(
    `AC-15: the hook script tests pass under php artisan test${LARAVEL_READY ? '' : ` (skipped: ${LARAVEL_SKIP_REASON})`}`,
    async () => {
      const root = copyProject('laravel-project');
      profile(root, 'php artisan test');
      const workspace = throughDraft(root, {
        from: 'agent/hooks/BlockEdits.php',
        to: '.claude/hooks/BlockEdits.php',
      });
      place(
        root,
        'agent/tests/BlockEditsTest.php.fixture',
        'tests/Feature/Agents/MigrationReviewer/BlockEditsTest.php',
      );
      const s4 = await runAgentTest(workspace);
      expect(s4.lines.join('\n')).toContain('S4 passed');
      const report = JSON.parse(readFileSync(workspace.path('script-tests.json'), 'utf8'));
      expect(report.test_location).toBe('tests/Feature/Agents/MigrationReviewer');
    },
    180_000,
  );
});
