import { afterEach, describe, expect, it } from 'vitest';

import {
  COMMAND_NAMES,
  commandName,
  isCommandName,
  refusalReason,
  setCommandName,
  slash,
  takenLine,
} from '../../../../runtime/claude-plugin/mod/command-name.ts';
import {
  ARGUMENT_HINT,
  COMMAND_DESCRIPTION,
  SUBCOMMANDS,
  notActiveText,
  readRepoDecision,
  runPaqadCommand,
  subcommandOf,
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

const HUD_HELP =
  'Try /paqad-hud status, /paqad-hud decisions, /paqad-hud rules, /paqad-hud receipt, /paqad-hud cost, /paqad-hud trust, /paqad-hud ships, /paqad-hud record, /paqad-hud show or /paqad-hud hide.';

describe('the command name', () => {
  afterEach(() => setCommandName('paqad'));

  it('AC-3: is /paqad until the fallback is set', () => {
    expect(commandName()).toBe('paqad');
    expect(slash()).toBe('/paqad');
    expect(slash('show')).toBe('/paqad show');
  });

  it('AC-2: becomes /paqad-hud when the fallback is set', () => {
    setCommandName('paqad-hud');
    expect(commandName()).toBe('paqad-hud');
    expect(slash()).toBe('/paqad-hud');
    expect(slash('receipt')).toBe('/paqad-hud receipt');
  });

  it('words a refusal for the debug log, with the engine reason', () => {
    const taken = new Error(
      `paqad: $.command.register: "/paqad" refused: it is the plugin's /paqad-product-discovery:paqad`,
    );
    expect(refusalReason(taken)).toBe("it is the plugin's /paqad-product-discovery:paqad");
    expect(refusalReason('no room')).toBe('no room');
    expect(takenLine([refusalReason(taken)])).toBe(
      "paqad: /paqad is taken (it is the plugin's /paqad-product-discovery:paqad); the HUD command is /paqad-hud",
    );
    expect(takenLine(['one', 'two'])).toBe(
      'paqad: /paqad is taken (one) and /paqad-hud is taken (two); the HUD has no command',
    );
  });

  it('knows both names and no other', () => {
    expect(COMMAND_NAMES).toEqual(['paqad', 'paqad-hud']);
    expect(isCommandName('paqad')).toBe(true);
    expect(isCommandName('paqad-hud')).toBe(true);
    expect(isCommandName('paqad-product-discovery:paqad')).toBe(false);
    expect(isCommandName('cost')).toBe(false);
  });

  it('AC-2: names /paqad-hud in the help and unknown-subcommand lines under the fallback', () => {
    setCommandName('paqad-hud');
    expect(run('deploy', FULL_ORD_501)).toBe(`There is no /paqad-hud deploy. ${HUD_HELP}`);
    expect(run('', FULL_ORD_501).split('\n').at(-1)).toBe(HUD_HELP);
    expect(run('status', null)).toBe(`Not yet. paqad has no record for this session. ${HUD_HELP}`);
    expect(run('hide', null)).toBe(
      'The paqad band is hidden. Run /paqad-hud show to bring it back.',
    );
    expect(run('record', FULL_ORD_501)).toContain('Receipt      written, see /paqad-hud receipt');
  });

  it('AC-2: answers every subcommand under the fallback as it does under /paqad', () => {
    const answers = SUBCOMMANDS.map((sub) => run(sub, FULL_ORD_501, { receipt: RECEIPT_TEXT }));
    setCommandName('paqad-hud');
    expect(
      SUBCOMMANDS.map((sub) =>
        run(sub, FULL_ORD_501, { receipt: RECEIPT_TEXT }).replaceAll('/paqad-hud', '/paqad'),
      ),
    ).toEqual(answers);
  });
});

describe('the hide and delivery subcommands', () => {
  it('registers one argument hint and description for both names', () => {
    expect(ARGUMENT_HINT).toBe(
      '[status|decisions|rules|receipt|cost|trust|ships|delivery|record|show|hide]',
    );
    expect(COMMAND_DESCRIPTION).toBe(
      'Where the paqad change stands: status, decisions, rules, receipt, cost, trust, delivery, record, or show or hide the band',
    );
  });

  it('answers /paqad hide with how to bring the band back', () => {
    expect(run('hide', null)).toBe('The paqad band is hidden. Run /paqad show to bring it back.');
    expect(run(' HIDE ', FULL_ORD_501)).toBe(
      'The paqad band is hidden. Run /paqad show to bring it back.',
    );
  });

  it('answers /paqad delivery as /paqad ships', () => {
    expect(subcommandOf('  Delivery now')).toBe('ships');
    expect(subcommandOf('status')).toBe('status');
    expect(subcommandOf('')).toBe('');
    expect(run('delivery', FULL_ORD_501)).toBe(run('ships', FULL_ORD_501));
    expect(run('delivery', null)).toBe(run('ships', null));
  });
});

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

describe('/paqad answers', () => {
  it('gives the overview with no subcommand', () => {
    expect(run('', FULL_ORD_501)).toBe(
      [
        'Safe to merge (1 flag). 1 flag open.',
        'Stage: Intake not yet, Planning done, Spec done, Build done, Review done, Checks done, Docs done, Deliver not yet.',
        'Ship: Edit done, Commit done, Push not yet, PR not yet, CI not yet, Merge not yet.',
        'cost: not yet',
        'Try /paqad status, /paqad decisions, /paqad rules, /paqad receipt, /paqad cost, /paqad trust, /paqad ships, /paqad record, /paqad show or /paqad hide.',
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
        '1 decision waiting. 2 resolved for this change.',
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
    expect(run('decisions', two)).toContain('2 decisions waiting. 0 resolved for this change.');
    expect(run('decisions', two)).toContain('  D-1 (c): no question recorded');
    expect(run('decisions', FULL_ORD_501)).toBe(
      'No decision is waiting. 4 resolved for this change.',
    );
  });

  it('lists every pending packet in the repo, labelled in this repo, when the mod read them', () => {
    const repo = [
      readRepoDecision(
        'D-A.json',
        JSON.stringify({ id: 'D-A', category: 'ux-pattern', title: 'Which layout?' }),
      ),
      readRepoDecision('D-B.json', JSON.stringify({ decision_id: 'D-B', question: 'Keep it?' })),
      readRepoDecision('D-C.json', '{broken'),
      readRepoDecision('D-D.json', null),
    ];
    expect(run('decisions', FULL_ORD_501, { repoDecisions: repo })).toBe(
      [
        '4 decisions waiting in this repo. 4 resolved for this change.',
        '  D-A (ux-pattern): Which layout?',
        '  D-B (unknown): Keep it?',
        '  D-C (unknown): no question recorded',
        '  D-D (unknown): no question recorded',
      ].join('\n'),
    );
    expect(run('decisions', FULL_ORD_501, { repoDecisions: [] })).toBe(
      'No decision is waiting in this repo. 4 resolved for this change.',
    );
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

  it('says cost is not yet counted until a hook wrote it', () => {
    expect(run('cost', FULL_ORD_501)).toBe(
      'Cost: not yet. paqad counts it from the transcripts at the end of each turn.',
    );
    expect(run(' COST ', null)).toContain('Not yet. paqad has no record for this session.');
  });

  it('answers an unknown subcommand and a missing snapshot', () => {
    expect(run('deploy', FULL_ORD_501)).toBe(
      'There is no /paqad deploy. Try /paqad status, /paqad decisions, /paqad rules, /paqad receipt, /paqad cost, /paqad trust, /paqad ships, /paqad record, /paqad show or /paqad hide.',
    );
    expect(run('status', null)).toBe(
      'Not yet. paqad has no record for this session. Try /paqad status, /paqad decisions, /paqad rules, /paqad receipt, /paqad cost, /paqad trust, /paqad ships, /paqad record, /paqad show or /paqad hide.',
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
