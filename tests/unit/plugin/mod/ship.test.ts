import { IDLE_LIVE } from '../../../../runtime/claude-plugin/mod/live.ts';
import { describe, expect, it } from 'vitest';

import { allGreenKey, bandHeadline } from '../../../../runtime/claude-plugin/mod/band.ts';
import { buildBandView, parseSnapshot } from '../../../../runtime/claude-plugin/mod/model.ts';
import { railAlt, shipRail, shipRailSvg } from '../../../../runtime/claude-plugin/mod/ship.ts';
import {
  EVERYTHING_GREEN,
  MERGE_IS_YOURS,
  NOTHING_PUSHED,
  ON_THE_BRANCH,
  linesText,
  readAgo,
  shipsLines,
} from '../../../../runtime/claude-plugin/mod/tabs.ts';
import {
  FAST_ORD_490,
  FULL_ORD_501,
  NOW,
  PAUSED,
  fileText,
  stages,
} from '../../../../runtime/claude-plugin/mod/test/fixtures.ts';
import type { PaqadHudSnapshot } from '../../../../runtime/claude-plugin/mod/types/index.d.ts';

import { ticketRef } from '../../../shared/ticket-ref.js';

import { bandOf, blockLines, blockOf } from './band-text.ts';

type Raw = Record<string, unknown>;
const parse = (raw: Raw): PaqadHudSnapshot => parseSnapshot(fileText(raw))!;

const OWN_PR = { number: 12, url: 'https://example.test/pull/12', draft: false, head_sha: 'aaa' };
const ci = (state: string, done: number, total: number, extra: Raw = {}) => ({
  sha: 'aaa',
  state,
  done,
  total,
  reason: null,
  source: 'stop-check',
  at: '2026-10-18T08:59:00.000Z',
  ...extra,
});

function shipping(ship: Raw, stageStates: Record<string, string> = { development: 'complete' }) {
  return {
    ...FULL_ORD_501,
    stages: stages(stageStates),
    ship: {
      commits: 2,
      commit_decision: null,
      merge_commit: null,
      push: { state: 'pushed', branch: 'feat/x', sha: 'aaa' },
      pr: OWN_PR,
      ci: null,
      own: null,
      inherited: null,
      commit_list: [
        { sha: 'aaa1111', subject: 'feat: one', own: true },
        { sha: 'bbb2222', subject: 'feat: two', own: true },
        { sha: 'ccc3333', subject: 'chore: older', own: false },
      ],
      inherited_count: 1,
      pr_state: 'open',
      ci_read_at: '2026-10-18T08:59:00.000Z',
      all_green: false,
      merged: false,
      ...ship,
    },
  };
}

const states = (raw: Raw) => shipRail(parse(raw)).steps.map((s) => `${s.label} ${s.state}`);

describe('the ship rail (FR-15, FR-35)', () => {
  it('is faint with no status before the first edit', () => {
    const rail = shipRail(parse({ ...FULL_ORD_501, stages: stages({}), ship: null }));
    expect(rail.status).toBeNull();
    expect(rail.steps.every((step) => step.state === 'todo')).toBe(true);
    expect(shipRail(null).status).toBeNull();
    expect(shipRail(parse(PAUSED)).steps[0]!.state).toBe('todo');
  });

  it('reads the Edit step from the build stage', () => {
    expect(shipRail(parse(FAST_ORD_490)).steps[0]).toEqual({ label: 'Edit', state: 'current' });
    expect(shipRail(parse(FAST_ORD_490)).status).toBe('editing');
    const edited = parse({ ...FULL_ORD_501, ship: null });
    expect(shipRail(edited).status).toBe('edited');
  });

  it('keeps Edit current while a file is being edited or any edit stage runs', () => {
    const editStep = (over: Raw, live = IDLE_LIVE) =>
      shipRail(parse({ ...FAST_ORD_490, ...over }), live).steps[0]!.state;
    const buildDone = { development: 'complete' };
    expect(editStep({ stages: stages({ ...buildDone, checks: 'running' }) })).toBe('current');
    expect(editStep({ stages: stages({ ...buildDone, documentation_sync: 'running' }) })).toBe(
      'current',
    );
    expect(
      editStep(
        { stages: stages(buildDone) },
        {
          ...IDLE_LIVE,
          editing: { toolUseId: 'tu_1', file: '/work/src/a.ts' },
        },
      ),
    ).toBe('current');
    expect(editStep({ stages: stages(buildDone) })).toBe('done');
    expect(editStep({ stages: stages({ checks: 'complete' }) })).toBe('done');
    expect(editStep({ stages: stages({}) })).toBe('todo');
  });

  it('counts only your commits, then names push, PR and CI as they land', () => {
    expect(shipRail(parse(shipping({ push: null, pr: null, pr_state: null }))).status).toBe(
      '2 of your commits',
    );
    expect(shipRail(parse(shipping({ pr: null, pr_state: null }))).status).toBe('pushed');
    expect(shipRail(parse(shipping({}))).status).toBe(`PR ${ticketRef(12)}`);
    expect(shipRail(parse(shipping({ ci: ci('pending', 4, 6) }))).status).toBe('CI · 4 of 6 green');
    expect(shipRail(parse(shipping({ ci: ci('fail', 6, 6) }))).status).toBe('CI failed');
    expect(shipRail(parse(shipping({ push: { state: 'failed' }, pr: null }))).status).toBe(
      'push failed',
    );
    expect(states(shipping({ ci: ci('pending', 4, 6) }))).toEqual([
      'Edit done',
      'Commit done',
      'Push done',
      'PR done',
      'CI current',
      'Merge todo',
    ]);
  });

  it('AC-6: a merge commit never lights Merge, only a merged PR does', () => {
    expect(shipRail(parse(shipping({ merge_commit: 'release' }))).merged).toBe(false);
    const merged = shipRail(parse(shipping({ merged: true, pr_state: 'merged' })));
    expect(merged.steps.at(-1)!.state).toBe('done');
    expect(merged.status).toBe(`PR ${ticketRef(12)} merged`);
  });

  it('AC-7: Merge reads unknown when the PR state could not be read', () => {
    expect(states(shipping({ pr_state: null })).at(-1)).toBe('Merge unknown');
  });

  it('AC-11: shows no PR when the snapshot has none of this change', () => {
    const rail = shipRail(parse(shipping({ pr: null, pr_state: null, ci: ci('pass', 6, 6) })));
    expect(rail.steps.slice(3).map((s) => s.state)).toEqual(['todo', 'todo', 'todo']);
  });

  it('AC-12: a PR closed without merging stops the rail and keeps Merge dark', () => {
    const rail = shipRail(parse(shipping({ pr_state: 'closed', ci: ci('pass', 6, 6) })));
    expect(rail.status).toBe('PR closed');
    expect(rail.steps.slice(3).map((s) => s.state)).toEqual(['closed', 'todo', 'todo']);
  });

  it('AC-45: all green says so in words, stays all green until merged, and keys the toast by head', () => {
    const safe = `Safe to merge: PR ${ticketRef(12)} is ready for your merge`;
    const raw = {
      ...shipping({ ci: ci('pass', 6, 6), all_green: true }),
      headline: { text: safe, tone: 'good', row: 8, word: 'Safe to merge', rung: 'safe-to-merge' },
    };
    const snap = parse(raw);
    const rail = shipRail(snap);
    expect(rail.allGreen).toBe(true);
    expect(rail.status).toBe('All green · merge is yours');
    expect(rail.steps.at(-1)!.state).toBe('ready');
    expect(bandHeadline(snap, buildBandView(snap, NOW))).toBe(safe);
    expect(allGreenKey(snap)).toMatch(/:aaa$/);
    const band = bandOf(raw);
    expect(band.kind === 'card' && band.tone).toBe('good');
    expect(allGreenKey(parse(shipping({ ci: ci('pass', 6, 6) })))).toBeNull();
    const asking = parse({
      ...raw,
      decisions: { pending: [{ id: 'D-1', category: 'x', question: 'q' }], resolved: 0 },
    });
    expect(allGreenKey(asking)).toBeNull();
    const noNumber = parse({
      ...shipping({ ci: ci('pass', 6, 6), all_green: true, pr: { ...OWN_PR, number: null } }),
      headline: { text: 'Safe to merge: The PR is ready for your merge', tone: 'good', row: 8 },
    });
    expect(bandHeadline(noNumber, buildBandView(noNumber, NOW))).toBe(
      'Safe to merge: The PR is ready for your merge',
    );
  });

  it('draws the terminal rail with marks, a track and an inherited note', () => {
    const block = blockOf(bandOf(shipping({ ci: ci('pending', 4, 6) })), 'paqad-instrument-ship')!;
    expect(blockLines(block)).toEqual([
      'SHIP  CI · 4 of 6 green',
      '● ─ ● ─ ● ─ ● ─ ▸ ─ ○',
      'Edit   Commit   Push   PR   CI   Merge (yours)',
      'CI read 1:00 ago · +1 already on the branch, not yours',
    ]);
    expect(block.svg).toBeNull();
    expect(block.title[0]).toMatchObject({ opens: 'ships' });
  });

  it('AC-44: draws the git icon rail as an Svg on Desktop only, with the same fact in words', () => {
    const raw = shipping({ ci: ci('pending', 4, 6) });
    const desktop = blockOf(bandOf(raw, 120, 12, 'desktop'), 'paqad-instrument-ship')!;
    expect(desktop.svg?.alt).toBe(
      'Ship: Edit done, Commit done, Push done, PR done, CI 4 of 6 green, Merge not yet.',
    );
    expect(desktop.svg?.source).toContain('<svg');
    expect(desktop.svg?.source).toContain('stroke-dasharray');
    expect(railAlt(shipRail(null))).toBe(
      'Ship: Edit not yet, Commit not yet, Push not yet, PR not yet, CI not yet, Merge not yet.',
    );
    const terminal = bandOf(raw, 120, 12, 'terminal');
    expect(terminal.kind === 'card' && terminal.blocks.every((block) => block.svg === null)).toBe(
      true,
    );
    const escaped = shipRailSvg(shipRail(parse(raw))).source;
    expect(escaped).not.toContain('<script');
  });
});

describe('the Ships tab (FR-55)', () => {
  const now = Date.parse('2026-10-18T09:01:30.000Z');

  it('lists your commits by sha and message and marks the inherited one', () => {
    const lines = linesText(shipsLines(parse(shipping({})), now)).split('\n');
    expect(lines.slice(0, 6)).toEqual([
      'Edit         done',
      'Commits      2 of yours',
      '  aaa1111 feat: one',
      '  bbb2222 feat: two',
      `  ccc3333 chore: older  ${ON_THE_BRANCH}`,
      'Push         pushed to feat/x',
    ]);
    expect(lines).toContain(`Pull request ${ticketRef(12)} open https://example.test/pull/12`);
    expect(lines).toContain(`Merge        ${MERGE_IS_YOURS}`);
  });

  it('shows each CI job with progress and time, and the read time', () => {
    const jobs = [
      {
        name: 'build',
        status: 'COMPLETED',
        conclusion: 'SUCCESS',
        started_at: '2026-10-18T08:50:00.000Z',
        completed_at: '2026-10-18T08:53:00.000Z',
      },
      { name: 'test', status: 'IN_PROGRESS', started_at: '2026-10-18T09:00:00.000Z' },
      { name: 'lint', status: 'COMPLETED', conclusion: 'FAILURE' },
    ];
    const lines = linesText(
      shipsLines(parse(shipping({ ci: ci('pending', 2, 3, { jobs }) })), now),
    );
    expect(lines).toContain('CI           running, 2 of 3 done, read 2:30 ago');
    expect(lines).toContain('  ● build  passed  3:00');
    expect(lines).toContain('  ▸ test  running  1:30');
    expect(lines).toContain('  ✗ lint  failed');
    expect(readAgo(null, now)).toBeNull();
  });

  it('says passed, failed or unknown, and unknown when never saved', () => {
    const at = (ship: Raw) => linesText(shipsLines(parse(shipping(ship)), now));
    expect(at({ ci: ci('pass', 3, 3) })).toContain(
      'CI           passed, 3 of 3 done, read 2:30 ago',
    );
    expect(at({ ci: ci('fail', 3, 3) })).toContain('CI           failed, 3 of 3 done');
    expect(at({ ci: { state: 'unknown', reason: 'gh is signed out' } })).toContain(
      'CI           unknown: gh is signed out',
    );
    expect(at({ ci: null })).toContain('CI           unknown, never recorded');
    expect(at({ ci: { state: 'pending' }, ci_read_at: null })).toContain('CI           running');
  });

  it('opens the PR when everything is green, and says merged once you merge', () => {
    const green = shipsLines(parse(shipping({ ci: ci('pass', 3, 3), all_green: true })), now);
    expect(linesText(green)).toContain(`Merge        ${EVERYTHING_GREEN}`);
    expect(green.at(-1)).toEqual([
      { text: `  Open PR ${ticketRef(12)}`, href: 'https://example.test/pull/12' },
    ]);
    const merged = linesText(
      shipsLines(parse(shipping({ merged: true, pr_state: 'merged' })), now),
    );
    expect(merged).toContain('Merge        merged by you');
    expect(merged).toContain(`Pull request ${ticketRef(12)} merged`);
  });

  it('names its empty states', () => {
    expect(linesText(shipsLines(null))).toBe(NOTHING_PUSHED);
    expect(linesText(shipsLines(parse({ ...FULL_ORD_501, ship: null })))).toBe(NOTHING_PUSHED);
    const bare = linesText(
      shipsLines(
        parse(shipping({ commit_list: [], commits: 0, push: null, pr: null, pr_state: null })),
      ),
    );
    expect(bare).toContain('Commits      none yet');
    expect(bare).toContain('Push         not yet');
    expect(bare).toContain('Pull request not yet');
    const listless = linesText(shipsLines(parse(shipping({ commit_list: [] }))));
    expect(listless).toContain('Commits      2 of yours, no list recorded');
    const failed = linesText(shipsLines(parse(shipping({ push: { state: 'failed' } }))));
    expect(failed).toContain('Push         failed');
    const unstated = linesText(shipsLines(parse(shipping({ pr_state: null }))));
    expect(unstated).toContain(`Pull request ${ticketRef(12)} state unknown`);
  });
});
