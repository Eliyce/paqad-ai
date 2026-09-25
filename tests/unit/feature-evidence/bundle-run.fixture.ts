// Issue #581 (AC-1, AC-2) — one in-process fixture run of a whole feature-development change,
// driven verb by verb the way an agent drives it: open the change, plan compile, the spec
// pipeline where it is on, spec freeze, rules load, a source edit, review record, checks run,
// and the end-of-turn repository verification. Every step goes through the real CLI verb or
// the real writer the host would call, and after each one the run checks that the retired
// `.paqad/_specs/` folder does not exist (AC-2, after every verb, not only at the end).
//
// The oracle below is the issue's "Expected file set per config" table. `checks.json` is left
// out of the table's counts because it depends on what the change did; this run always
// performs `checks run`, so it is always present and the harness adds it to every case.

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
import { currentFeature } from '@/feature-evidence/stage-ledger.js';
import { writeWorkflowState } from '@/pipeline/workflow-state.js';
import { openRagConversation } from '@/rag-ledger/recorder.js';
import {
  emptyRuleScriptMap,
  ruleScriptMapPath,
  serializeRuleScriptMap,
} from '@/rule-scripts/map.js';
import { runRuleScripts } from '@/rule-scripts/runner.js';
import { runRepositoryVerification } from '@/verification/repository/run-repository-verification.js';
import { writeVisualEvidenceManifest } from '@/visual-evidence/manifest.js';

import { createVerificationContext } from '../verification/shared.fixture.js';

export type OracleCase = 'M0' | 'M1' | 'M2' | 'M3' | 'M4' | 'M5';

export const ORACLE_CASES: readonly OracleCase[] = ['M0', 'M1', 'M2', 'M3', 'M4', 'M5'];

const M2_CONFIG = ['spec_pipeline_enabled=true'];
const M3_CONFIG = [...M2_CONFIG, 'spec_pipeline_experts_enabled=true'];

/** The `.paqad/.config` lines for each case, from the issue's oracle table. */
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
const M3_FILES = [...M2_FILES, 'experts.json'];

/** The exact oracle set per case (the issue's table, without the change-dependent files). */
export const CASE_FILES: Readonly<Record<OracleCase, readonly string[]>> = {
  M0: M0_FILES,
  M1: M1_FILES,
  M2: M2_FILES,
  M3: M3_FILES,
  M4: [...M3_FILES, 'rag.jsonl', 'visual-evidence.json', 'receipt.json', 'ai-bom.json'],
  M5: M1_FILES,
};

/** The change-dependent file this run always produces (it always runs `checks run`). */
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
  /** The bundle folder name at the end of the run. */
  dir: string;
  /** Every step the run performed, in order (each one was followed by the AC-2 check). */
  steps: string[];
  caseId: OracleCase;
}

export interface BundleRunOptions {
  /**
   * Open the change with a bare `stage start planning` (a `change-<ULID>` bundle) and let
   * `plan compile` name it from the template title, as AC-17 describes.
   */
  untitled?: boolean;
  /** Called with the bundle folder name after every step, for checks beyond AC-2. */
  afterStep?: (root: string, step: string) => void;
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

/**
 * Drive one whole change for `caseId` in a fresh temp project and return where it landed.
 * Fails the calling test on any verb that exits non-zero, and on `.paqad/_specs/` appearing
 * after any single step.
 */
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
    changed_files_source: 'git-status',
    code_changed: true,
  });
  const root = context.project_root;
  const steps: string[] = [];

  // Project setup: a lean profile with one passing test command (the `.config` overlay needs a
  // profile to apply onto), the case's
  // flags, one compiled rule so `rules load` has something to record, and an empty
  // rule-script map so the rule-scripts runner records its run.
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
  // The case's flags go in the team file: the enforced mode knobs (rule_compliance,
  // duplication_mode) take the team value as a floor that the local file can only raise.
  mkdirSync(join(root, '.paqad', 'configs'), { recursive: true });
  writeFileSync(
    join(root, '.paqad', 'configs', '.config.app'),
    `${CASE_CONFIG[caseId].join('\n')}\n`,
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

  /** Run one CLI verb in-process and fail the test when it exits non-zero. */
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

  /** Hand an input to a verb the way an agent does: a file under `.paqad/tmp/`. */
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
    // 1. Open the change.
    await cli(
      createStageCommand,
      options.untitled ? ['start', 'planning'] : ['start', 'planning', '--title', RUN_TITLE],
    );
    writeWorkflowState(root, RUN_SESSION, {
      active: { workflow: 'feature-development' },
      paused: [],
    });
    if (flagOn(caseId, 'rag_enabled=true')) {
      // The prompt seam opens the RAG conversation for the turn.
      openRagConversation(root, {
        sessionId: RUN_SESSION,
        ragEnabled: true,
        adapter: 'claude-code',
      });
      afterStep('rag open');
    }

    // 2. The spec pipeline, where it is on. It runs before plan compile, so an untitled
    //    change already has pipeline state when the plan names the bundle (AC-17).
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

    // 3. Plan compile (it names an untitled bundle from the template title).
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

    // 4. Spec freeze.
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

    // 5. Rules load, then the source edit.
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
    // The edit hook records the changed file for the verbs that read change evidence.
    mkdirSync(join(root, '.paqad', 'session'), { recursive: true });
    writeFileSync(
      join(root, '.paqad', 'session', 'changed-files.json'),
      JSON.stringify([sourceFile]),
    );
    afterStep('source edit');
    await cli(createStageCommand, ['end', 'development']);
    if (flagOn(caseId, 'visual_evidence=true')) {
      // The capture runner, stubbed: it writes a valid manifest for a flow it could not find.
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

    // 6. Review record.
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

    // 7. Checks run (the verb takes its session from SE_SESSION).
    await cli(createStageCommand, ['start', 'checks']);
    await cli(createChecksCommand, ['run', '--silent'], false);
    await cli(createStageCommand, ['end', 'checks']);

    // 8. The turn-end seams: the rule-scripts runner, then repository verification.
    if (!flagOn(caseId, 'rule_compliance=off')) {
      runRuleScripts({ projectRoot: root, mode: 'warn', changedFiles: [sourceFile] });
      afterStep('rule-scripts run');
    }
    await runRepositoryVerification({
      projectRoot: root,
      origin: 'hook-completion',
      prebuiltContext: { context, escalations: [] },
      hostSessionId: RUN_SESSION,
    });
    afterStep('repository verification');

    return { root, dir: dirNow(), steps, caseId };
  } finally {
    if (previousSession === undefined) delete process.env.SE_SESSION;
    else process.env.SE_SESSION = previousSession;
    process.exitCode = undefined;
  }
}

/** The bundle folder's absolute path. */
export function bundlePath(run: BundleRun): string {
  return join(run.root, featureDir(run.dir));
}
