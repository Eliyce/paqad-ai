import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

import { dirname, join } from 'pathe';
import { expect, vi } from 'vitest';

import { createChecksCommand } from '@/cli/commands/checks.js';
import { createPlanCommand } from '@/cli/commands/plan.js';
import { createReviewCommand } from '@/cli/commands/review.js';
import { createRulesCommand } from '@/cli/commands/rules.js';
import { createSpecCommand } from '@/cli/commands/spec.js';
import { createStageCommand } from '@/cli/commands/stage.js';
import { PATHS } from '@/core/constants/paths.js';
import { featureDir, featureFilePath } from '@/feature-evidence/paths.js';
import { appendFeatureStageRow, currentFeature } from '@/feature-evidence/stage-ledger.js';
import { STAGE_AGENT_KIND } from '@/stage-evidence/types.js';
import { writeWorkflowState } from '@/pipeline/workflow-state.js';
import { openRagConversation } from '@/rag-ledger/recorder.js';
import { writePendingLane } from '@/stage-evidence/pending-lane.js';
import {
  emptyRuleScriptMap,
  ruleScriptMapPath,
  serializeRuleScriptMap,
} from '@/rule-scripts/map.js';
import { runRuleScripts } from '@/rule-scripts/runner.js';
import { runRepositoryVerification } from '@/verification/repository/run-repository-verification.js';
import { writeVisualEvidenceManifest } from '@/visual-evidence/manifest.js';

import { createVerificationContext } from '../verification/shared.fixture.js';
import { seedGitChangedFiles } from '../pipeline/changed-files.fixture.js';
import { withSpecPipelineOff } from '../../shared/spec-pipeline-off.js';

export type OracleCase = 'M0' | 'M1' | 'M2' | 'M3' | 'M4' | 'M5';

export const ORACLE_CASES: readonly OracleCase[] = ['M0', 'M1', 'M2', 'M3', 'M4', 'M5'];

const M2_CONFIG = ['spec_pipeline_enabled=true'];
const M3_CONFIG = [...M2_CONFIG, 'spec_pipeline_experts_enabled=true'];

export const CASE_CONFIG: Readonly<Record<OracleCase, readonly string[]>> = {
  M0: [
    'rule_compliance=off',
    'duplication_mode=off',
    'metrics_enabled=false',
    'feature_report=false',
  ],
  M1: [],
  M2: M2_CONFIG,
  M3: M3_CONFIG,
  M4: [
    ...M3_CONFIG,
    'rag_enabled=true',
    'visual_evidence=true',
    'enterprise=true',
    'enterprise_evidence_ledger=true',
    'enterprise_ai_bom=true',
  ],
  M5: ['spec_pipeline_experts_enabled=true'],
};

const M0_FILES = [
  'feature.json',
  'plan.json',
  'spec.md',
  'specification.json',
  'review.json',
  'stage-evidence.jsonl',
  'rules-loaded.json',
  'delivery.json',
  'evidence.jsonl',
];
const M1_FILES = [
  ...M0_FILES,
  'rule-run.jsonl',
  'duplication.jsonl',
  'change-metrics.jsonl',
  'report.html',
];
const M2_FILES = [...M1_FILES, 'request.md', 'clarification.json'];
const M3_FILES = [...M2_FILES, 'experts.json', 'high-table.jsonl'];

export const CASE_FILES: Readonly<Record<OracleCase, readonly string[]>> = {
  M0: M0_FILES,
  M1: M1_FILES,
  M2: M2_FILES,
  M3: M3_FILES,
  M4: [...M3_FILES, 'rag.jsonl', 'visual-evidence.json', 'receipt.json', 'ai-bom.json'],
  M5: M1_FILES,
};

export const CHANGE_DEPENDENT_FILES: readonly string[] = ['checks.json'];

export const RUN_SESSION = 'ses_bundle_run';
export const RUN_TITLE = 'PROJ-123 Checkout page cleanup';
export const EXPERT_FINDING = 'EX-ux-ui-analyst-1';

const SPEC = [
  '# Checkout page cleanup',
  '',
  '## Functional requirements',
  '- FR-1: The checkout page shows the order total once.',
  '',
  '## Acceptance criteria',
  '- AC-1: given a cart, when checkout opens, then the total shows once. (proof: automated)',
  '',
  '## Invariants',
  '- INV-1: The order total is never shown twice.',
  '',
].join('\n');

export interface BundleRun {
  root: string;
  dir: string;
  steps: string[];
  caseId: OracleCase;
}

export interface BundleRunOptions {
  untitled?: boolean;
  afterStep?: (root: string, step: string) => void;
  beforeVerification?: (root: string, dir: string) => void;
}

function flagOn(caseId: OracleCase, line: string): boolean {
  return CASE_CONFIG[caseId].includes(line);
}

export function pipelineOn(caseId: OracleCase): boolean {
  return flagOn(caseId, 'spec_pipeline_enabled=true');
}

export function expertsRan(caseId: OracleCase): boolean {
  return pipelineOn(caseId) && flagOn(caseId, 'spec_pipeline_experts_enabled=true');
}

type CliFactory = () => {
  parseAsync: (argv: string[], options: { from: 'user' }) => Promise<unknown>;
};

export async function runBundleFixture(
  caseId: OracleCase,
  options: BundleRunOptions = {},
): Promise<BundleRun> {
  const frontend = caseId === 'M4';
  const sourceFile = frontend ? 'src/components/CheckoutTotal.tsx' : 'src/checkout/total.ts';
  const context = createVerificationContext({
    verification_origin: 'hook-completion',
    verification_stage: 'backstop-completion',
    changed_files: [sourceFile],
    changed_files_source: 'git',
    code_changed: true,
  });
  const root = context.project_root;
  const steps: string[] = [];

  mkdirSync(join(root, '.paqad', 'tmp'), { recursive: true });
  writeFileSync(
    join(root, '.paqad', 'project-profile.yaml'),
    [
      'project:',
      '  name: demo',
      'active_capabilities:',
      '  - content',
      'commands:',
      '  test: node -e process.exitCode=0',
      '',
    ].join('\n'),
  );
  mkdirSync(join(root, '.paqad', 'configs'), { recursive: true });
  writeFileSync(
    join(root, '.paqad', 'configs', '.config.app'),
    `${withSpecPipelineOff(CASE_CONFIG[caseId]).join('\n')}\n`,
    'utf8',
  );
  writeFileSync(
    join(root, PATHS.COMPILED_RULES),
    JSON.stringify({
      schema_version: 1,
      generated_at: 'now',
      source_hash: 'sha256:x',
      rules: [
        {
          rule_id: 'RULE-1',
          title: 'Constitution',
          source_path: 'docs/instructions/rules/constitution.md',
          trigger_patterns: ['**'],
          severity: 'must',
          summary: 'Always applies.',
          raw_text: '# Constitution body',
        },
      ],
    }),
  );
  mkdirSync(dirname(ruleScriptMapPath(root)), { recursive: true });
  writeFileSync(ruleScriptMapPath(root), serializeRuleScriptMap(emptyRuleScriptMap()), 'utf8');

  const afterStep = (step: string): void => {
    steps.push(step);
    expect(existsSync(join(root, '.paqad', '_specs')), `.paqad/_specs after ${step}`).toBe(false);
    options.afterStep?.(root, step);
  };

  const cli = async (factory: CliFactory, args: string[], withSession = true): Promise<void> => {
    const err: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation((line?: unknown) => {
      err.push(String(line));
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await factory().parseAsync(
        [...args, '--project-root', root, ...(withSession ? ['--session', RUN_SESSION] : [])],
        { from: 'user' },
      );
    } finally {
      log.mockRestore();
      error.mockRestore();
      warn.mockRestore();
    }
    expect(process.exitCode ?? 0, `${args.join(' ')} failed: ${err.join('\n')}`).toBe(0);
    process.exitCode = undefined;
    afterStep(args.slice(0, 3).join(' '));
  };

  const tmpInput = (name: string, value: unknown): string => {
    const path = join(root, '.paqad', 'tmp', name);
    writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value), 'utf8');
    return path;
  };

  const dirNow = (): string => currentFeature(root, RUN_SESSION)!;
  const artifact = (file: 'plan' | 'specification' | 'review'): string =>
    join(root, featureFilePath(dirNow(), file));

  const previousSession = process.env.SE_SESSION;
  process.env.SE_SESSION = RUN_SESSION;
  try {
    writePendingLane(root, RUN_SESSION, pipelineOn(caseId) ? 'full' : 'fast');
    await cli(
      createStageCommand,
      options.untitled ? ['start', 'planning'] : ['start', 'planning', '--title', RUN_TITLE],
    );
    writeWorkflowState(root, RUN_SESSION, {
      active: { workflow: 'feature-development' },
      paused: [],
    });
    if (flagOn(caseId, 'rag_enabled=true')) {
      openRagConversation(root, {
        sessionId: RUN_SESSION,
        ragEnabled: true,
        adapter: 'claude-code',
      });
      afterStep('rag open');
    }

    if (pipelineOn(caseId)) {
      const pipeline = (...args: string[]): Promise<void> =>
        cli(createSpecCommand, ['pipeline', ...args]);
      await pipeline(
        'start',
        '--request-file',
        tmpInput('request.md', 'Show the checkout total once.'),
      );
      if (expertsRan(caseId)) {
        await pipeline(
          'experts',
          'record',
          tmpInput('need.json', {
            experts: [{ role: 'ux-ui-analyst', reason: 'the checkout page layout changes' }],
          }),
        );
        await pipeline('experts', 'brief', 'ux-ui-analyst');
        await pipeline(
          'experts',
          'notes',
          tmpInput('notes.json', {
            notes: [
              {
                role: 'ux-ui-analyst',
                findings: [{ target: 'checkout total', claim: 'show the total once' }],
              },
            ],
            tokens: { 'ux-ui-analyst': 800 },
          }),
        );
        await pipeline(
          'experts',
          'synthesis',
          tmpInput('synthesis.json', {
            verdict: 'ready',
            accepted: [EXPERT_FINDING],
            declined: [],
            conflicts: [],
            gaps: [],
            questions: [],
            tokens: 200,
          }),
        );
      }
      await pipeline('record', 'questions', tmpInput('questions.json', { questions: [] }));
      await pipeline('record', 'task', tmpInput('task.json', { intent: 'show the total once' }));
      const source = expertsRan(caseId) ? EXPERT_FINDING : 'ticket:request';
      await pipeline(
        'record',
        'craft',
        tmpInput('spec.md', SPEC),
        '--trace',
        tmpInput('trace.json', {
          entries: [
            { id: 'FR-1', source },
            { id: 'AC-1', source: 'ticket:acceptance' },
            { id: 'INV-1', source },
          ],
        }),
      );
      await pipeline('finish');
    }

    await cli(createPlanCommand, [
      'compile',
      tmpInput('plan.json', {
        summary: 'Show the checkout total once',
        ...(options.untitled ? { title: RUN_TITLE } : {}),
        steps: [{ id: 's1', description: 'dedupe the total', files: [sourceFile] }],
        reuse: {
          consulted: [{ source: 'grep', query: 'total', hits: 0 }],
          reusing: [],
          new_constructs: [],
        },
      }),
    ]);
    await cli(createStageCommand, ['end', 'planning', '--artifact', artifact('plan')]);

    await cli(createStageCommand, ['start', 'specification']);
    await cli(createSpecCommand, [
      'freeze',
      tmpInput('spec.md', SPEC),
      ...(pipelineOn(caseId) ? ['--from-pipeline'] : []),
      '--signed-off-by',
      'tester',
      '--confirm-invariants',
    ]);
    await cli(createStageCommand, [
      'end',
      'specification',
      '--artifact',
      artifact('specification'),
    ]);

    await cli(createStageCommand, ['start', 'development']);
    await cli(createRulesCommand, ['load', '--silent']);
    mkdirSync(dirname(join(root, sourceFile)), { recursive: true });
    writeFileSync(
      join(root, sourceFile),
      frontend
        ? 'export function CheckoutTotal({ total }: { total: string }) {\n  return <p>{total}</p>;\n}\n'
        : 'export function checkoutTotal(total: number): string {\n  return total.toFixed(2);\n}\n',
      'utf8',
    );
    seedGitChangedFiles(root, [sourceFile]);
    afterStep('source edit');
    await cli(createStageCommand, ['end', 'development']);
    if (flagOn(caseId, 'visual_evidence=true')) {
      writeVisualEvidenceManifest(root, dirNow(), {
        trigger: { changed_files: [sourceFile], matched_globs: ['src/**/*.tsx'], packs: ['react'] },
        plan: [],
        steps: [],
        gif: null,
        skips: [{ reason: 'no-documented-flow', detail: `no journey anchors ${sourceFile}` }],
        result: 'skipped',
        now: () => new Date().toISOString(),
        sessionId: RUN_SESSION,
      });
      afterStep('visual-evidence capture');
    }

    await cli(createStageCommand, ['start', 'review']);
    await cli(createReviewCommand, [
      'record',
      tmpInput('review.json', {
        summary: 'Checked correctness, regressions and rollback risk.',
        verdict: 'safe-to-merge',
        findings: [],
        checked: ['correctness', 'regressions'],
        rollback: 'Revert the commit.',
      }),
    ]);
    await cli(createStageCommand, ['end', 'review', '--artifact', artifact('review')]);

    await cli(createStageCommand, ['start', 'checks']);
    await cli(createChecksCommand, ['run', '--silent'], false);
    await cli(createStageCommand, ['end', 'checks']);

    await cli(createStageCommand, ['start', 'documentation_sync']);
    await cli(createStageCommand, ['end', 'documentation_sync']);

    if (!flagOn(caseId, 'rule_compliance=off')) {
      runRuleScripts({ projectRoot: root, mode: 'warn', changedFiles: [sourceFile] });
      afterStep('rule-scripts run');
    }
    const dir = dirNow();
    if (pipelineOn(caseId)) {
      appendFeatureStageRow(root, RUN_SESSION, dir, {
        kind: STAGE_AGENT_KIND,
        stage: 'development',
        agent: 'paqad-development',
        tokens_used: 0,
        tokens_not_recarried: 0,
        estimate: true,
      });
    }
    options.beforeVerification?.(root, dir);
    await runRepositoryVerification({
      projectRoot: root,
      origin: 'hook-completion',
      prebuiltContext: { context, escalations: [] },
      hostSessionId: RUN_SESSION,
    });
    afterStep('repository verification');

    return { root, dir, steps, caseId };
  } finally {
    if (previousSession === undefined) delete process.env.SE_SESSION;
    else process.env.SE_SESSION = previousSession;
    process.exitCode = undefined;
  }
}

export function bundlePath(run: BundleRun): string {
  return join(run.root, featureDir(run.dir));
}
