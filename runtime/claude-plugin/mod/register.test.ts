// `claude plugin test` for the paqad HUD mod (issue #639, Parts 8 and 9, FR-30, AC-35): the mod's
// hooks run against Claude Code's own test kit, each UI test looped over the terminal and the
// desktop. The pure modules have their vitest suite in tests/unit/plugin/mod/; these check the
// glue: what registers, what the band draws, what `/paqad` answers, and when it reads again.
// Run them with `pnpm run plugin:test`.

import type { RenderElement, RenderNode } from 'claude-code';
import { describe, expect, mock, test } from 'claude-code/testing';

import {
  FAST_ORD_490,
  FAST_ORD_490_COST,
  FULL_ORD_501,
  FULL_ORD_501_COST,
  GRADUATED_ORD_482,
  NOW,
  PAUSED,
  RECEIPT_TEXT,
  SAFE_CLEAN,
  STATE_FIXTURES,
  fileText,
} from './test/fixtures';
import {
  ENGINE_BAND,
  ONBOARDED,
  RECEIPT,
  SNAPSHOT,
  START,
  band,
  command,
  linesOf,
  pane,
  stringsOf,
  worldOf,
} from './test/world';

const SURFACES = ['terminal', 'desktop'] as const;
const PLUGIN = 'paqad';
const STATES = Object.keys(STATE_FIXTURES) as Array<keyof typeof STATE_FIXTURES>;

const textOf = (node: RenderElement): string => stringsOf(node).join('');

/** The first `Text` whose own words are exactly `text`. */
function textElement(node: RenderNode, text: string): RenderElement | undefined {
  if (typeof node === 'string') return undefined;
  const children = (node as { children?: readonly RenderNode[] }).children ?? [];
  if (node.type === 'Text' && children.length === 1 && children[0] === text) return node;
  for (const child of children) {
    const found = textElement(child, text);
    if (found) return found;
  }
  return undefined;
}

const colorOf = (node: RenderElement | undefined): unknown =>
  (node as { props?: { color?: unknown } } | undefined)?.props?.color;

describe('the band draws each of the nine states (AC-41)', () => {
  for (const surface of SURFACES) {
    for (const state of STATES) {
      test(`${state} on ${surface}`, async ($, on) => {
        worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(STATE_FIXTURES[state]) } });
        mock.clock(on, { now: NOW });
        await $.session.start(START);
        const drawn = await $.ui.render(band(surface));
        expect(linesOf(drawn)[0]).toStartWith(`paqad · ${state}`);
      });
    }
  }
});

describe('the band on each fixture change (AC-40, AC-42)', () => {
  for (const surface of SURFACES) {
    test(`the surface accepts every fixture's band on ${surface}`, async ($, on) => {
      const world = worldOf(on, { files: { ...ONBOARDED } });
      mock.clock(on, { now: NOW });
      await $.session.start(START);
      for (const fixture of [FAST_ORD_490, GRADUATED_ORD_482, FULL_ORD_501, PAUSED]) {
        world.put(SNAPSHOT, fileText(fixture));
        await $.tool.call({ tool: 'Bash', command: 'paqad-ai status' } as never);
        const mounted = await $.ui.mount({
          plugin: PLUGIN,
          surface,
          component: 'AbovePrompt',
          props: band(surface).props,
        });
        expect(await mounted.find({ text: /^Stage/ })).toBeDefined();
        expect(await mounted.find({ text: /^Ship/ })).toBeDefined();
        await mounted.unmount();
      }
    });

    test(`fast lane: 8 Stage segments, Spec not required, no High Table on ${surface}`, async ($, on) => {
      worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(FAST_ORD_490) } });
      mock.clock(on, { now: NOW });
      await $.session.start(START);
      const text = textOf(await $.ui.render(band(surface)));
      for (const label of [
        'Intake',
        'Planning',
        'Spec',
        'Build',
        'Review',
        'Checks',
        'Docs',
        'Deliver',
      ]) {
        expect(text).toContain(label);
      }
      expect(text).toContain('-Spec');
      expect(text).toContain('Build running 2m 00s');
      expect(text).not.toContain('High Table');
    });

    test(`graduated lane: Needs you, and Merge stays yours on ${surface}`, async ($, on) => {
      worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(GRADUATED_ORD_482) } });
      mock.clock(on, { now: NOW });
      await $.session.start(START);
      const text = textOf(await $.ui.render(band(surface)));
      expect(text).toContain('Needs you');
      expect(text).toContain('Merge (yours)');
      expect(text).not.toContain('High Table');
    });

    test(`an open flag at Safe to merge turns the band amber on ${surface} (AC-41)`, async ($, on) => {
      worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(FULL_ORD_501) } });
      mock.clock(on, { now: NOW });
      await $.session.start(START);
      const drawn = await $.ui.render(band(surface));
      expect(colorOf(textElement(drawn, 'Safe to merge'))).toBe('warning');
      expect(textElement(drawn, '1 flag')).toBeDefined();
    });

    test(`Safe to merge with no flag is green on ${surface}`, async ($, on) => {
      worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(SAFE_CLEAN) } });
      mock.clock(on, { now: NOW });
      await $.session.start(START);
      const drawn = await $.ui.render(band(surface));
      expect(colorOf(textElement(drawn, 'Safe to merge'))).toBe('success');
      expect(textOf(drawn)).not.toContain('flag');
    });

    test(`no snapshot reads "not yet" on ${surface} (AC-42)`, async ($, on) => {
      worldOf(on, { files: { ...ONBOARDED } });
      mock.clock(on, { now: NOW });
      await $.session.start(START);
      const text = textOf(await $.ui.render(band(surface)));
      expect(text).toContain('Not yet.');
      expect(text).toContain('Stage  not yet');
      expect(text).toContain('Ship   not yet');
      expect(text).toContain('cost: not yet');
    });

    test(`a half-written snapshot reads "not yet" and never throws on ${surface}`, async ($, on) => {
      worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: '{"schema":"paqad.hud/2","headl' } });
      mock.clock(on, { now: NOW });
      await $.session.start(START);
      expect(textOf(await $.ui.render(band(surface)))).toContain('Stage  not yet');
    });

    test(`a survey holds the band: paqad draws nothing of its own on ${surface} (AC-44)`, async ($, on) => {
      const survey = { type: 'Text', props: {}, children: [ENGINE_BAND] } as RenderElement;
      worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(FULL_ORD_501) }, band: survey });
      mock.clock(on, { now: NOW });
      await $.session.start(START);
      const drawn = await $.ui.render(band(surface, { hasSurvey: true }));
      expect(drawn).toMatchObject(survey);
      expect(textOf(drawn)).toBe(ENGINE_BAND);
    });

    test(`another mod's band lines stay under paqad's on ${surface}`, async ($, on) => {
      const other = { type: 'Text', props: {}, children: ['another mod'] } as RenderElement;
      worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(FULL_ORD_501) }, band: other });
      mock.clock(on, { now: NOW });
      await $.session.start(START);
      const lines = linesOf(await $.ui.render(band(surface)));
      expect(lines[0]).toContain('paqad');
      expect(lines.at(-1)).toBe('another mod');
    });
  }
});

describe('the terminal band fits its box (AC-43)', () => {
  for (const [columns, maxRows] of [
    [40, 3],
    [71, 12],
    [95, 3],
  ] as const) {
    test(`${columns} columns, ${maxRows} rows`, async ($, on) => {
      worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(FULL_ORD_501) } });
      mock.clock(on, { now: NOW });
      await $.session.start(START);
      const lines = linesOf(await $.ui.render(band('terminal', { bodyColumns: columns, maxRows })));
      expect(lines.length).toBeLessThanOrEqual(maxRows);
      for (const line of lines) expect([...line].length).toBeLessThanOrEqual(columns);
      // The state and the flag count are words, so the band reads with the colour gone.
      expect(lines[0]).toContain('Safe to merge');
      expect(lines[0]).toContain('1 flag');
    });
  }
});

describe('stand-downs: the mod registers nothing (AC-36)', () => {
  test('view off adds no hook at all', { options: { view: false } }, async ($, on) => {
    const world = worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(FULL_ORD_501) } });
    await $.session.start(START);
    expect(world.commands).toEqual([]);
    expect(world.reads).toEqual([]);
    expect(textOf(await $.ui.render(band('terminal')))).not.toContain('paqad');
  });

  const cases = [
    ['Claude Code runs in the cloud', { env: { CLAUDE_CODE_REMOTE: 'true' } }],
    ['PAQAD_DISABLED is set', { env: { PAQAD_DISABLED: '1' } }],
    ['the local config turns paqad off', { extra: { '.paqad/.config': 'paqad_enable=off\n' } }],
    [
      'the team config turns paqad off',
      { extra: { '.paqad/configs/.config.app': 'paqad_enable=false\n' } },
    ],
    ['Claude Code is 2.1.300', { version: { version: '2.1.300', base: '2.1.300' } }],
  ] as const;
  for (const [name, setup] of cases) {
    test(`stands down when ${name}`, async ($, on) => {
      const world = worldOf(on, {
        files: {
          ...ONBOARDED,
          [SNAPSHOT]: fileText(FULL_ORD_501),
          ...('extra' in setup ? setup.extra : {}),
        },
        ...('env' in setup ? { env: setup.env } : {}),
        ...('version' in setup ? { version: setup.version } : {}),
      });
      await $.session.start(START);
      expect(world.commands).toEqual([]);
      expect(world.reads.filter((path) => path.startsWith('.paqad/session'))).toEqual([]);
      for (const surface of SURFACES) {
        expect(textOf(await $.ui.render(band(surface)))).not.toContain('paqad');
      }
    });
  }

  test('a project never onboarded keeps /paqad alone, to say so (AC-38)', async ($, on) => {
    const world = worldOf(on, { files: {} });
    mock.clock(on, { now: NOW });
    await $.session.start(START);
    expect(world.commands).toEqual(['paqad']);
    expect(textOf(await $.ui.render(band('terminal')))).not.toContain('paqad');
    const answer = await $.command.run(command('status'));
    expect(answer.text).toBe('paqad is not active here: this project was never onboarded.');
  });
});

describe('/paqad answers from the snapshot, with no model turn (AC-39)', () => {
  test('each command answers text; cost says not yet', async ($, on) => {
    const world = worldOf(on, {
      files: { ...ONBOARDED, [SNAPSHOT]: fileText(FULL_ORD_501), [RECEIPT]: RECEIPT_TEXT },
    });
    mock.clock(on, { now: NOW });
    await $.session.start(START);
    expect(world.commands).toEqual(['paqad']);
    const answers: Record<string, string> = {};
    for (const args of ['', 'status', 'decisions', 'rules', 'receipt', 'cost']) {
      const result = await $.command.run(command(args));
      expect(typeof result.text).toBe('string');
      answers[args] = result.text ?? '';
    }
    expect(answers['']).toContain('Safe to merge (1 flag)');
    expect(answers.status).toContain('Change: #ORD-501 Add CSV export to the orders page.');
    expect(answers.decisions).toBe('No decision is waiting. 4 resolved.');
    expect(answers.rules).toContain('Near-copies: 1 open.');
    expect(answers.receipt).toBe(RECEIPT_TEXT);
    expect(answers.cost).toContain('not yet');
  });
});

describe('the cost pill and the Cost tab (Part 23, AC-50, AC-53, AC-55)', () => {
  for (const surface of SURFACES) {
    test(`the pill shows a dated estimate and opens the pane on the Cost tab on ${surface}`, async ($, on) => {
      const world = worldOf(on, {
        files: { ...ONBOARDED, [SNAPSHOT]: fileText(FULL_ORD_501_COST) },
      });
      mock.clock(on, { now: NOW });
      await $.session.start(START);
      const mounted = await $.ui.mount({
        plugin: PLUGIN,
        surface,
        component: 'AbovePrompt',
        props: band(surface).props,
      });
      const pill = await mounted.find({ key: 'paqad-open-cost' });
      expect(pill?.text).toBe('1.3M tokens, ~$4.60 estimate, 2026-10-19 prices');
      await mounted.press({ key: 'paqad-open-cost' });
      expect(world.opened).toEqual(['paqad']);
      await mounted.unmount();

      const strings = stringsOf(await $.ui.render(pane(surface)));
      expect(strings).toContain('Cost (shown)');
      expect(strings[1]).toBe(
        'Cost of this change: 1,300,000 tokens, ~$4.60, estimate at API prices (API-equivalent on a Pro or Max plan), prices of 2026-10-19.',
      );
      for (const heading of ['By stage:', 'By expert:']) expect(strings).toContain(heading);
      expect(strings.some((line) => line.startsWith('Chief architect: '))).toBe(true);
      expect(strings.some((line) => line.startsWith('Basis: API-equivalent estimate.'))).toBe(true);
      expect(strings.some((line) => line.startsWith('Not counted: The fast mode premium'))).toBe(
        true,
      );
      for (const line of strings.filter((text) => text.includes('$'))) {
        expect(line).toContain('estimate');
        expect(line).toContain('2026-10-19');
      }
    });

    test(`the Cost tab button keeps the pane on Cost on ${surface}`, async ($, on) => {
      worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(FULL_ORD_501_COST) } });
      mock.clock(on, { now: NOW });
      await $.session.start(START);
      const mounted = await $.ui.mount({
        plugin: PLUGIN,
        surface,
        component: 'Pane',
        requestId: 'paqad',
        props: pane(surface).props,
      });
      await mounted.press({ key: 'paqad-tab-cost' });
      expect((await mounted.find({ key: 'paqad-tab-cost' }))?.text).toBe('Cost (shown)');
      expect(await mounted.find({ text: /^Cost of this change/ })).toBeDefined();
      await mounted.unmount();
    });

    test(`fast lane: the Cost tab shows no expert tokens on ${surface} (AC-53)`, async ($, on) => {
      worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(FAST_ORD_490_COST) } });
      mock.clock(on, { now: NOW });
      await $.session.start(START);
      const strings = stringsOf(await $.ui.render(pane(surface)));
      expect(strings).toContain('By expert: none. The fast lane seats no High Table.');
      expect(strings.join('\n')).not.toContain('Chief architect');
      expect(textOf(await $.ui.render(band(surface)))).not.toContain('High Table');
    });

    test(`another pane id is left to the engine on ${surface}`, async ($, on) => {
      worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(FULL_ORD_501_COST) } });
      mock.clock(on, { now: NOW });
      await $.session.start(START);
      expect(textOf(await $.ui.render(pane(surface, 'other')))).not.toContain('Cost');
    });
  }

  test('/paqad cost prints the total, by stage, by expert and the chief, the basis and what is not counted', async ($, on) => {
    worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(FULL_ORD_501_COST) } });
    mock.clock(on, { now: NOW });
    await $.session.start(START);
    const text = (await $.command.run(command('cost'))).text ?? '';
    for (const part of [
      'Cost of this change: 1,300,000 tokens',
      'By stage:',
      'By expert:',
      'Chief architect: ',
      'Basis: API-equivalent estimate.',
      'Not counted: ',
    ]) {
      expect(text).toContain(part);
    }
  });
});

describe('when the band reads the snapshot again (FR-24)', () => {
  test('after an edit, not after a read', async ($, on) => {
    const world = worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(GRADUATED_ORD_482) } });
    mock.clock(on, { now: NOW });
    await $.session.start(START);
    const reads = () => world.reads.filter((path) => path === SNAPSHOT).length;
    const before = reads();
    await $.tool.call({ tool: 'Read', file_path: '/work/a.ts' } as never);
    expect(reads()).toBe(before);
    world.put(SNAPSHOT, fileText(FULL_ORD_501));
    await $.tool.call({ tool: 'Edit', file_path: '/work/a.ts' } as never);
    expect(reads()).toBe(before + 1);
    expect(linesOf(await $.ui.render(band('terminal')))[0]).toContain('Safe to merge');
  });

  test('after a prompt and at the end of a turn', async ($, on) => {
    const world = worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(GRADUATED_ORD_482) } });
    mock.clock(on, { now: NOW });
    await $.session.start(START);
    world.put(SNAPSHOT, fileText(PAUSED));
    await $.prompt.submit({ text: 'hello' } as never);
    expect(linesOf(await $.ui.render(band('terminal')))[0]).toContain('Paused');
  });

  test('every 1.5 s only while a stage agent runs', async ($, on) => {
    const world = worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(GRADUATED_ORD_482) } });
    const clock = mock.clock(on, { now: NOW });
    await $.session.start(START);
    const reads = () => world.reads.filter((path) => path === SNAPSHOT).length;
    world.agents = [
      { id: 'a1', description: 'planning', type: 'paqad:paqad-planning', status: 'running' },
    ] as never;
    await $.tool.call({ tool: 'Agent', subagent_type: 'paqad:paqad-planning' } as never);
    const armed = reads();
    await clock.advance(1500);
    await clock.settle();
    expect(reads()).toBeGreaterThan(armed);
    world.agents = [];
    await clock.advance(1500);
    await clock.settle();
    const stopped = reads();
    await clock.advance(6000);
    await clock.settle();
    expect(reads()).toBe(stopped);
  });
});
