import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { triggerRefresh } from '@/background/worker-harness.js';
import { PATHS } from '@/core/constants/paths.js';
import { describeOptionalEngine } from '@/core/optional-package.js';
import { getPackageRoot } from '@/core/runtime-paths.js';
import { writeFileAtomic } from '@/hud/files.js';
import { loadRuleScriptMap } from '@/rule-scripts/map.js';
import { readProposal } from '@/rules-discovery/proposal.js';
import { listRunIds } from '@/rules-discovery/run-store.js';

import { endStage, type Clock } from './actions.js';
import { readChoices } from './choices.js';
import { DEGRADED } from './degraded.js';
import { JourneyRefusal } from './errors.js';
import { SETTINGS_LOCAL } from './permissions.js';
import { fileSha256 } from './preflight.js';
import { requireRun, updateRun } from './run-store.js';
import { ONBOARDING_STAGES } from './stages.js';
import type { JourneyRun } from './types.js';

export type RagOutcome = 'ready' | 'installing' | 'off';

export interface FinishDeps {
  rag: (projectRoot: string) => RagOutcome;
}

export function rebuildRagInBackground(projectRoot: string): RagOutcome {
  const engine = describeOptionalEngine(process.env).state;
  if (engine !== 'ready') return engine === 'installing' ? 'installing' : 'off';
  triggerRefresh({
    jobId: 'onboarding-rag-rebuild',
    lockDir: join(projectRoot, PATHS.LOCKS_DIR, 'onboarding-rag.lock'),
    markerPath: join(projectRoot, PATHS.LOCKS_DIR, 'onboarding-rag.marker'),
    debounceMs: 0,
    staleLockMs: 30 * 60 * 1000,
    worker: {
      modulePath: join(getPackageRoot(), 'dist/cli/index.js'),
      args: ['rag', 'rebuild', '--yes', '--project-root', projectRoot],
    },
  });
  return 'ready';
}

export interface FinishReport {
  generated_at: string;
  run_id: string;
  providers: string[];
  rag: RagOutcome;
  steps: Array<{
    step: string;
    status: string;
    gaps: Array<{ code: string; footnote: string; next_action: string }>;
  }>;
  choices: { total: number; unreviewed: number };
  written: string[];
  existing_pages_kept: string[];
  rule_changes_for_review: Array<{ row_id: string; change: string; text: string }>;
  new_rule_checks: string[];
  allow_list: string | null;
}

function listMarkdown(root: string, rel: string): string[] {
  try {
    return readdirSync(join(root, rel), { withFileTypes: true }).flatMap((entry) => {
      const child = `${rel}/${entry.name}`;
      if (entry.isDirectory()) return listMarkdown(root, child);
      return entry.isFile() && entry.name.endsWith('.md') ? [child] : [];
    });
  } catch {
    return [];
  }
}

export function existingPagesKept(projectRoot: string, run: JourneyRun): string[] {
  return listMarkdown(projectRoot, 'docs')
    .filter(
      (path) =>
        !path.startsWith('docs/modules/') &&
        (run.written[path] === undefined || run.docs_baseline?.[path] !== undefined),
    )
    .sort();
}

function ruleChangesForReview(projectRoot: string): FinishReport['rule_changes_for_review'] {
  const runs = listRunIds(projectRoot);
  const latest = runs[runs.length - 1];
  const proposal = latest ? readProposal(projectRoot, latest) : null;
  return (proposal?.rows ?? [])
    .filter((row) => row.change === 'changed' || row.change === 'removed')
    .map((row) => ({ row_id: row.row_id, change: row.change, text: row.text }));
}

function newRuleChecks(projectRoot: string, run: JourneyRun): string[] {
  const flagged = new Set(run.rule_checks_flagged ?? []);
  return (loadRuleScriptMap(projectRoot)?.rules ?? [])
    .filter((rule) => flagged.has(rule.id))
    .flatMap((rule) => rule.scripts.map((script) => script.path))
    .sort();
}

export function buildReport(
  projectRoot: string,
  run: JourneyRun,
  rag: RagOutcome,
  now: Date,
): FinishReport {
  const choices = readChoices(projectRoot);
  return {
    generated_at: now.toISOString(),
    run_id: run.run_id,
    providers: run.providers,
    rag,
    steps: ONBOARDING_STAGES.map((stage) => ({
      step: stage.name,
      status:
        stage.id === 'finish' ? (rag === 'off' ? 'degraded' : 'done') : run.stages[stage.id].status,
      gaps: [
        ...(run.stages[stage.id].degraded ?? []),
        ...(stage.id === 'finish' && rag === 'off' ? (['rag_off'] as const) : []),
      ].map((code) => ({
        code,
        footnote: DEGRADED[code].footnote,
        next_action: DEGRADED[code].next_action,
      })),
    })),
    choices: { total: choices.length, unreviewed: choices.filter((row) => !row.reviewed).length },
    written: Object.keys(run.written).sort(),
    existing_pages_kept: existingPagesKept(projectRoot, run),
    rule_changes_for_review: ruleChangesForReview(projectRoot),
    new_rule_checks: newRuleChecks(projectRoot, run),
    allow_list: run.allow_list
      ? `The allow list stays in ${SETTINGS_LOCAL}; remove the entries listed in choices.jsonl to undo it.`
      : null,
  };
}

function section(title: string, items: readonly string[]): string[] {
  return items.length === 0 ? [] : ['', `## ${title}`, '', ...items.map((item) => `- ${item}`)];
}

export function renderReportMarkdown(report: FinishReport): string {
  const gaps = report.steps.flatMap((step) =>
    step.gaps.map((gap) => `${step.step}: ${gap.footnote} ${gap.next_action}`),
  );
  return [
    '# paqad onboarding report',
    '',
    `Finished ${report.generated_at} for ${report.providers.join(', ')}.`,
    '',
    ...report.steps.map((step) => `- ${step.step}: ${step.status}`),
    ...section('Gaps', gaps),
    ...section('Existing pages kept as they are (review them)', report.existing_pages_kept),
    ...section(
      'Rule changes listed for review, not applied',
      report.rule_changes_for_review.map((row) => `${row.row_id} (${row.change}): ${row.text}`),
    ),
    ...section('New rule checks to review (they only warn until reviewed)', report.new_rule_checks),
    ...section('Choices', [
      `${report.choices.total} automatic choices, ${report.choices.unreviewed} not yet reviewed: run \`paqad-ai onboarding choices\`.`,
    ]),
    ...section('Allow list', report.allow_list ? [report.allow_list] : []),
    '',
  ].join('\n');
}

export function finishJourney(projectRoot: string, deps: FinishDeps, now: Clock): FinishReport {
  const run = requireRun(projectRoot);
  if (run.stages.finish.status !== 'running') {
    throw new JourneyRefusal('Start step 8 first: `paqad-ai onboarding stage start finish`.');
  }
  const rag = deps.rag(projectRoot);
  const report = buildReport(projectRoot, run, rag, now());
  const jsonPath = join(projectRoot, PATHS.ONBOARDING_REPORT_JSON);
  const mdPath = join(projectRoot, PATHS.ONBOARDING_REPORT_MD);
  writeFileAtomic(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileAtomic(mdPath, renderReportMarkdown(report));
  updateRun(
    projectRoot,
    (draft) => {
      for (const [rel, abs] of [
        [PATHS.ONBOARDING_REPORT_JSON, jsonPath],
        [PATHS.ONBOARDING_REPORT_MD, mdPath],
      ] as const) {
        const hash = fileSha256(abs);
        if (hash) draft.written[rel] = hash;
      }
    },
    { now },
  );
  endStage(projectRoot, 'finish', rag === 'off' ? ['rag_off'] : [], now);
  return report;
}
