import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import YAML from 'yaml';
import { afterAll, describe, expect, it } from 'vitest';

import { runDraft } from '@/authoring/stages/draft.js';
import { runEvalPlan, runEvalRecord, type PlannedRun } from '@/authoring/stages/eval.js';
import { runIntake } from '@/authoring/stages/intake.js';
import { runJustify } from '@/authoring/stages/justify.js';
import { runRelease } from '@/authoring/stages/release.js';
import { runEvidence } from '@/authoring/stages/sources.js';
import { defaultTestRunner, runSkillTest } from '@/authoring/stages/test.js';
import { runTriggerPlan, runTriggerRecord } from '@/authoring/stages/trigger.js';
import { SkillWorkspace } from '@/authoring/workspace.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import { resolveSessionId } from '@/rag-ledger/session.js';
import { bundleCompletenessGate } from '@/verification/repository/bundle-completeness-gate.js';

const REPO = resolve(import.meta.dirname, '../..');
const FIXTURES = join(REPO, 'tests/fixtures/authoring');
const NAME = 'processing-invoices';
const SKILL_LINE =
  'The skill processing-invoices changed but never went through its checks. Run paqad-ai skill status processing-invoices.';
const VITEST = join(REPO, 'node_modules/vitest/vitest.mjs');
const LARAVEL = join(FIXTURES, 'laravel-project');
const PHP = spawnSync('php', ['--version'], { encoding: 'utf8' });
const LARAVEL_READY = PHP.status === 0 && existsSync(join(LARAVEL, 'vendor/autoload.php'));
const LARAVEL_SKIP_REASON =
  PHP.status !== 0
    ? 'php is not installed, so the Laravel half of the skill e2e is skipped'
    : 'tests/fixtures/authoring/laravel-project/vendor is missing (run composer install there), so the Laravel half is skipped';

const created: string[] = [];

afterAll(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

function copyProject(fixture: string): string {
  const root = join(REPO, '.paqad/tmp', `e2e-skill-${fixture}-${process.pid}-${created.length}`);
  rmSync(root, { recursive: true, force: true });
  cpSync(join(FIXTURES, fixture), root, { recursive: true });
  created.push(root);
  if (existsSync(join(root, '.env.example'))) cpSync(join(root, '.env.example'), join(root, '.env'));
  mkdirSync(join(root, '.paqad'), { recursive: true });
  writeFileSync(
    join(root, '.paqad/onboarding-manifest.json'),
    JSON.stringify({ adapter: 'claude-code' }),
  );
  writeFileSync(
    join(root, '.paqad/.config'),
    'model_fast=fast-m\nmodel_reasoning=strong-m\nauthoring_runs_per_arm=1\n',
  );
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

const INTAKE = [
  'purpose: "Turn a supplier invoice into one ledger line"',
  'triggers: ["a supplier invoice arrives", "book a supplier invoice"]',
  'output_format: "ledger JSON"',
  'verifiability: objective',
  'skill_class: workflow',
  'scope: { in: ["supplier invoices"], out: ["payroll"] }',
  'dependencies: ["none"]',
].join('\n');

const SOURCES = [
  '| S-ID | Fact | Origin | Date | Verified |',
  '| --- | --- | --- | --- | --- |',
  '| S-1 | Payables take one line per invoice | docs/ledger.md:12 | 2026-10-31 | yes |',
].join('\n');

const TRACE = [
  '| Block | Lines | S-IDs |',
  '| --- | --- | --- |',
  '| Processing invoices | 5-8 | S-1 |',
  '',
  '## Unsourced',
  '',
  '- Gotchas (lines 10-12): model-knowledge: credit notes carry a negative total',
].join('\n');

function throughDraft(root: string): SkillWorkspace {
  const workspace = new SkillWorkspace(root, NAME);
  for (const run of [1, 2, 3]) workspace.write(`baseline/run-${run}.md`, `run ${run}\n`);
  workspace.writeJson('baseline/verdicts.json', [
    { run: 1, passed: false, note: 'wrong account' },
    { run: 2, passed: true, note: 'ok' },
    { run: 3, passed: false, note: 'no supplier' },
  ]);
  expect(runJustify(workspace).ok).toBe(true);
  expect(runIntake(workspace, INTAKE).ok).toBe(true);
  expect(runEvidence(workspace, { sourcesText: SOURCES, userHome: null }).ok).toBe(true);
  const draft = runDraft(workspace, { dir: join(root, 'skill'), traceText: TRACE });
  expect(draft.ok).toBe(true);
  return workspace;
}

async function throughEvalsAndTrigger(workspace: SkillWorkspace): Promise<void> {
  workspace.write('evals/happy/prompt.md', 'Book this invoice.\n');
  workspace.write('evals/edge/prompt.md', 'Book this credit note.\n');
  workspace.write('evals/edge/case.yaml', 'edge: true\n');
  runEvalPlan(workspace, { probe: () => null });
  const runs = JSON.parse(
    readFileSync(workspace.path('iteration-1/runs.json'), 'utf8'),
  ) as PlannedRun[];
  for (const run of runs) {
    const base = run.workdir.replace(`${workspace.rel}/`, '');
    workspace.write(`${base}/outputs/line.json`, '{}');
    workspace.writeJson(`${base}/grading.json`, {
      expectations: [{ text: 'books one payables line', passed: run.arm === 'with_skill' }],
    });
    workspace.writeJson(`${base}/timing.json`, {
      model: run.model,
      duration_ms: 1000,
      tokens: 1000,
    });
  }
  expect((await runEvalRecord(workspace)).ok).toBe(true);
  const queries = Array.from({ length: 20 }, (_, index) => ({
    query: `q${index}`,
    should_trigger: index < 10,
  }));
  runTriggerPlan(workspace, JSON.stringify(queries));
  const description =
    'Turns a supplier invoice into one ledger line. Use when a supplier invoice arrives and needs booking.';
  const results = queries.flatMap((query, index) =>
    [1, 2, 3].map((run) => ({
      id: `q-${String(index + 1).padStart(2, '0')}`,
      run,
      fired: query.should_trigger,
    })),
  );
  const trigger = runTriggerRecord(
    workspace,
    JSON.stringify({ iterations: [{ description, results }] }),
    { userHome: null },
  );
  expect(trigger.ok).toBe(true);
}

function skillGateDetail(root: string, dirName: string): string {
  const gate = bundleCompletenessGate({
    projectRoot: root,
    sessionId: 'ses-e2e',
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
    changedFiles: [`.claude/skills/${NAME}/SKILL.md`],
  });
  return gate?.detail ?? '';
}

describe('skill orchestrator e2e: npm project with Vitest', () => {
  it('AC-25, AC-29, AC-30: S4 runs the Vitest contract tests, release registers the skill, and a broken script fails the normal test run', async () => {
    const root = copyProject('npm-project');
    const command = `node "${VITEST}" run --config vitest.config.mjs`;
    profile(root, command);
    const sessionId = resolveSessionId(root, 'ses-e2e');
    const dirName = openFeatureChange(root, sessionId, {
      adapter: 'claude-code',
      title: 'add invoice skill',
      lane: 'graduated',
    });

    const workspace = throughDraft(root);
    mkdirSync(join(root, `tests/skills/${NAME}`), { recursive: true });
    cpSync(
      join(root, 'skill-tests/extract.test.ts.fixture'),
      join(root, `tests/skills/${NAME}/extract.test.ts`),
    );
    expect(() => runEvalPlan(workspace, { probe: () => null })).toThrow("S5 evals can't start");
    const s4 = await runSkillTest(workspace);
    expect(s4.lines.at(-1)).toContain('S4 passed');
    const report = JSON.parse(readFileSync(workspace.path('script-tests.json'), 'utf8'));
    expect(
      report.scripts[0].checks.every((check: { status: string }) => check.status === 'passed'),
    ).toBe(true);

    await throughEvalsAndTrigger(workspace);
    mkdirSync(join(root, `.claude/skills/${NAME}`), { recursive: true });
    writeFileSync(join(root, `.claude/skills/${NAME}/SKILL.md`), 'placeholder\n');
    expect(skillGateDetail(root, dirName)).toContain(SKILL_LINE);
    rmSync(join(root, `.claude/skills/${NAME}`), { recursive: true });

    runRelease(workspace, { sessionId });
    expect(skillGateDetail(root, dirName)).not.toContain(SKILL_LINE);

    const normal = await defaultTestRunner(command, root);
    expect(normal.exitCode).toBe(0);
    const script = join(root, `.claude/skills/${NAME}/scripts/extract.ts`);
    writeFileSync(
      script,
      readFileSync(script, 'utf8').replace("account: 'payables'", "account: 'broken'"),
    );
    const broken = await defaultTestRunner(command, root);
    expect(broken.exitCode).not.toBe(0);
  }, 120_000);
});

describe('skill orchestrator e2e: Laravel project with Pest', () => {
  it.skipIf(!LARAVEL_READY)(
    `AC-25: S4 runs the Pest contract tests under php artisan test${LARAVEL_READY ? '' : ` (skipped: ${LARAVEL_SKIP_REASON})`}`,
    async () => {
      const root = copyProject('laravel-project');
      profile(root, 'php artisan test');
      const workspace = throughDraft(root);
      const testDir = join(root, 'tests/Feature/Skills/ProcessingInvoices');
      mkdirSync(testDir, { recursive: true });
      cpSync(join(root, 'skill-tests/ExtractTest.php.fixture'), join(testDir, 'ExtractTest.php'));
      expect(() => runEvalPlan(workspace, { probe: () => null })).toThrow(
        "S5 evals can't start",
      );
      const s4 = await runSkillTest(workspace);
      expect(s4.lines.at(-1)).toContain('S4 passed');
      const report = JSON.parse(readFileSync(workspace.path('script-tests.json'), 'utf8'));
      expect(report.test_location).toBe('tests/Feature/Skills/ProcessingInvoices');
    },
    120_000,
  );
});
