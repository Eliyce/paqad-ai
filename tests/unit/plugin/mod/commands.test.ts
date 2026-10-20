import { describe, expect, it } from 'vitest';

import {
  SUBCOMMANDS,
  notActiveText,
  runPaqadCommand,
  type CommandInput,
} from '../../../../runtime/claude-plugin/mod/commands.ts';
import { parseSnapshot } from '../../../../runtime/claude-plugin/mod/model.ts';
import {
  FAST_ORD_490,
  FULL_ORD_501,
  GRADUATED_ORD_482,
  NEEDS_ATTENTION,
  NOW,
  PAUSED,
  RECEIPT_TEXT,
  fileText,
  snapshot,
} from '../../../../runtime/claude-plugin/mod/test/fixtures.ts';
import type { PaqadStandDown } from '../../../../runtime/claude-plugin/mod/types/index.d.ts';

const run = (args: string, raw: Record<string, unknown> | null, over: Partial<CommandInput> = {}) =>
  runPaqadCommand({
    args,
    standDown: null,
    snapshot: raw ? parseSnapshot(fileText(raw)) : null,
    receipt: null,
    now: NOW,
    ...over,
  }).text;

describe('/paqad while the mod stands down', () => {
  it.each([
    ['not-onboarded', 'paqad is not active here: this project was never onboarded.'],
    ['view-off', 'paqad is not active here: the paqad HUD is turned off in the plugin settings.'],
    ['remote', 'paqad is not active here: this session runs in the cloud.'],
    ['disabled', 'paqad is not active here: paqad is turned off for this project.'],
    ['old-engine', 'paqad is not active here: this Claude Code is older than 2.1.301.'],
  ] as const)('%s', (reason: PaqadStandDown, text) => {
    expect(notActiveText(reason)).toBe(text);
    for (const args of ['', ...SUBCOMMANDS]) {
      expect(run(args, FULL_ORD_501, { standDown: reason })).toBe(text);
    }
  });
});

describe('/paqad answers (AC-39)', () => {
  it('gives the overview with no subcommand', () => {
    expect(run('', FULL_ORD_501)).toBe(
      [
        'Safe to merge (1 flag). 1 flag open.',
        'Stage: Intake not yet, Planning done, Spec done, Build done, Review done, Checks done, Docs done, Deliver not yet.',
        'Ship: Edit done, Commit done, Push not yet, PR not yet, CI not yet, Merge not yet.',
        'cost: not yet',
        'Try /paqad status, /paqad decisions, /paqad rules, /paqad receipt, /paqad cost, /paqad trust, /paqad ships or /paqad record.',
      ].join('\n'),
    );
  });

  it('puts the live clock on the running stage', () => {
    expect(run('', FAST_ORD_490)).toContain('Build running 2m 00s');
    expect(run('status', FAST_ORD_490)).toContain('  Build: running 2m 00s');
  });

  it('says where the change stands with /paqad status', () => {
    const text = run('status', NEEDS_ATTENTION);
    expect(text).toContain('Needs your attention.\n');
    expect(text).toContain('Change: #ORD-501 Add CSV export to the orders page.');
    expect(text).toContain('Branch: feat/ORD-501-csv-export.');
    expect(text).toContain('Lane: full, a new export of customer data.');
    expect(text).toContain('  Review: not yet');
    expect(text).toContain('Verdict: Needs your attention.');
    expect(text).toContain('  change-completeness: review missing');
  });

  it('names flags, paused changes and a change with no title', () => {
    expect(run('status', FULL_ORD_501)).toContain('Flag: 1 near-copy of existing code is open.');
    expect(run('status', PAUSED)).toContain('Paused: 1 change.');
    const two = { ...PAUSED, paused: [{ workflow: 'a' }, { workflow: 'b' }] };
    expect(run('status', two)).toContain('Paused: 2 changes.');
    const bare = { ...FAST_ORD_490, lane_reason: null, change: { id: 'X-1' } };
    expect(run('status', bare)).toContain('Change: X-1.');
    expect(run('status', bare)).toContain('Lane: fast.');
    const blank = { ...FAST_ORD_490, change: {} };
    expect(run('status', blank)).toContain('Change: untitled.');
  });

  it('lists waiting decisions', () => {
    expect(run('decisions', GRADUATED_ORD_482)).toBe(
      [
        '1 decision waiting. 2 resolved.',
        '  D-01J0 (fix.proof_method): How should the fix be proven?',
      ].join('\n'),
    );
    const two = {
      ...GRADUATED_ORD_482,
      decisions: {
        pending: [
          { id: 'D-1', category: 'c' },
          { id: 'D-2', category: 'c' },
        ],
        resolved: 0,
      },
    };
    expect(run('decisions', two)).toContain('2 decisions waiting. 0 resolved.');
    expect(run('decisions', two)).toContain('  D-1 (c): no question recorded');
    expect(run('decisions', FULL_ORD_501)).toBe('No decision is waiting. 4 resolved.');
  });

  it('reports the rules and their findings as counts', () => {
    expect(run('rules', FULL_ORD_501)).toBe(
      [
        'Rules loaded for this change: 12 apply, loaded 2026-10-18T08:35:00.000Z.',
        'Rule findings: none open.',
        'Near-copies: 1 open.',
      ].join('\n'),
    );
    const blocking = {
      ...FULL_ORD_501,
      rules: { recorded: true, applicable: null },
      findings: { rules: { status: 'open', blocking: true }, near_copies: { status: 'clean' } },
    };
    expect(run('rules', blocking)).toBe(
      [
        'Rules loaded for this change: 0 apply.',
        'Rule findings: 0 open, blocking.',
        'Near-copies: none open.',
      ].join('\n'),
    );
    const unloaded = { ...FAST_ORD_490, rules: { recorded: false } };
    expect(run('rules', unloaded)).toBe(
      [
        'The rules for this change are not loaded yet.',
        'Rule findings: did not run.',
        'Near-copies: did not run.',
      ].join('\n'),
    );
    expect(run('rules', snapshot())).toBe(
      'No change is in progress, so no rules are loaded for one.',
    );
  });

  it('prints the receipt, or says there is none yet', () => {
    expect(run('receipt', FULL_ORD_501, { receipt: RECEIPT_TEXT })).toBe(RECEIPT_TEXT);
    expect(run('receipt', FULL_ORD_501, { receipt: '  ' })).toBe(
      'No receipt yet. paqad writes one at the end of each turn.',
    );
    expect(run('receipt', null)).toBe('No receipt yet. paqad writes one at the end of each turn.');
  });

  it('says cost is not yet counted until a hook wrote it (Part 23)', () => {
    expect(run('cost', FULL_ORD_501)).toBe(
      'Cost: not yet. paqad counts it from the transcripts at the end of each turn.',
    );
    expect(run(' COST ', null)).toContain('Not yet. paqad has no record for this session.');
  });

  it('answers an unknown subcommand and a missing snapshot', () => {
    expect(run('deploy', FULL_ORD_501)).toBe(
      'There is no /paqad deploy. Try /paqad status, /paqad decisions, /paqad rules, /paqad receipt, /paqad cost, /paqad trust, /paqad ships or /paqad record.',
    );
    expect(run('status', null)).toBe(
      'Not yet. paqad has no record for this session. Try /paqad status, /paqad decisions, /paqad rules, /paqad receipt, /paqad cost, /paqad trust, /paqad ships or /paqad record.',
    );
  });

  it('never uses an em dash', () => {
    for (const raw of [
      FULL_ORD_501,
      FAST_ORD_490,
      GRADUATED_ORD_482,
      PAUSED,
      NEEDS_ATTENTION,
      null,
    ]) {
      for (const args of ['', ...SUBCOMMANDS, 'nope']) expect(run(args, raw)).not.toContain('—');
    }
  });
});
