import { describe, expect, it } from 'vitest';

import { allGreenKey, bandHeadline } from '../../../../runtime/claude-plugin/mod/band.ts';
import { IDLE_LIVE } from '../../../../runtime/claude-plugin/mod/live.ts';
import { buildBandView, parseSnapshot } from '../../../../runtime/claude-plugin/mod/model.ts';
import { railAlt, shipRail, shipRailSvg } from '../../../../runtime/claude-plugin/mod/ship.ts';
import {
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

import { deliveryView, stripOf } from '../../../../runtime/claude-plugin/mod/desktop-view.ts';
import { strip } from '../../../../runtime/claude-plugin/mod/strip.ts';

import { bandOf, blockLines, blockOf, layoutLines } from './band-text.ts';

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

  it('AC-20: keeps Edit current only while an edit stage runs, never in Plan or Spec', () => {
    const editStep = (over: Raw) => shipRail(parse({ ...FAST_ORD_490, ...over })).steps[0]!.state;
    const buildDone = { development: 'complete' };
    expect(editStep({ stages: stages({ ...buildDone, checks: 'running' }) })).toBe('current');
    expect(editStep({ stages: stages({ ...buildDone, documentation_sync: 'running' }) })).toBe(
      'current',
    );
    expect(editStep({ stages: stages(buildDone) })).toBe('done');
    expect(editStep({ stages: stages({ planning: 'running' }) })).toBe('todo');
    expect(editStep({ stages: stages({ specification: 'running' }) })).toBe('todo');
    expect(editStep({ stages: stages({ development: 'running' }) })).toBe('current');
    expect(editStep({ stages: stages(buildDone) })).toBe('done');
    expect(editStep({ stages: stages({ checks: 'complete' }) })).toBe('done');
    expect(editStep({ stages: stages({}) })).toBe('todo');
  });

  it('keeps Edit current while a real edit is in progress, whatever stage it lands in', () => {
    const editing = { ...IDLE_LIVE, editing: { toolUseId: 'tu', file: '/repo/a.ts' } };
    const editStep = (over: Raw, live = editing) =>
      shipRail(parse({ ...FAST_ORD_490, ...over }), live).steps[0]!.state;
    expect(editStep({ stages: stages({ development: 'complete' }) })).toBe('current');
    expect(editStep({ stages: stages({ planning: 'running' }) })).toBe('current');
    expect(editStep({ stages: stages({ specification: 'running' }) })).toBe('current');
    expect(editStep({ stages: stages({ planning: 'running' }) }, IDLE_LIVE)).toBe('todo');
    expect(editStep({ stages: stages({ development: 'complete' }) }, IDLE_LIVE)).toBe('done');
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
    ]);
  });

  it('AC-6: a merge commit never reads merged, and a merged PR leaves no merged note', () => {
    expect(shipRail(parse(shipping({ merge_commit: 'release' }))).merged).toBe(false);
    const merged = shipRail(parse(shipping({ merged: true, pr_state: 'merged' })));
    expect(merged.steps.at(-1)!.label).toBe('CI');
    expect(merged.status).toBe(`PR ${ticketRef(12)}`);
  });

  it('AC-7: the PR step reads unknown when the PR state could not be read', () => {
    expect(states(shipping({ pr_state: null })).at(3)).toBe('PR unknown');
    expect(shipRail(parse(shipping({ pr_state: null }))).status).toBe('PR state unknown');
  });

  it('AC-11: shows no PR when the snapshot has none of this change', () => {
    const rail = shipRail(parse(shipping({ pr: null, pr_state: null, ci: ci('pass', 6, 6) })));
    expect(rail.steps.slice(3).map((s) => s.state)).toEqual(['todo', 'todo']);
  });

  it('AC-12: a PR closed without merging stops the rail', () => {
    const rail = shipRail(parse(shipping({ pr_state: 'closed', ci: ci('pass', 6, 6) })));
    expect(rail.status).toBe('PR closed');
    expect(rail.steps.slice(3).map((s) => s.state)).toEqual(['closed', 'todo']);
  });

  it('AC-45: a green CI reads as its count, never as a merge, and keys the toast by head', () => {
    const raw = {
      ...shipping({ ci: ci('pass', 6, 6), all_green: true }),
      headline: { text: 'Done', tone: 'good', row: 16, word: 'Done', rung: 'done' },
    };
    const snap = parse(raw);
    const rail = shipRail(snap);
    expect(rail.allGreen).toBe(true);
    expect(rail.status).toBe('CI · 6 of 6 green');
    expect(rail.steps.at(-1)).toEqual({ label: 'CI', state: 'done' });
    expect(bandHeadline(snap, buildBandView(snap, NOW))).toBe('Done');
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
      headline: { text: 'Done', tone: 'good', row: 16 },
    });
    expect(bandHeadline(noNumber, buildBandView(noNumber, NOW))).toBe('Done');
  });

  it('draws the terminal rail with marks, a track and an inherited note', () => {
    const block = blockOf(bandOf(shipping({ ci: ci('pending', 4, 6) })), 'paqad-instrument-ship')!;
    expect(blockLines(block)).toEqual([
      'SHIP  CI · 4 of 6 green',
      '● ─ ● ─ ● ─ ● ─ ▸',
      'Edit   Commit   Push   PR   CI',
      'CI read 1:00 ago · +1 already on the branch, not yours',
    ]);
    expect(block.svg).toBeNull();
    expect(block.title[0]).toMatchObject({ opens: 'ships' });
  });

  it('AC-44: draws the git icon rail as an Svg on Desktop only, with the same fact in words', () => {
    const raw = shipping({ ci: ci('pending', 4, 6) });
    const desktop = blockOf(bandOf(raw, 120, 12, 'desktop'), 'paqad-instrument-ship')!;
    expect(desktop.svg?.alt).toBe(
      'Ship: Edit done, Commit done, Push done, PR done, CI 4 of 6 green.',
    );
    expect(desktop.svg?.source).toContain('<svg');
    expect(desktop.svg?.source).toContain('stroke-dasharray');
    expect(railAlt(shipRail(null))).toBe(
      'Ship: Edit not yet, Commit not yet, Push not yet, PR not yet, CI not yet.',
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
    expect(lines).toContain(`  Open PR ${ticketRef(12)}`);
    expect(lines.some((line) => line.startsWith('Merge'))).toBe(false);
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

  it('links the open PR under its row, and drops the link and any merged word once merged', () => {
    const green = shipsLines(parse(shipping({ ci: ci('pass', 3, 3), all_green: true })), now);
    const prAt = green.findIndex((entry) => linesText([entry]).startsWith('Pull request'));
    expect(green[prAt + 1]).toEqual([
      { text: `  Open PR ${ticketRef(12)}`, href: 'https://example.test/pull/12' },
    ]);
    const merged = linesText(
      shipsLines(parse(shipping({ merged: true, pr_state: 'merged' })), now),
    );
    expect(merged).not.toContain('Merge');
    expect(merged).not.toContain('Open PR');
    expect(merged).toContain(`Pull request ${ticketRef(12)} https://example.test/pull/12`);
    expect(merged).not.toMatch(/merged/i);
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

describe("AC-10: merging is the owner's, so no surface draws a Merge step", () => {
  const DONE = { text: 'Done', tone: 'good', row: 16, word: 'Done', rung: 'done' };
  const fixtures: Array<[string, Raw]> = [
    ['no PR', shipping({ pr: null, pr_state: null })],
    ['an open PR with CI pending', shipping({ ci: ci('pending', 2, 6) })],
    ['CI passed', shipping({ ci: ci('pass', 6, 6), all_green: true })],
    ['a merged PR', shipping({ ci: ci('pass', 6, 6), merged: true, pr_state: 'merged' })],
  ];
  const FORBIDDEN = [
    /Merge/,
    /All green/,
    /merge is yours/i,
    /Delivered/,
    /Safe to merge/,
    /is merged/,
    /Watching CI/,
    /\bready\b/,
  ];

  for (const [name, raw] of fixtures) {
    it(`draws no Merge with ${name}, on either surface and in either Ledger`, () => {
      const done = parse({ ...raw, headline: DONE });
      const texts: string[] = [];
      for (const surface of ['terminal', 'desktop'] as const) {
        const band = bandOf({ ...raw, headline: DONE }, 120, 12, surface);
        texts.push(...layoutLines(band));
        if (band.kind === 'card') {
          for (const block of band.blocks) if (block.svg) texts.push(block.svg.alt);
        }
      }
      texts.push(linesText(shipsLines(done, NOW)));
      const view = deliveryView(done);
      texts.push(...view.blocks.flatMap((block) => [block.title, block.sub ?? '', block.label]));
      const input = stripOf(done, 93);
      texts.push(...input.delivery.map((mark) => `${mark.label} ${mark.state}`));
      texts.push(input.deliveryValue, input.stageValue);
      texts.push(strip(input).source.replace(/<style>.*<\/style>/, ''));
      for (const text of texts) {
        for (const pattern of FORBIDDEN) expect(text).not.toMatch(pattern);
      }
      expect(shipRail(done).steps.map((step) => step.label)).toEqual([
        'Edit',
        'Commit',
        'Push',
        'PR',
        'CI',
      ]);
    });
  }

  it('a merged PR leaves no merged note anywhere', () => {
    const merged = parse({ ...fixtures[3]![1], headline: DONE });
    const texts = [
      shipRail(merged).status ?? '',
      stripOf(merged, 93).deliveryValue,
      stripOf(merged, 93).stageValue,
      linesText(shipsLines(merged, NOW)),
      ...layoutLines(bandOf({ ...fixtures[3]![1], headline: DONE })),
    ];
    for (const text of texts) expect(text).not.toMatch(/merged/i);
  });

  it('FR-28: CI pending with no count draws a still 30% arc, not a spinner', () => {
    const input = stripOf(
      parse({
        ...shipping({ ci: { ...ci('pending', 0, 0), done: null, total: null } }),
        headline: DONE,
      }),
      93,
    );
    const source = strip(input).source.replace(/<style>.*<\/style>/, '');
    expect(source).not.toMatch(/class="spin"/);
    expect(source).toMatch(/stroke-dasharray="[0-9.]+ [0-9.]+"/);
  });
});
