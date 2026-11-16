import { mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';

import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  abandonReview,
  finishReview,
  findingReview,
  gapReview,
  resumeReview,
  stageReview,
  startReview,
} from '@/review-runs/actions.js';
import { ReviewRefusal } from '@/review-runs/errors.js';
import {
  commitReviewRun,
  readReviewRun,
  readReviewView,
  reviewLockPath,
} from '@/review-runs/store.js';
import { reviewShown } from '@/review-runs/view.js';

import { DESIGN, SECURITY, at, clockAt, tempRoot } from './fixtures.js';

describe('review run actions', () => {
  let root: string;

  beforeEach(() => {
    root = tempRoot();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function revision(): number {
    return readReviewRun(root, SECURITY)!.revision;
  }

  it('AC-2: start writes run.json at revision 1 and a journey-shaped view.json', () => {
    startReview(root, SECURITY, { now: clockAt(0) });
    const run = JSON.parse(readFileSync(join(root, '.paqad/reviews/security/run.json'), 'utf8'));
    expect(run.revision).toBe(1);
    const view = readReviewView(root, SECURITY)!;
    expect(view.word).toBe('Security review');
    expect(view.stages).toHaveLength(8);
    expect(view.stages.every((stage) => stage.state === 'todo')).toBe(true);
    expect(view.headline.text).toBe('Security review has not started');
    expect(view.updated_at).toBe(at(0));
    expect(view.resume_prompt).toBe('continue paqad security review');
  });

  it('AC-3: back-to-back writers both land and each raises the revision by one', async () => {
    startReview(root, SECURITY, { now: clockAt(0) });
    await Promise.all([
      Promise.resolve().then(() =>
        findingReview(root, SECURITY, { severity: 'high', proof: 'confirmed' }),
      ),
      Promise.resolve().then(() =>
        findingReview(root, SECURITY, { severity: 'low', proof: 'lead' }),
      ),
    ]);
    const run = readReviewRun(root, SECURITY)!;
    expect(run.revision).toBe(3);
    expect(run.findings).toHaveLength(2);
  });

  it('AC-3: a held lock makes the verb refuse in one line, and a stale lock is reclaimed', () => {
    startReview(root, SECURITY, { now: clockAt(0) });
    const lock = reviewLockPath(root, SECURITY);
    mkdirSync(lock, { recursive: true });
    const slept: number[] = [];
    expect(() =>
      stageReview(root, SECURITY, 'scope', 'start', {
        attempts: 2,
        sleep: (ms) => void slept.push(ms),
      }),
    ).toThrow(/Another security-review command is updating the run/u);
    expect(slept).toEqual([10]);
    expect(revision()).toBe(1);
    const old = new Date(Date.now() - 60_000);
    utimesSync(lock, old, old);
    stageReview(root, SECURITY, 'scope', 'start', { attempts: 1 });
    expect(revision()).toBe(2);
    mkdirSync(lock, { recursive: true });
    stageReview(root, SECURITY, 'scope', 'done', {
      attempts: 1,
      lockNow: () => Date.now() + 120_000,
    });
    expect(revision()).toBe(3);
  });

  it('AC-3: an expected revision that moved refuses without writing', () => {
    startReview(root, SECURITY, { now: clockAt(0) });
    expect(() => commitReviewRun(root, SECURITY, (run) => run!, { expectedRevision: 7 })).toThrow(
      /expected revision 7, found 1/u,
    );
    expect(revision()).toBe(1);
  });

  it('AC-4: each refusal leaves the revision unchanged', () => {
    expect(() => findingReview(root, SECURITY, { severity: 'high', proof: 'confirmed' })).toThrow(
      ReviewRefusal,
    );
    expect(() => resumeReview(root, SECURITY)).toThrow(/No security review to resume/u);
    startReview(root, SECURITY, { now: clockAt(0) });
    const refusals: Array<() => unknown> = [
      () => startReview(root, SECURITY),
      () => stageReview(root, SECURITY, 'nope', 'start'),
      () => stageReview(root, SECURITY, 'scope', 'done'),
      () => findingReview(root, SECURITY, { severity: 'huge', proof: 'confirmed' }),
      () => findingReview(root, SECURITY, { severity: 'high', proof: 'maybe' }),
      () => gapReview(root, SECURITY, { code: 'x', stage: undefined, say: 'words' }),
      () => gapReview(root, SECURITY, { code: 'x', stage: 'scope', say: undefined }),
      () => gapReview(root, SECURITY, { code: 'x', stage: 'nope', say: 'words' }),
      () => resumeReview(root, SECURITY),
    ];
    for (const refuse of refusals) {
      expect(refuse).toThrow(ReviewRefusal);
      expect(revision()).toBe(1);
    }
    const runId = readReviewRun(root, SECURITY)!.run_id;
    finishReview(root, SECURITY, { now: clockAt(1) });
    const after = revision();
    for (const refuse of [
      () => stageReview(root, SECURITY, 'scope', 'start'),
      () => findingReview(root, SECURITY, { severity: 'high', proof: 'confirmed' }),
      () => finishReview(root, SECURITY),
      () => abandonReview(root, SECURITY),
      () => resumeReview(root, SECURITY),
    ]) {
      expect(refuse).toThrow(ReviewRefusal);
      expect(revision()).toBe(after);
    }
    const next = startReview(root, SECURITY, { now: clockAt(2) });
    expect(next.revision).toBe(1);
    expect(next.run_id).not.toBe(runId);
  });

  it('FR-6: start refuses while a run is open or stopped and keeps its run id', () => {
    const first = startReview(root, SECURITY, { now: clockAt(0) });
    gapReview(root, SECURITY, { code: 'x', stage: 'scope', say: 'w', stop: true });
    expect(() => startReview(root, SECURITY)).toThrow(/already open/u);
    expect(readReviewRun(root, SECURITY)!.run_id).toBe(first.run_id);
  });

  it('EC-10: an unreadable run.json makes every verb refuse with one line', () => {
    mkdirSync(join(root, '.paqad/reviews/security'), { recursive: true });
    writeFileSync(join(root, '.paqad/reviews/security/run.json'), '{oops');
    expect(() => stageReview(root, SECURITY, 'scope', 'start')).toThrow(/unreadable/u);
    expect(() => startReview(root, SECURITY)).toThrow(/unreadable/u);
  });

  it('AC-12: finish turns every never-run or still-running stage into a not-run gap', () => {
    startReview(root, SECURITY, { now: clockAt(0) });
    for (const id of ['scope', 'map', 'scan', 'threats', 'hunt']) {
      stageReview(root, SECURITY, id, 'start');
      stageReview(root, SECURITY, id, 'done');
    }
    stageReview(root, SECURITY, 'confirm', 'start');
    finishReview(root, SECURITY, { now: clockAt(5) });
    const run = readReviewRun(root, SECURITY)!;
    expect(run.status).toBe('finished');
    expect(run.gaps.map((gap) => [gap.code, gap.stage])).toEqual([
      ['not-run', 'confirm'],
      ['not-run', 'sweep'],
      ['not-run', 'report'],
    ]);
    expect(readReviewView(root, SECURITY)!.headline.text).toBe('Done with 3 gaps');
  });

  function allButScopeDone(): void {
    for (const stage of SECURITY.stages.slice(1)) {
      stageReview(root, SECURITY, stage.id, 'start');
      stageReview(root, SECURITY, stage.id, 'done');
    }
  }

  it('AC-12: a gap on a running stage keeps it running, done ends it, finish counts 1 gap', () => {
    startReview(root, SECURITY, { now: clockAt(0) });
    stageReview(root, SECURITY, 'scope', 'start');
    gapReview(root, SECURITY, { code: 'thin-scope', stage: 'scope', say: 'no target list' });
    expect(readReviewRun(root, SECURITY)!.stages['scope']!.status).toBe('running');
    stageReview(root, SECURITY, 'scope', 'done');
    allButScopeDone();
    finishReview(root, SECURITY, { now: clockAt(5) });
    const run = readReviewRun(root, SECURITY)!;
    expect(run.gaps.map((gap) => [gap.code, gap.stage])).toEqual([['thin-scope', 'scope']]);
    const view = readReviewView(root, SECURITY)!;
    expect(view.headline.text).toBe('Done with 1 gap');
    expect(view.stages.find((stage) => stage.id === 'scope')!.state).toBe('gap');
  });

  it('AC-12: a gap on a running stage then skip leaves exactly 1 gap', () => {
    startReview(root, SECURITY, { now: clockAt(0) });
    stageReview(root, SECURITY, 'scope', 'start');
    gapReview(root, SECURITY, { code: 'thin-scope', stage: 'scope', say: 'no target list' });
    stageReview(root, SECURITY, 'scope', 'skip');
    allButScopeDone();
    finishReview(root, SECURITY, { now: clockAt(5) });
    expect(readReviewRun(root, SECURITY)!.gaps).toHaveLength(1);
    expect(readReviewView(root, SECURITY)!.headline.text).toBe('Done with 1 gap');
  });

  it('AC-12: a running stage left open with its own gap gets no second not-run gap at finish', () => {
    startReview(root, SECURITY, { now: clockAt(0) });
    allButScopeDone();
    stageReview(root, SECURITY, 'scope', 'start');
    gapReview(root, SECURITY, { code: 'thin-scope', stage: 'scope', say: 'no target list' });
    finishReview(root, SECURITY, { now: clockAt(5) });
    const run = readReviewRun(root, SECURITY)!;
    expect(run.gaps.map((gap) => [gap.code, gap.stage])).toEqual([['thin-scope', 'scope']]);
    expect(run.stages['scope']!.status).toBe('gap');
    expect(run.stages['scope']!.ended_at).not.toBeNull();
    expect(readReviewView(root, SECURITY)!.headline.text).toBe('Done with 1 gap');
  });

  it('AC-12: a gap on a stage never started keeps it as the only gap at finish', () => {
    startReview(root, SECURITY, { now: clockAt(0) });
    gapReview(root, SECURITY, { code: 'no-access', stage: 'scope', say: 'no repo access' });
    expect(readReviewRun(root, SECURITY)!.stages['scope']!.status).toBe('gap');
    allButScopeDone();
    finishReview(root, SECURITY, { now: clockAt(5) });
    expect(readReviewRun(root, SECURITY)!.gaps).toHaveLength(1);
  });

  it('AC-13: resuming a design review after the docs exist drops the missing-design-docs gap', () => {
    startReview(root, DESIGN, { now: clockAt(0) });
    stageReview(root, DESIGN, 'scope', 'start');
    gapReview(root, DESIGN, {
      code: 'missing-design-docs',
      stage: 'scope',
      say: 'No design system yet',
      stop: true,
    });
    expect(readReviewView(root, DESIGN)!.headline.text).toBe(
      'Stopped at stage 1 · Check the design system · Resume to continue',
    );
    resumeReview(root, DESIGN);
    expect(readReviewRun(root, DESIGN)!.gaps).toHaveLength(1);
    gapReview(root, DESIGN, {
      code: 'missing-design-docs',
      stage: 'scope',
      say: 'still none',
      stop: true,
    });
    mkdirSync(join(root, 'docs/instructions/design-system'), { recursive: true });
    writeFileSync(join(root, 'docs/instructions/design-system/tokens.md'), '# Tokens\n');
    resumeReview(root, DESIGN);
    const resumed = readReviewRun(root, DESIGN)!;
    expect(resumed.gaps).toEqual([]);
    expect(resumed.stages.scope!.status).toBe('running');
    for (const stage of DESIGN.stages) {
      if (stage.id !== 'scope') stageReview(root, DESIGN, stage.id, 'start');
      stageReview(root, DESIGN, stage.id, 'done');
    }
    finishReview(root, DESIGN, { now: clockAt(9) });
    expect(readReviewView(root, DESIGN)!.headline.text).toBe('No finding confirmed');
  });

  it('AC-14: resume reopens the run at the stage it stopped at', () => {
    startReview(root, SECURITY, { now: clockAt(0) });
    for (const id of ['scope', 'map', 'scan', 'threats']) {
      stageReview(root, SECURITY, id, 'start');
      stageReview(root, SECURITY, id, 'done');
    }
    gapReview(root, SECURITY, { code: 'blocked', stage: 'hunt', say: 'target down', stop: true });
    expect(readReviewView(root, SECURITY)!.headline.text).toMatch(/^Stopped at stage 5 · /u);
    resumeReview(root, SECURITY);
    const view = readReviewView(root, SECURITY)!;
    expect(view.status).toBe('between');
    expect(view.headline.text).toBe('Next: stage 5 of 8 · Hunt for weaknesses');
    stageReview(root, SECURITY, 'hunt', 'start');
    gapReview(root, SECURITY, { code: 'blocked', stage: 'hunt', say: 'again', stop: true });
    resumeReview(root, SECURITY);
    expect(readReviewView(root, SECURITY)!.headline.text).toBe(
      'Stage 5 of 8 · Hunting for weaknesses',
    );
  });

  it('AC-15: abandon shows the stopped row with Resume, never a finished row, then hides', () => {
    startReview(root, SECURITY, { now: clockAt(0) });
    stageReview(root, SECURITY, 'scope', 'start', { now: clockAt(1) });
    abandonReview(root, SECURITY, { now: clockAt(2) });
    const view = readReviewView(root, SECURITY)!;
    expect(readReviewRun(root, SECURITY)!.status).toBe('abandoned');
    expect(view.headline.row).toBe('R3');
    expect(view.headline.text).toBe('Stopped at stage 1 · Set the scope · Resume to continue');
    expect(view.button).toBe('Resume');
    expect(reviewShown(view, Date.parse(at(31)))).toBe(true);
    expect(reviewShown(view, Date.parse(at(32)))).toBe(false);
    resumeReview(root, SECURITY, { now: clockAt(3) });
    expect(readReviewView(root, SECURITY)!.status).toBe('running');
  });

  it('FR-7: skip marks a stage that is not done and refuses a done one', () => {
    startReview(root, SECURITY, { now: clockAt(0) });
    stageReview(root, SECURITY, 'scan', 'skip');
    expect(readReviewView(root, SECURITY)!.stages[2]!.state).toBe('skipped');
    stageReview(root, SECURITY, 'scope', 'start');
    stageReview(root, SECURITY, 'scope', 'done');
    expect(() => stageReview(root, SECURITY, 'scope', 'skip')).toThrow(/already done/u);
  });
});
