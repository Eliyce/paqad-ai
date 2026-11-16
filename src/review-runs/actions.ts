import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { join } from 'pathe';

import { PATHS } from '@/core/constants/paths.js';

import { ReviewRefusal } from './errors.js';
import { REVIEW_KINDS, reviewStage, type ReviewKind, type ReviewKindId } from './kinds.js';
import { commitReviewRun, readReviewRun, type ReviewWriteOptions } from './store.js';
import {
  OPEN_STATUSES,
  PROOFS,
  SEVERITIES,
  type Proof,
  type ReviewRun,
  type ReviewStageRecord,
  type Severity,
} from './types.js';

export const NOT_RUN_GAP = 'not-run';
export const MISSING_DESIGN_DOCS_GAP = 'missing-design-docs';
export const DESIGN_CONTRACT_FILES = [
  'tokens.md',
  'components.md',
  'accessibility.md',
  'motion.md',
  'patterns.md',
  'responsive.md',
] as const;

export type StageVerb = 'start' | 'done' | 'skip';

export function reviewKind(id: ReviewKindId): ReviewKind {
  return REVIEW_KINDS[id];
}

function emptyStages(kind: ReviewKind): Record<string, ReviewStageRecord> {
  return Object.fromEntries(
    kind.stages.map((stage) => [stage.id, { status: 'todo', started_at: null, ended_at: null }]),
  );
}

function requireOpen(kind: ReviewKind, run: ReviewRun | null): ReviewRun {
  if (run === null) {
    throw new ReviewRefusal(
      `No ${kind.word.toLowerCase()} is open. Run \`paqad-ai ${kind.verb} start\` first.`,
    );
  }
  if (!OPEN_STATUSES.has(run.status)) {
    throw new ReviewRefusal(
      `The ${kind.word.toLowerCase()} is ${run.status}; start a new one first.`,
    );
  }
  return run;
}

function requireStage(kind: ReviewKind, id: string | undefined): string {
  if (!id) throw new ReviewRefusal('Name the stage with --stage <id>.');
  const stage = reviewStage(kind, id);
  if (stage === null) {
    throw new ReviewRefusal(
      `Unknown stage "${id}". The ${kind.word.toLowerCase()} stages are ${kind.stages.map((s) => s.id).join(', ')}.`,
    );
  }
  return stage.id;
}

export function startReview(
  projectRoot: string,
  kind: ReviewKind,
  options: ReviewWriteOptions = {},
): ReviewRun {
  return commitReviewRun(
    projectRoot,
    kind,
    (current, at) => {
      if (current !== null && OPEN_STATUSES.has(current.status)) {
        throw new ReviewRefusal(
          `A ${kind.word.toLowerCase()} is already open (${current.run_id}). Resume it, finish it or abandon it first.`,
        );
      }
      return {
        schema_version: 1,
        kind: kind.id,
        run_id: `${kind.id}-${randomUUID()}`,
        revision: 0,
        status: 'running',
        started_at: at,
        updated_at: at,
        finished_at: null,
        current_stage: null,
        stopped: null,
        stages: emptyStages(kind),
        findings: [],
        gaps: [],
      };
    },
    options,
  );
}

export function stageReview(
  projectRoot: string,
  kind: ReviewKind,
  stageId: string,
  verb: StageVerb,
  options: ReviewWriteOptions = {},
): ReviewRun {
  return commitReviewRun(
    projectRoot,
    kind,
    (current, at) => {
      const run = requireOpen(kind, current);
      const id = requireStage(kind, stageId);
      const record = run.stages[id]!;
      if (verb === 'start') {
        run.stages[id] = { status: 'running', started_at: at, ended_at: null };
        run.current_stage = id;
        run.status = 'running';
        run.stopped = null;
      } else if (verb === 'done') {
        if (record.status !== 'running') {
          throw new ReviewRefusal(`Stage ${id} is not running; run \`stage ${id} start\` first.`);
        }
        run.stages[id] = { ...record, status: 'done', ended_at: at };
      } else {
        if (record.status === 'done') throw new ReviewRefusal(`Stage ${id} is already done.`);
        run.stages[id] = { ...record, status: 'skipped', ended_at: at };
      }
      return run;
    },
    options,
  );
}

export function parseSeverity(value: string | undefined): Severity {
  if (!SEVERITIES.includes(value as Severity)) {
    throw new ReviewRefusal(`--severity must be one of ${SEVERITIES.join(', ')}.`);
  }
  return value as Severity;
}

export function parseProof(value: string | undefined): Proof {
  if (!PROOFS.includes(value as Proof)) {
    throw new ReviewRefusal(`--proof must be one of ${PROOFS.join(', ')}.`);
  }
  return value as Proof;
}

export function findingReview(
  projectRoot: string,
  kind: ReviewKind,
  input: { severity: string | undefined; proof: string | undefined; id?: string | null },
  options: ReviewWriteOptions = {},
): ReviewRun {
  const severity = parseSeverity(input.severity);
  const proof = parseProof(input.proof);
  return commitReviewRun(
    projectRoot,
    kind,
    (current, at) => {
      const run = requireOpen(kind, current);
      run.findings.push({ severity, proof, id: input.id ?? null, at });
      return run;
    },
    options,
  );
}

export function gapReview(
  projectRoot: string,
  kind: ReviewKind,
  input: { code: string; stage: string | undefined; say: string | undefined; stop?: boolean },
  options: ReviewWriteOptions = {},
): ReviewRun {
  if (!input.code.trim()) throw new ReviewRefusal('Name the gap code.');
  if (!input.say?.trim()) throw new ReviewRefusal('Say what the gap is with --say <words>.');
  const stageId = requireStage(kind, input.stage);
  const say = input.say.trim();
  return commitReviewRun(
    projectRoot,
    kind,
    (current, at) => {
      const run = requireOpen(kind, current);
      const record = run.stages[stageId]!;
      const wasRunning = record.status === 'running';
      run.gaps.push({ code: input.code.trim(), stage: stageId, say, at });
      run.stages[stageId] = { ...record, status: 'gap' };
      if (input.stop) {
        run.status = 'stopped';
        run.current_stage = stageId;
        run.stopped = { stage: stageId, was_running: wasRunning };
      }
      return run;
    },
    options,
  );
}

export function finishReview(
  projectRoot: string,
  kind: ReviewKind,
  options: ReviewWriteOptions = {},
): ReviewRun {
  return commitReviewRun(
    projectRoot,
    kind,
    (current, at) => {
      const run = requireOpen(kind, current);
      for (const stage of kind.stages) {
        const record = run.stages[stage.id]!;
        if (record.status === 'done' || record.status === 'skipped') continue;
        run.gaps.push({
          code: NOT_RUN_GAP,
          stage: stage.id,
          say: `${stage.label} did not run to the end`,
          at,
        });
        run.stages[stage.id] = { ...record, status: 'gap', ended_at: record.ended_at ?? at };
      }
      run.status = 'finished';
      run.finished_at = at;
      run.stopped = null;
      return run;
    },
    options,
  );
}

export function abandonReview(
  projectRoot: string,
  kind: ReviewKind,
  options: ReviewWriteOptions = {},
): ReviewRun {
  return commitReviewRun(
    projectRoot,
    kind,
    (current, at) => {
      const run = requireOpen(kind, current);
      if (run.stopped === null && run.current_stage !== null) {
        run.stopped = {
          stage: run.current_stage,
          was_running: run.stages[run.current_stage]?.status === 'running',
        };
      }
      run.status = 'abandoned';
      run.finished_at = at;
      return run;
    },
    options,
  );
}

export function designDocsReady(projectRoot: string): boolean {
  return DESIGN_CONTRACT_FILES.some((file) => {
    try {
      return readFileSync(join(projectRoot, PATHS.DESIGN_SYSTEM_DIR, file), 'utf8').trim() !== '';
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw new ReviewRefusal(`Could not read the design-system doc ${file}.`, { cause: error });
    }
  });
}

export function resumeReview(
  projectRoot: string,
  kind: ReviewKind,
  options: ReviewWriteOptions = {},
): ReviewRun {
  const docsReady = kind.id === 'design' && designDocsReady(projectRoot);
  return commitReviewRun(
    projectRoot,
    kind,
    (current) => {
      if (current === null) {
        throw new ReviewRefusal(
          `No ${kind.word.toLowerCase()} to resume. Run \`paqad-ai ${kind.verb} start\`.`,
        );
      }
      if (current.status !== 'stopped' && current.status !== 'abandoned') {
        throw new ReviewRefusal(
          `The ${kind.word.toLowerCase()} is ${current.status}; there is nothing to resume.`,
        );
      }
      const run = current;
      const stopped = run.stopped;
      if (docsReady) {
        run.gaps = run.gaps.filter(
          (gap) => !(gap.code === MISSING_DESIGN_DOCS_GAP && gap.stage === 'scope'),
        );
      }
      if (stopped !== null) {
        const record = run.stages[stopped.stage]!;
        const stillGap = run.gaps.some((gap) => gap.stage === stopped.stage);
        run.stages[stopped.stage] = stopped.was_running
          ? { ...record, status: 'running' }
          : {
              ...record,
              status: stillGap ? 'gap' : record.status === 'gap' ? 'todo' : record.status,
            };
        run.current_stage = stopped.stage;
      }
      run.status = 'running';
      run.finished_at = null;
      run.stopped = null;
      return run;
    },
    options,
  );
}

export function reviewStatus(projectRoot: string, kind: ReviewKind): ReviewRun | null {
  return readReviewRun(projectRoot, kind);
}
