import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createPendingDecision } from '@/decisions/authoring.js';
import { updateFeatureRecord } from '@/feature-evidence/feature-record.js';
import { featureChangeKey } from '@/feature-evidence/paths.js';
import { closeActiveFeature } from '@/feature-evidence/stage-ledger.js';
import {
  gateIsJudged,
  GATE_JUDGED_AFTER,
  latestEditAt,
  qualifyHudChange,
  stageEndTimes,
} from '@/hud/change-scope.js';
import { hudVerdictPath } from '@/hud/files.js';
import { buildHudSnapshot } from '@/hud/snapshot.js';

import {
  checkout,
  cleanupScopeFixtures,
  git,
  initGit,
  later,
  logTurns,
  openChangeHere,
  plainRoot,
  repoRoot,
  runStage,
  setRoute,
  startOnly,
  writeGateRows,
  writeVerdict,
} from './scope-fixtures.js';

afterEach(cleanupScopeFixtures);

const S = 'ses-scope';
const PAST = '2020-01-01T00:00:00.000Z';

describe('qualifyHudChange', () => {
  it('qualifies the active change on its branch, on the feature route, with a row this episode', () => {
    const root = repoRoot();
    checkout(root, 'feat/a', true);
    const dir = openChangeHere(root, S);
    logTurns(root, S, [{ at: PAST, workflow: 'feature-development' }]);
    runStage(root, S, 'planning');
    expect(qualifyHudChange(root, S)).toEqual({ dir, reason: 'qualified' });
  });

  it('reads not-feature-route on any other route, even with an open change', () => {
    const root = repoRoot();
    openChangeHere(root, S);
    runStage(root, S, 'planning');
    setRoute(root, S, 'project-question');
    expect(qualifyHudChange(root, S)).toEqual({ dir: null, reason: 'not-feature-route' });
  });

  it('reads no-active-change when the session has no change', () => {
    const root = repoRoot();
    setRoute(root, S, 'feature-development');
    expect(qualifyHudChange(root, S)).toEqual({ dir: null, reason: 'no-active-change' });
  });

  it('reads closed for a change whose record says done or abandoned', () => {
    const root = repoRoot();
    const dir = openChangeHere(root, S);
    runStage(root, S, 'planning');
    updateFeatureRecord(root, dir, { status: 'done' });
    expect(qualifyHudChange(root, S).reason).toBe('closed');
  });

  it('reads no-active-change once the change is closed and released', () => {
    const root = repoRoot();
    openChangeHere(root, S);
    runStage(root, S, 'planning');
    closeActiveFeature(root, S);
    expect(qualifyHudChange(root, S).dir).toBeNull();
  });

  it('reads other-branch for a change recorded on another branch (AC-2)', () => {
    const root = repoRoot();
    checkout(root, 'feat/a', true);
    openChangeHere(root, S);
    runStage(root, S, 'planning');
    checkout(root, 'feat/b', true);
    const snapshot = buildHudSnapshot(root, S);
    expect(snapshot.scope).toEqual({ qualified: false, reason: 'other-branch' });
    expect(snapshot.change).toBeNull();
  });

  it('never qualifies on a detached HEAD', () => {
    const root = repoRoot();
    openChangeHere(root, S);
    runStage(root, S, 'planning');
    git(root, 'checkout', '-q', '--detach');
    expect(qualifyHudChange(root, S).reason).toBe('other-branch');
  });

  it('a change with no recorded branch qualifies only while HEAD is attached', () => {
    const root = plainRoot();
    const dir = openChangeHere(root, S);
    runStage(root, S, 'planning');
    initGit(root);
    expect(qualifyHudChange(root, S)).toEqual({ dir, reason: 'qualified' });
    git(root, 'checkout', '-q', '--detach');
    expect(qualifyHudChange(root, S).reason).toBe('other-branch');
  });

  it('a row by another session does not qualify', () => {
    const root = repoRoot();
    openChangeHere(root, S);
    runStage(root, 'ses-other', 'planning');
    logTurns(root, S, [{ at: later().toISOString(), workflow: 'feature-development' }]);
    expect(qualifyHudChange(root, S).reason).toBe('no-row-this-episode');
  });

  it('a row recorded before the episode started does not qualify', () => {
    const root = repoRoot();
    openChangeHere(root, S);
    runStage(root, S, 'planning');
    logTurns(root, S, [
      { at: PAST, workflow: 'feature-development' },
      { at: later(1000).toISOString(), workflow: 'project-question' },
      { at: later(2000).toISOString(), workflow: 'feature-development' },
    ]);
    expect(qualifyHudChange(root, S).reason).toBe('no-row-this-episode');
  });

  it('falls back to turn_started_at when there is no route-turn log', () => {
    const root = repoRoot();
    openChangeHere(root, S);
    runStage(root, S, 'planning');
    setRoute(root, S, 'feature-development', later().toISOString());
    expect(qualifyHudChange(root, S).reason).toBe('no-row-this-episode');
    setRoute(root, S, 'feature-development', PAST);
    expect(qualifyHudChange(root, S).reason).toBe('qualified');
  });

  it('a stage this session started and never ended qualifies across a continue', () => {
    const root = repoRoot();
    const dir = openChangeHere(root, S);
    startOnly(root, S, 'development');
    logTurns(root, S, [{ at: later().toISOString(), workflow: 'feature-development' }]);
    expect(qualifyHudChange(root, S)).toEqual({ dir, reason: 'qualified' });
  });

  it('goes from idle to the card on the first row and back to idle on a branch switch (AC-29)', () => {
    const root = repoRoot();
    checkout(root, 'feat/a', true);
    openChangeHere(root, S, 'ORD-1 scoped change', 'full', new Date(PAST));
    logTurns(root, S, [{ at: later(-1000).toISOString(), workflow: 'feature-development' }]);
    expect(buildHudSnapshot(root, S).active).toBe(false);
    runStage(root, S, 'planning');
    expect(buildHudSnapshot(root, S).active).toBe(true);
    checkout(root, 'main');
    expect(buildHudSnapshot(root, S).active).toBe(false);
  });
});

describe('an unqualified snapshot carries no change story', () => {
  it('a question-only session over an old unclosed change shows nothing of it (AC-1)', () => {
    const root = repoRoot();
    const dir = openChangeHere(root, S);
    runStage(root, S, 'development');
    writeVerdict(root, S, 'pass', later());
    createPendingDecision(root, {
      category: 'ux-pattern',
      title: 'Which layout?',
      context: 'c',
      options: [
        { option_key: 'a', label: 'A' },
        { option_key: 'b', label: 'B' },
      ],
      change: featureChangeKey(dir),
    });
    setRoute(root, S, 'project-question');

    const snapshot = buildHudSnapshot(root, S);

    expect(snapshot).toMatchObject({
      scope: { qualified: false, reason: 'not-feature-route' },
      active: false,
      change: null,
      stages: [],
      table: null,
      gates: [],
      claims: [],
      flags: [],
      ship: null,
      verdict: null,
      receipt: null,
      cost: null,
      decisions: { pending: [] },
    });
    expect(snapshot.headline.text).not.toContain('Safe to merge');
  });
});

describe('verdict freshness', () => {
  function qualifiedWithEdit(): { root: string; dir: string } {
    const root = repoRoot();
    const dir = openChangeHere(root, S);
    runStage(root, S, 'development');
    return { root, dir };
  }

  it('hides a verdict written before the latest edit (AC-4)', () => {
    const { root } = qualifiedWithEdit();
    writeVerdict(root, S, 'pass', new Date(PAST));
    const snapshot = buildHudSnapshot(root, S);
    expect(snapshot.verdict).toBeNull();
    expect(snapshot.headline.text).not.toContain('Safe to merge');
  });

  it('shows a verdict written exactly at the latest edit and hides one a millisecond earlier (AC-5)', () => {
    const { root, dir } = qualifiedWithEdit();
    const editedAt = latestEditAt(root, dir)!;
    writeVerdict(root, S, 'pass', new Date(editedAt));
    expect(buildHudSnapshot(root, S).verdict).toMatchObject({ kind: 'pass', change: dir });
    writeVerdict(root, S, 'pass', new Date(editedAt - 1));
    const stale = buildHudSnapshot(root, S);
    expect(stale.verdict).toBeNull();
    expect(stale.headline.text).not.toContain('Safe to merge');
  });

  it('hides a verdict of another change and a legacy verdict without a change (AC-5)', () => {
    const { root } = qualifiedWithEdit();
    writeVerdict(root, S, 'pass', later());
    const path = hudVerdictPath(root, S);
    const record = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    const write = (body: Record<string, unknown>) =>
      writeFileSync(path, `${JSON.stringify(body, null, 2)}\n`);
    write({ ...record, change: 'another-change-dir' });
    expect(buildHudSnapshot(root, S).verdict).toBeNull();
    const legacy = { ...record };
    delete legacy.change;
    write(legacy);
    expect(buildHudSnapshot(root, S).verdict).toBeNull();
    write({ ...record, written_at: 'never' });
    expect(buildHudSnapshot(root, S).verdict).toBeNull();
  });

  it('shows a verdict when the change has no edit row yet', () => {
    const root = repoRoot();
    openChangeHere(root, S);
    runStage(root, S, 'planning');
    writeVerdict(root, S, 'inconclusive', new Date(PAST));
    expect(buildHudSnapshot(root, S).verdict).toMatchObject({ kind: 'inconclusive' });
  });
});

describe('gates are judged only after their stage ended (AC-16)', () => {
  it('reads not-judged with no stage_end and raises no flag from it', () => {
    const root = repoRoot();
    const dir = openChangeHere(root, S);
    startOnly(root, S, 'development');
    writeGateRows(root, dir, [
      { code: 'spec-review', verdict: 'pass', at: later().toISOString() },
      { code: 'implementation-review', verdict: 'inconclusive', at: later().toISOString() },
      { code: 'code-tests-lint', verdict: 'pass', at: later().toISOString() },
    ]);
    const snapshot = buildHudSnapshot(root, S);
    expect(snapshot.gates.map((gate) => gate.verdict)).toEqual([
      'not-judged',
      'not-judged',
      'not-judged',
    ]);
    expect(snapshot.flags.some((flag) => flag.id.startsWith('gate:'))).toBe(false);
  });

  it('a gate row before its stage ended reads not-judged, after it counts', () => {
    const root = repoRoot();
    const dir = openChangeHere(root, S);
    runStage(root, S, 'specification');
    writeGateRows(root, dir, [
      { code: 'spec-review', verdict: 'pass', at: PAST },
      { code: 'story-quality', verdict: 'fail', at: later().toISOString() },
    ]);
    expect(buildHudSnapshot(root, S).gates.map((gate) => gate.verdict)).toEqual([
      'not-judged',
      'fail',
    ]);
  });

  it('an unknown gate code counts only after checks ended', () => {
    const root = repoRoot();
    const dir = openChangeHere(root, S);
    runStage(root, S, 'review');
    writeGateRows(root, dir, [
      { code: 'made-up-gate', verdict: 'pass', at: later().toISOString() },
    ]);
    expect(buildHudSnapshot(root, S).gates[0]!.verdict).toBe('not-judged');
    runStage(root, S, 'checks');
    expect(gateIsJudged('made-up-gate', later().toISOString(), stageEndTimes(root, dir))).toBe(
      true,
    );
  });

  it('maps every gate the design names to its owning stage', () => {
    expect(GATE_JUDGED_AFTER['spec-review']).toBe('specification');
    expect(GATE_JUDGED_AFTER['fix-proof']).toBe('development');
    expect(GATE_JUDGED_AFTER['implementation-review']).toBe('review');
    expect(GATE_JUDGED_AFTER['ac-test-mapping']).toBe('checks');
    expect(GATE_JUDGED_AFTER['site-map-freshness']).toBe('documentation_sync');
    expect(Object.keys(GATE_JUDGED_AFTER)).toHaveLength(19);
    expect(gateIsJudged('spec-review', 'not a time', new Map([['specification', 0]]))).toBe(false);
  });
});

describe('decisions belong to this change only (AC-21)', () => {
  it('keeps only packets stamped with this change', () => {
    const root = repoRoot();
    const dir = openChangeHere(root, S);
    runStage(root, S, 'planning');
    const options = [
      { option_key: 'a', label: 'A' },
      { option_key: 'b', label: 'B' },
    ];
    const mine = createPendingDecision(root, {
      category: 'ux-pattern',
      title: 'Mine',
      context: 'c',
      options,
      change: featureChangeKey(dir),
    });
    createPendingDecision(root, {
      category: 'ux-pattern',
      title: 'Theirs',
      context: 'c',
      options,
      change: '01OTHERCHANGE000000000000',
    });
    createPendingDecision(root, {
      category: 'ux-pattern',
      title: 'Unstamped',
      context: 'c',
      options,
    });
    expect(buildHudSnapshot(root, S).decisions.pending.map((packet) => packet.id)).toEqual([
      mine.id,
    ]);
  });
});

describe('the HUD reads saved files only (AC-49)', () => {
  it('neither the snapshot builder nor the mod imports a child-process or network module or calls gh', () => {
    const sources = [
      ...readdirSync('src/hud').map((name) => join('src/hud', name)),
      ...readdirSync('runtime/claude-plugin/mod')
        .filter((name) => /\.(ts|tsx)$/.test(name) && !name.endsWith('.test.ts'))
        .map((name) => join('runtime/claude-plugin/mod', name)),
    ].filter((path) => /\.(ts|tsx)$/.test(path));
    expect(sources.length).toBeGreaterThan(10);
    const forbidden = /child_process|node:https?['"]|node:net['"]|\bfetch\(|['"]gh['"]|undici/;
    expect(sources.filter((path) => forbidden.test(readFileSync(path, 'utf8')))).toEqual([]);
  });
});
