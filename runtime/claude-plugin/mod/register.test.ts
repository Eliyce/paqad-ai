import type { RenderElement, RenderNode } from 'claude-code';
import { describe, expect, mock, test } from 'claude-code/testing';

import {
  EXPERTS_OFF,
  FAST_ORD_490,
  FAST_ORD_490_COST,
  FULL_ORD_501,
  FULL_ORD_501_COST,
  GRADUATED_ORD_482,
  LATE_TABLE,
  NOW,
  ORD_482_SEQUENCE,
  ORD_501_SEATS,
  ORD_501_SEQUENCE,
  SKIPPED_TABLE,
  ord501At,
  PAUSED,
  RECEIPT_TEXT,
  SAFE_CLEAN,
  STATE_FIXTURES,
  fileText,
  snapshot,
} from './test/fixtures';
import {
  ENGINE_BAND,
  EXPERTS_COMMAND,
  LAST_BLOCK,
  ONBOARDED,
  RECEIPT,
  SESSION_ID,
  SNAPSHOT,
  START,
  band,
  command,
  linesOf,
  pane,
  stringsOf,
  toolGroup,
  toolUse,
  worldOf,
} from './test/world';

const SURFACES = ['terminal', 'desktop'] as const;
const PLUGIN = 'paqad';
const STATES = Object.keys(STATE_FIXTURES) as Array<keyof typeof STATE_FIXTURES>;

const textOf = (node: RenderElement): string => stringsOf(node).join('');

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

    test(`graduated lane: Needs you, Merge stays yours, and the High Table on ${surface}`, async ($, on) => {
      worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(GRADUATED_ORD_482) } });
      mock.clock(on, { now: NOW });
      await $.session.start(START);
      const text = textOf(await $.ui.render(band(surface)));
      expect(text).toContain('Needs you');
      expect(text).toContain('Merge (yours)');
      expect(text).toContain('High Table');
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
      expect(lines[0]).toContain('Safe to merge');
      expect(lines[0]).toContain('1 flag');
    });
  }
});

describe('stand-downs: the mod registers nothing (AC-36)', () => {
  const cases = [
    ['PAQAD_HUD_VIEW is false', { env: { PAQAD_HUD_VIEW: 'false' } }],
    ['the local config turns the HUD off', { extra: { '.paqad/.config': 'hud_view=false\n' } }],
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
      expect(strings.find((line) => line.startsWith('Cost of this change'))).toBe(
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

function drawnLines(node: RenderNode | null | undefined): string[] {
  if (node === null || node === undefined || typeof node === 'string') return [];
  if (node.type === 'Text' || node.type === 'Button') return [stringsOf(node).join('')];
  const children = (node as { children?: readonly RenderNode[] }).children ?? [];
  return children.flatMap((child) => drawnLines(child));
}

function elementOf(node: RenderNode, type: string): RenderElement | undefined {
  if (typeof node === 'string') return undefined;
  if (node.type === type) return node;
  for (const child of (node as { children?: readonly RenderNode[] }).children ?? []) {
    const found = elementOf(child, type);
    if (found) return found;
  }
  return undefined;
}

const tableLineOf = (lines: string[]) => lines.find((line) => line.startsWith('High Table'));
const ENGINE_ROW = { type: 'Text', props: {}, children: ['engine row'] } as RenderElement;
const ROLE_WORDS: Record<string, string> = {
  'product-owner': 'Product owner',
  'application-architect': 'Application architect',
  'user-flow-writer': 'User flow writer',
  'qa-engineer': 'QA engineer',
  'security-auditor': 'Security auditor',
  'db-expert': 'DB expert',
  'performance-analyst': 'Performance analyst',
};

function seatStates(lines: string[]): Record<string, string> {
  const states: Record<string, string> = {};
  for (const [role, words] of Object.entries(ROLE_WORDS)) {
    const line = lines.find((text) => text.includes(` ${words}: `));
    const match = line ? new RegExp(`([○◐●]) ${words}: (seated|writing|done)`).exec(line) : null;
    if (match) states[role] = match[2]!;
  }
  return states;
}

describe('the High Table in the band (AC-56, AC-57)', () => {
  for (const surface of SURFACES) {
    test(`AC-56: the instrument on ORD-482 and ORD-501, never on ORD-490 or with the experts off, on ${surface}`, async ($, on) => {
      const world = worldOf(on, { files: { ...ONBOARDED } });
      mock.clock(on, { now: NOW });
      await $.session.start(START);
      const linesFor = async (raw: Record<string, unknown>) => {
        world.put(SNAPSHOT, fileText(raw));
        await $.tool.call({ tool: 'Bash', command: 'paqad-ai status' } as never);
        return linesOf(await $.ui.render(band(surface)));
      };
      expect(tableLineOf(await linesFor(GRADUATED_ORD_482))).toBe('High Table  ●●●● chief ●');
      expect(tableLineOf(await linesFor(FULL_ORD_501))).toBe('High Table  ●●●●●●● chief ●');
      expect(tableLineOf(await linesFor(FAST_ORD_490))).toBeUndefined();
      const off = await linesFor(EXPERTS_OFF);
      expect(tableLineOf(off)).toBeUndefined();
      const instruments = off.filter((line) => /^(Stage|High Table|Ship)/.test(line));
      expect(instruments.map((line) => line.split(' ')[0])).toEqual(['Stage', 'Ship']);
      expect(tableLineOf(await linesFor(SKIPPED_TABLE))).toBe('High Table skipped');
    });

    test(`AC-57: after the ruling only the dots, plus "1 flag" when flagged, on ${surface}`, async ($, on) => {
      worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(LATE_TABLE) } });
      mock.clock(on, { now: NOW });
      await $.session.start(START);
      const drawn = await $.ui.render(band(surface));
      expect(tableLineOf(linesOf(drawn))).toBe('High Table  ●●●●●●● chief ●  1 flag');
    });

    test(`the High Table label opens the pane on its tab on ${surface}`, async ($, on) => {
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
      await mounted.press({ key: 'paqad-open-table' });
      expect(world.opened).toEqual(['paqad']);
      await mounted.unmount();
      expect(drawnLines(await $.ui.render(pane(surface)))).toContain('High Table (shown)');
    });
  }
});

describe('the live High Table card in the chat (AC-58)', () => {
  for (const surface of SURFACES) {
    test(`AC-58: drawn once over the first experts row, redrawn in place, on ${surface}`, async ($, on) => {
      const world = worldOf(on, {
        files: { ...ONBOARDED, [SNAPSHOT]: fileText(ord501At('seated')) },
        band: ENGINE_ROW,
      });
      mock.clock(on, { now: NOW });
      await $.session.start(START);
      await $.tool.call({ tool: 'Bash', command: EXPERTS_COMMAND, tool_use_id: 'tu-1' } as never);

      const first = linesOf(await $.ui.render(toolUse(surface, 'tu-1', EXPERTS_COMMAND)));
      expect(first[0]).toBe('High Table · 7 seats · 7 seated');
      expect(first).toContain('  ○ Security auditor: seated');
      expect(first.at(-1)).toBe('  ○ Chief architect: not seated yet');

      world.put(SNAPSHOT, fileText(ord501At('writing')));
      await $.tool.call({ tool: 'Bash', command: EXPERTS_COMMAND, tool_use_id: 'tu-2' } as never);
      const again = linesOf(await $.ui.render(toolUse(surface, 'tu-1', EXPERTS_COMMAND)));
      expect(again[0]).toBe('High Table · 7 seats · 7 writing');
      expect(again.some((line) => line.startsWith('  ◐ Security auditor: writing for'))).toBe(true);

      expect(textOf(await $.ui.render(toolUse(surface, 'tu-2', EXPERTS_COMMAND)))).toBe(
        'engine row',
      );
      expect(textOf(await $.ui.render(toolUse(surface, 'tu-3', 'ls -la')))).toBe('engine row');
    });

    test(`after the ruling the card carries the verdict and its counts on ${surface}`, async ($, on) => {
      worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(ord501At('ruled')) } });
      mock.clock(on, { now: NOW });
      await $.session.start(START);
      await $.tool.call({ tool: 'Bash', command: EXPERTS_COMMAND, tool_use_id: 'tu-1' } as never);
      const lines = linesOf(await $.ui.render(toolUse(surface, 'tu-1', EXPERTS_COMMAND)));
      expect(lines[0]).toBe('High Table · 7 seats · the chief architect ruled: proceed');
      expect(lines).toContain(
        '  ● Chief architect: ruled in 2m 00s, verdict: proceed, 28,512 tokens (exact)',
      );
      expect(lines.at(-1)).toBe(
        'Verdict: proceed. 13 findings, 9 accepted, 1 declined, 1 renamed, 1 disagreement, 1 settled before, 1 gap.',
      );
    });

    test(`the fast lane and a table not recorded yet keep the engine's row on ${surface}`, async ($, on) => {
      const world = worldOf(on, {
        files: { ...ONBOARDED, [SNAPSHOT]: fileText(FAST_ORD_490) },
        band: ENGINE_ROW,
      });
      mock.clock(on, { now: NOW });
      await $.session.start(START);
      await $.tool.call({ tool: 'Bash', command: EXPERTS_COMMAND, tool_use_id: 'tu-1' } as never);
      expect(textOf(await $.ui.render(toolUse(surface, 'tu-1', EXPERTS_COMMAND)))).toBe(
        'engine row',
      );
      world.put(SNAPSHOT, fileText(EXPERTS_OFF));
      await $.tool.call({ tool: 'Bash', command: 'paqad-ai status' } as never);
      expect(textOf(await $.ui.render(toolUse(surface, 'tu-1', EXPERTS_COMMAND)))).toBe(
        'engine row',
      );
    });

    test(`a folded run holding an experts call unfolds, and no other does, on ${surface}`, async ($, on) => {
      const world = worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(FULL_ORD_501) } });
      mock.clock(on, { now: NOW });
      await $.session.start(START);
      const expanded = () =>
        (
          world.drawn.filter((d) => d.component === 'ToolGroup').at(-1)?.props as {
            isExpanded?: boolean;
          }
        ).isExpanded;
      await $.ui.render(toolGroup(surface, ['ls', EXPERTS_COMMAND]));
      expect(expanded()).toBe(true);
      await $.ui.render(toolGroup(surface, ['ls', 'cat a.ts']));
      expect(expanded()).toBe(false);
    });
  }
});

describe("the pane's High Table tab (AC-59)", () => {
  for (const surface of SURFACES) {
    test(`AC-59: ORD-501 shows every seat, the rulings, the questions and the 12-line credit on ${surface}`, async ($, on) => {
      worldOf(on, {
        files: { ...ONBOARDED, [SNAPSHOT]: fileText({ ...FULL_ORD_501, verdict: null }) },
      });
      mock.clock(on, { now: NOW });
      await $.session.start(START);
      const drawn = await $.ui.render(pane(surface));
      const lines = drawnLines(drawn);
      expect(lines).toContain('High Table (shown)');
      for (const plan of ORD_501_SEATS) {
        const line = lines.find((text) => text.includes(` ${ROLE_WORDS[plan.role]}: `));
        expect(line, plan.role).toContain(`Why: ${plan.reason}`);
      }
      const text = lines.join('\n');
      for (const part of [
        'Declined: EX-performance-analyst-1. Reason: Streaming the file is out of scope',
        'Renamed: EX-user-flow-writer-1 now reads "Export orders".',
        'Disagreement: Customer email in the export. The chief architect recommends: leave the email out by default',
        'Settled before: Date range limit. Chosen: 90 days at most. Decided on 2026-10-02 in D-01M3Y1RB507QW3K9F2D8MZXN4R',
        'Gap no expert covered: File retention.',
        'Question for you: How long should a generated export file be kept?',
        'Answered from an earlier decision: Which file format should the export use? Source: D-01M39VEJR07QW3K9F2D8MZXN4S.',
        'Who shaped the spec (12 lines):',
      ]) {
        expect(text).toContain(part);
      }
      expect(lines.filter((line) => /^ {2}(FR|NFR|INV)-\d+: /.test(line))).toHaveLength(12);
      const svg = elementOf(drawn, 'Svg');
      if (surface === 'desktop') {
        const props = (svg as { props: { source: string; alt: string } }).props;
        expect(props.source.startsWith('<svg')).toBe(true);
        expect(props.alt).toContain('the chief architect at the centre, ruled: proceed');
        expect(props.alt).toContain('7 seats around it');
      } else {
        expect(svg).toBeUndefined();
        expect(lines).toContain('High Table: ● Chief architect at the centre, 7 seats around it');
      }
    });

    test(`while the disagreement waits, it reads open with the chief's recommendation on ${surface}`, async ($, on) => {
      worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(ord501At('ruled')) } });
      mock.clock(on, { now: NOW });
      await $.session.start(START);
      const drawn = await $.ui.render(pane(surface));
      const line = drawnLines(drawn).find((text) => text.includes('Open disagreement'));
      expect(line).toContain('Open disagreement: Customer email in the export.');
      expect(line).toContain('The chief architect recommends:');
      expect(line).toContain('The choice is yours.');
      expect(
        colorOf(textElement(drawn, '  Open disagreement: Customer email in the export.')),
      ).toBe('warning');
    });

    test(`a seat Button shows that seat's detail on ${surface}`, async ($, on) => {
      worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(FULL_ORD_501) } });
      mock.clock(on, { now: NOW });
      await $.session.start(START);
      const mounted = await $.ui.mount({
        plugin: PLUGIN,
        surface,
        component: 'Pane',
        requestId: 'paqad',
        props: pane(surface).props,
      });
      await mounted.press({ key: 'paqad-tab-table' });
      expect(
        await mounted.find({ text: 'Product owner, a standing seat, always at the table.' }),
      ).toBeDefined();
      await mounted.press({ key: 'paqad-seat-db-expert' });
      expect((await mounted.find({ key: 'paqad-seat-db-expert' }))?.text).toBe('DB expert (shown)');
      expect(
        await mounted.find({ text: 'Budget: 6,000 tokens granted, cut to the ceiling.' }),
      ).toBeDefined();
      await mounted.press({ key: 'paqad-seat-performance-analyst' });
      expect(
        await mounted.find({ text: "Tokens: about 1,900 (estimate, the seat's own count)." }),
      ).toBeDefined();
      await mounted.unmount();
    });

    test(`a seat's track record shows in its detail, and no line without history, on ${surface}`, async ($, on) => {
      worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(FULL_ORD_501) } });
      mock.clock(on, { now: NOW });
      await $.session.start(START);
      const mounted = await $.ui.mount({
        plugin: PLUGIN,
        surface,
        component: 'Pane',
        requestId: 'paqad',
        props: pane(surface).props,
      });
      await mounted.press({ key: 'paqad-tab-table' });
      const record =
        'Track record: on 6 earlier changes, changed the spec on 4, had nothing to add on 1, about 2,300 tokens each.';
      expect(await mounted.find({ text: record })).toBeDefined();
      await mounted.press({ key: 'paqad-seat-db-expert' });
      expect(await mounted.find({ text: /^Track record:/ })).toBeUndefined();
      await mounted.unmount();
    });

    test(`a late seat reads amber in words and the table is credited with no line on ${surface}`, async ($, on) => {
      worldOf(on, {
        files: { ...ONBOARDED, [SNAPSHOT]: fileText({ ...LATE_TABLE, verdict: null }) },
      });
      mock.clock(on, { now: NOW });
      await $.session.start(START);
      const drawn = await $.ui.render(pane(surface));
      const lines = drawnLines(drawn);
      expect(lines.find((line) => line.includes(' Security auditor: '))).toContain(
        'late: its note landed after the spec was frozen',
      );
      const credit =
        'Who shaped the spec: no spec line. The High Table met after the spec was frozen.';
      expect(lines).toContain(credit);
      expect(colorOf(textElement(drawn, credit))).toBe('warning');
    });

    test(`the pane opens on the High Table while seats write, unless a tab was picked, on ${surface}`, async ($, on) => {
      worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(ord501At('writing')) } });
      mock.clock(on, { now: NOW });
      await $.session.start(START);
      const mounted = await $.ui.mount({
        plugin: PLUGIN,
        surface,
        component: 'Pane',
        requestId: 'paqad',
        props: pane(surface).props,
      });
      expect((await mounted.find({ key: 'paqad-tab-table' }))?.text).toBe('High Table (shown)');
      await mounted.press({ key: 'paqad-tab-cost' });
      expect((await mounted.find({ key: 'paqad-tab-cost' }))?.text).toBe('Cost (shown)');
      await mounted.unmount();
    });

    test(`the fast lane's High Table tab says it seats none on ${surface}`, async ($, on) => {
      worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(FAST_ORD_490) } });
      mock.clock(on, { now: NOW });
      await $.session.start(START);
      const mounted = await $.ui.mount({
        plugin: PLUGIN,
        surface,
        component: 'Pane',
        requestId: 'paqad',
        props: pane(surface).props,
      });
      await mounted.press({ key: 'paqad-tab-table' });
      expect(await mounted.find({ text: 'The fast lane seats no High Table.' })).toBeDefined();
      await mounted.unmount();
    });
  }
});

describe('the High Table as it moves (AC-60, AC-61)', () => {
  for (const surface of SURFACES) {
    test(`AC-60: ORD-501's seats go seated, writing, done in order on ${surface}`, async ($, on) => {
      const world = worldOf(on, {
        files: { ...ONBOARDED, [SNAPSHOT]: fileText(ORD_501_SEQUENCE[0]!) },
      });
      mock.clock(on, { now: NOW });
      await $.session.start(START);
      await $.tool.call({ tool: 'Bash', command: EXPERTS_COMMAND, tool_use_id: 'tu-1' } as never);
      const seen: Record<'card' | 'pane', Record<string, string[]>> = { card: {}, pane: {} };
      const note = (where: 'card' | 'pane', states: Record<string, string>) => {
        for (const [role, state] of Object.entries(states)) {
          const list = (seen[where][role] ??= []);
          if (list.at(-1) !== state) list.push(state);
        }
      };
      for (const raw of ORD_501_SEQUENCE) {
        world.put(SNAPSHOT, fileText(raw));
        await $.tool.call({ tool: 'Bash', command: 'paqad-ai status' } as never);
        note(
          'card',
          seatStates(linesOf(await $.ui.render(toolUse(surface, 'tu-1', EXPERTS_COMMAND)))),
        );
        note('pane', seatStates(drawnLines(await $.ui.render(pane(surface)))));
      }
      for (const where of ['card', 'pane'] as const) {
        expect(Object.keys(seen[where])).toHaveLength(7);
        for (const states of Object.values(seen[where])) {
          expect(states).toEqual(['seated', 'writing', 'done']);
        }
      }
    });

    test(`AC-61: ORD-482's four seats write in parallel, tokens land with each note, then only dots on ${surface}`, async ($, on) => {
      const world = worldOf(on, {
        files: { ...ONBOARDED, [SNAPSHOT]: fileText(ORD_482_SEQUENCE[0]!) },
      });
      mock.clock(on, { now: NOW });
      await $.session.start(START);
      await $.tool.call({ tool: 'Bash', command: EXPERTS_COMMAND, tool_use_id: 'tu-1' } as never);
      const look = async (raw: Record<string, unknown>) => {
        world.put(SNAPSHOT, fileText(raw));
        await $.tool.call({ tool: 'Bash', command: 'paqad-ai status' } as never);
        return {
          band: tableLineOf(linesOf(await $.ui.render(band(surface)))),
          card: linesOf(await $.ui.render(toolUse(surface, 'tu-1', EXPERTS_COMMAND))).slice(1, 5),
        };
      };
      const [writing, landing, ruled] = ORD_482_SEQUENCE;
      const first = await look(writing!);
      expect(first.band).toBe('High Table  4 writing  ◐◐◐◐');
      for (const line of first.card) {
        expect(line).toContain('writing for');
        expect(line).not.toContain('tokens');
      }
      const second = await look(landing!);
      expect(second.band).toBe('High Table  2 writing, 2 done  ●◐●◐');
      expect(second.card.filter((line) => line.includes('tokens (exact)'))).toHaveLength(2);
      expect(second.card.find((line) => line.includes('Product owner'))).toContain(
        'done in 1m 39s, 16,424 tokens (exact)',
      );
      const third = await look(ruled!);
      expect(third.band).toBe('High Table  ●●●● chief ●');
      expect(third.card.every((line) => line.includes('tokens (exact)'))).toBe(true);
    });
  }
});

describe('the rule stop answer on tool.check', () => {
  const STOP = {
    rule: 'RL-13',
    title: 'No comments in code',
    file: 'src/x.ts',
    tool_use_id: 'tu_1',
    managed: false,
    at: '2026-10-20T10:00:00.000Z',
    diff: '+ // note',
    token: 'tok',
    used: false,
    session: SESSION_ID,
  };
  const DENY = { decision: 'deny' as const, reason: 'RL-13 blocked the edit' };
  const OVERRIDE_ARGV = [
    'paqad-ai',
    'rules',
    'override',
    '--rule',
    'RL-13',
    '--file',
    'src/x.ts',
    '--token',
    'tok',
    '--tool-use-id',
    'tu_1',
    '--session',
    SESSION_ID,
    '--project-root',
    '/work',
  ];

  async function stopped(
    $: Parameters<Parameters<typeof test>[1]>[0],
    on: Parameters<Parameters<typeof test>[1]>[1],
    record: Record<string, unknown> = STOP,
  ) {
    const world = worldOf(on, {
      files: {
        ...ONBOARDED,
        [SNAPSHOT]: fileText(FULL_ORD_501),
        [LAST_BLOCK]: JSON.stringify(record),
      },
    });
    world.verdict = DENY;
    mock.clock(on, { now: NOW });
    await $.session.start(START);
    return world;
  }

  const check = ($: Parameters<Parameters<typeof test>[1]>[0], toolUseId = 'tu_1', tool = 'Edit') =>
    $.tool.check({ tool, input: { file_path: '/work/src/x.ts' }, tool_use_id: toolUseId });

  test('Allow once runs the one override verb with the token, then allows the call', async ($, on) => {
    const world = await stopped($, on);
    world.answers.push('Allow once, recorded', 'No reason');
    expect((await check($)).decision).toBe('allow');
    expect(world.asked[0]!.options).toEqual([
      'Let Claude fix it',
      'Allow once, recorded',
      'Show the rule',
    ]);
    expect(world.asked[0]!.question).toContain('RL-13 stopped this edit to src/x.ts');
    expect(world.runs).toEqual([{ argv: OVERRIDE_ARGV, cwd: '/work', timeoutMs: 15_000 }]);
  });

  test('a typed reason is passed to the override as one argument', async ($, on) => {
    const world = await stopped($, on);
    world.answers.push('Allow once, recorded', 'needed for the hotfix');
    expect((await check($)).decision).toBe('allow');
    expect(world.runs[0]!.argv).toEqual([...OVERRIDE_ARGV, '--reason=needed for the hotfix']);
  });

  test('a dismissed reason still records the override without one', async ($, on) => {
    const world = await stopped($, on);
    world.answers.push('Allow once, recorded');
    expect((await check($)).decision).toBe('allow');
    expect(world.runs[0]!.argv).toEqual(OVERRIDE_ARGV);
  });

  test('Let Claude fix it, or a dismissed card, keeps the deny and runs nothing', async ($, on) => {
    const world = await stopped($, on);
    world.answers.push('Let Claude fix it');
    expect(await check($)).toEqual(DENY);
    expect(await check($)).toEqual(DENY);
    expect(world.asked).toHaveLength(2);
    expect(world.runs).toEqual([]);
  });

  test('Show the rule asks again with the rule text', async ($, on) => {
    const world = await stopped($, on);
    world.answers.push('Show the rule', 'Let Claude fix it');
    expect(await check($)).toEqual(DENY);
    expect(world.asked[1]!.question).toContain('No comments in code');
    expect(world.asked[1]!.options).toEqual(['Let Claude fix it', 'Allow once, recorded']);
    expect(world.runs).toEqual([]);
  });

  test('a managed stop offers nothing and names the organization', async ($, on) => {
    const world = await stopped($, on, { ...STOP, managed: true });
    expect(await check($)).toEqual(DENY);
    expect(world.asked).toEqual([]);
    expect(world.runs).toEqual([]);
    expect(world.toasts).toEqual(["This rule is enforced by your organization's settings."]);
  });

  test('a stop for another tool call, a used token or another session asks nothing', async ($, on) => {
    const world = await stopped($, on);
    expect(await check($, 'tu_2')).toEqual(DENY);
    world.put(LAST_BLOCK, JSON.stringify({ ...STOP, used: true }));
    expect(await check($)).toEqual(DENY);
    world.put(LAST_BLOCK, JSON.stringify({ ...STOP, session: 'other' }));
    expect(await check($)).toEqual(DENY);
    world.put(LAST_BLOCK, '{not json');
    expect(await check($)).toEqual(DENY);
    expect(world.asked).toEqual([]);
  });

  test('a failed or unstartable override keeps the deny', async ($, on) => {
    const world = await stopped($, on);
    world.run = { exitCode: 1, stdout: '', stderr: 'refused' };
    world.answers.push('Allow once, recorded', 'No reason');
    expect(await check($)).toEqual(DENY);
    world.run = 'reject';
    world.answers.push('Allow once, recorded', 'No reason');
    expect(await check($)).toEqual(DENY);
    expect(world.runs).toHaveLength(2);
    expect(world.toasts).toHaveLength(2);
  });

  test('the next identical call is denied again', async ($, on) => {
    const world = await stopped($, on);
    world.answers.push('Allow once, recorded', 'No reason');
    expect((await check($)).decision).toBe('allow');
    expect(await check($, 'tu_2')).toEqual(DENY);
    expect(world.runs).toHaveLength(1);
  });

  test('a failure beneath the guard keeps the edit denied', async ($, on) => {
    const world = await stopped($, on);
    world.verdict = 'throw';
    expect((await check($)).decision).toBe('deny');
    expect(world.runs).toEqual([]);
  });

  test('an allowed call and a tool outside the edit tools pass through untouched', async ($, on) => {
    const world = await stopped($, on);
    world.verdict = { decision: 'allow' };
    expect(await check($)).toEqual({ decision: 'allow' });
    world.verdict = DENY;
    expect(await check($, 'tu_1', 'Read')).toEqual(DENY);
    expect(world.asked).toEqual([]);
  });
});

const TRUSTED = {
  ...FULL_ORD_501,
  gates: [
    { name: 'code-tests-lint', required: true, strength: 'deterministic', verdict: 'pass' },
    { name: 'review-quality', required: true, strength: 'llm-judged', verdict: 'inconclusive' },
  ],
};

const DELIVERING = {
  ...FULL_ORD_501,
  verdict: null,
  ship: {
    commits: 3,
    commit_decision: null,
    merge_commit: null,
    push: { state: 'pushed', branch: 'feat/ORD-501-csv-export', sha: 'abc', at: 'x' },
    pr: { number: 12, url: null, draft: false, at: 'x' },
    ci: {
      sha: 'abc',
      state: 'pending',
      done: 3,
      total: 7,
      reason: null,
      source: 'deliver',
      at: 'x',
    },
    own: { count: 3, tickets: ['ORD-501'], merges: 0, untagged: 0 },
    inherited: { count: 0, tickets: [], merges: 0, untagged: 0 },
  },
};

async function mountPane(
  $: Parameters<Parameters<typeof test>[1]>[0],
  surface: 'terminal' | 'desktop',
  columns = 90,
) {
  return $.ui.mount({
    plugin: PLUGIN,
    surface,
    component: 'Pane',
    requestId: 'paqad',
    props: { ...pane(surface).props, bodyColumns: columns },
  });
}

describe('the Trust, Ships and Record tabs', () => {
  for (const surface of SURFACES) {
    test(`a landed verdict opens on Trust, gates in words, on ${surface}`, async ($, on) => {
      worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(TRUSTED) } });
      mock.clock(on, { now: NOW });
      await $.session.start(START);
      const drawn = await $.ui.render(pane(surface));
      const lines = drawnLines(drawn);
      expect(lines).toContain('Trust (shown)');
      expect(lines).toContain('Gates ●~  1 of 2 required passed');
      expect(lines).toContain('  ● code-tests-lint  passed');
      expect(lines).toContain('  ~ review-quality  inconclusive');
      expect(colorOf(textElement(drawn, 'passed'))).toBe('success');
      expect(colorOf(textElement(drawn, 'inconclusive'))).toBe('warning');
    });

    test(`a delivery in progress opens on Ships with CI partly done on ${surface}`, async ($, on) => {
      worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(DELIVERING) } });
      mock.clock(on, { now: NOW });
      await $.session.start(START);
      const lines = drawnLines(await $.ui.render(pane(surface)));
      expect(lines).toContain('Ships (shown)');
      expect(lines).toContain('CI           running, 3 of 7 done');
      expect(lines).toContain('Riding along none');
    });

    test(`AC-36: a picked Record tab holds when the verdict lands and a delivery starts on ${surface}`, async ($, on) => {
      const world = worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(FAST_ORD_490) } });
      mock.clock(on, { now: NOW });
      await $.session.start(START);
      const mounted = await mountPane($, surface);
      await mounted.press({ key: 'paqad-tab-record' });
      expect((await mounted.find({ key: 'paqad-tab-record' }))?.text).toBe('Record (shown)');
      for (const next of [TRUSTED, DELIVERING]) {
        world.put(SNAPSHOT, fileText(next));
        await $.tool.call({ tool: 'Bash', command: 'paqad-ai status' } as never);
        expect((await mounted.find({ key: 'paqad-tab-record' }))?.text).toBe('Record (shown)');
      }
      await mounted.unmount();
    });

    test(`AC-37: each new tab names its empty state, and CI never saved reads unknown on ${surface}`, async ($, on) => {
      const bare = snapshot({ active: true, ship: null, rules: { recorded: true, applicable: 1 } });
      const world = worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(bare) } });
      mock.clock(on, { now: NOW });
      await $.session.start(START);
      const mounted = await mountPane($, surface);
      await mounted.press({ key: 'paqad-tab-trust' });
      expect(await mounted.find({ text: 'No gates judged yet.' })).toBeDefined();
      await mounted.press({ key: 'paqad-tab-ships' });
      expect(await mounted.find({ text: 'Nothing pushed yet.' })).toBeDefined();
      await mounted.press({ key: 'paqad-tab-record' });
      expect(await mounted.find({ text: 'No plan recorded yet.' })).toBeDefined();
      world.put(SNAPSHOT, fileText({ ...DELIVERING, ship: { ...DELIVERING.ship, ci: null } }));
      await $.tool.call({ tool: 'Bash', command: 'paqad-ai status' } as never);
      await mounted.press({ key: 'paqad-tab-ships' });
      expect(await mounted.find({ text: 'unknown, never recorded' })).toBeDefined();
      expect(await mounted.find({ text: 'passed' })).toBeUndefined();
      await mounted.unmount();
    });

    test(`below 80 columns the tabs take short labels on ${surface}`, async ($, on) => {
      worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(TRUSTED) } });
      mock.clock(on, { now: NOW });
      await $.session.start(START);
      const wide = await mountPane($, surface, 80);
      expect((await wide.find({ key: 'paqad-tab-table' }))?.text).toBe('High Table');
      await wide.unmount();
      const narrow = await mountPane($, surface, 79);
      expect((await narrow.find({ key: 'paqad-tab-table' }))?.text).toBe('Table');
      expect((await narrow.find({ key: 'paqad-tab-record' }))?.text).toBe('Rec');
      await narrow.unmount();
    });
  }
});

function commandOutput(surface: 'terminal' | 'desktop', args: string, text: string) {
  return {
    component: 'CommandOutput',
    surface,
    requestId: 'out',
    props: { command: 'paqad', args, text, isErrored: false },
  } as never;
}

function askQuestion(surface: 'terminal' | 'desktop', question: string, header = 'Proof') {
  return {
    component: 'AskUserQuestion',
    surface,
    requestId: 'ask',
    props: {
      tool: 'AskUserQuestion',
      questions: [
        {
          question,
          header,
          multiSelect: false,
          options: [
            { label: 'Failing test', description: 'a test that fails first' },
            { label: 'Manual step', description: 'a person checks it' },
          ],
        },
      ],
    },
  } as never;
}

const isEngineCard = (node: RenderNode | null | undefined): boolean =>
  typeof node === 'object' && node !== null && (node as { type?: unknown }).type === 'engine';

const PROOF_QUESTION = 'How should the fix be proven?';
const PROOF_PACKET = '.paqad/decisions/pending/D-01J0.json';

function proofPacket(rows: number): string {
  return JSON.stringify({
    id: 'D-01J0',
    category: 'fix.proof_method',
    title: PROOF_QUESTION,
    options: [
      {
        option_key: 'failing-test',
        label: 'Failing test',
        evidence: {
          findings: Array.from({ length: rows }, (_, index) => `QA finding ${index + 1}`),
        },
      },
      { option_key: 'manual', label: 'Manual step', evidence: {} },
    ],
  });
}

describe('the receipt card and the verdict seal', () => {
  for (const surface of SURFACES) {
    test(`/paqad receipt draws a sealed card on ${surface}`, async ($, on) => {
      worldOf(on, {
        files: { ...ONBOARDED, [SNAPSHOT]: fileText(SAFE_CLEAN), [RECEIPT]: RECEIPT_TEXT },
        band: ENGINE_ROW,
      });
      mock.clock(on, { now: NOW });
      await $.session.start(START);
      const drawn = await $.ui.render(commandOutput(surface, 'receipt', RECEIPT_TEXT));
      const lines = drawnLines(drawn);
      expect(lines.slice(0, 3)).toEqual([
        'paqad receipt',
        'Sealed Safe to merge',
        '▸ paqad · Safe to merge',
      ]);
      expect(colorOf(textElement(drawn, 'Safe to merge'))).toBe('success');
      expect(lines).not.toContain('engine row');
    });

    test(`other /paqad output, and no receipt yet, keep the engine's row on ${surface}`, async ($, on) => {
      worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(SAFE_CLEAN) }, band: ENGINE_ROW });
      mock.clock(on, { now: NOW });
      await $.session.start(START);
      for (const [args, text] of [
        ['status', 'Safe to merge.'],
        ['receipt', 'No receipt yet. paqad writes one at the end of each turn.'],
      ] as const) {
        expect(drawnLines(await $.ui.render(commandOutput(surface, args, text)))).toEqual([
          'engine row',
        ]);
      }
    });
  }

  test('AC-38: the toast fires once per verdict across snapshot rebuilds', async ($, on) => {
    const world = worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(FAST_ORD_490) } });
    mock.clock(on, { now: NOW });
    await $.session.start(START);
    expect(world.toasts).toEqual([]);
    world.put(SNAPSHOT, fileText(SAFE_CLEAN));
    await $.tool.call({ tool: 'Bash', command: 'paqad-ai status' } as never);
    for (const generated of ['2026-10-18T09:01:00.000Z', '2026-10-18T09:02:00.000Z']) {
      world.put(SNAPSHOT, fileText({ ...SAFE_CLEAN, generated_at: generated }));
      await $.tool.call({ tool: 'Bash', command: 'paqad-ai status' } as never);
    }
    expect(world.toasts).toEqual([
      'paqad sealed the receipt: Safe to merge. /paqad receipt shows why.',
    ]);
  });

  test('a verdict already there when the session starts is not toasted again', async ($, on) => {
    const world = worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(SAFE_CLEAN) } });
    mock.clock(on, { now: NOW });
    await $.session.start(START);
    await $.tool.call({ tool: 'Bash', command: 'paqad-ai status' } as never);
    expect(world.toasts).toEqual([]);
  });
});

describe('evidence above a decision question', () => {
  for (const surface of SURFACES) {
    test(`AC-39: a 60-row packet fills the host row cap with a "+N more" line above the engine card on ${surface}`, async ($, on) => {
      worldOf(on, {
        files: {
          ...ONBOARDED,
          [SNAPSHOT]: fileText(GRADUATED_ORD_482),
          [PROOF_PACKET]: proofPacket(60),
        },
        band: ENGINE_ROW,
      });
      mock.clock(on, { now: NOW });
      await $.session.start(START);
      const drawn = await $.ui.render(askQuestion(surface, PROOF_QUESTION));
      const lines = drawnLines(drawn);
      const cap = surface === 'terminal' ? 12 : 48;
      expect(lines[0]).toBe('Failing test: QA finding 1');
      expect(lines.filter((line) => line.startsWith('Failing test: QA finding'))).toHaveLength(
        cap - 1,
      );
      expect(lines.at(-1)).toBe(`+${60 - cap + 1} more`);
      expect(lines).toHaveLength(cap);
      const children = (drawn as { children?: readonly RenderNode[] }).children ?? [];
      expect(isEngineCard(children.at(-1))).toBe(true);
    });

    test(`AC-40: a missing or unreadable packet, or one with no evidence, leaves the question alone on ${surface}`, async ($, on) => {
      const world = worldOf(on, {
        files: { ...ONBOARDED, [SNAPSHOT]: fileText(GRADUATED_ORD_482) },
        band: ENGINE_ROW,
      });
      mock.clock(on, { now: NOW });
      await $.session.start(START);
      for (const text of [null, '{broken', proofPacket(0)]) {
        if (text === null) world.remove(PROOF_PACKET);
        else world.put(PROOF_PACKET, text);
        expect(isEngineCard(await $.ui.render(askQuestion(surface, PROOF_QUESTION)))).toBe(true);
      }
    });

    test(`paqad's own questions and unrelated ones get no evidence on ${surface}`, async ($, on) => {
      worldOf(on, {
        files: {
          ...ONBOARDED,
          [SNAPSHOT]: fileText(GRADUATED_ORD_482),
          [PROOF_PACKET]: proofPacket(3),
        },
        band: ENGINE_ROW,
      });
      mock.clock(on, { now: NOW });
      await $.session.start(START);
      for (const input of [
        askQuestion(surface, PROOF_QUESTION, 'Rule stop'),
        askQuestion(surface, 'Which colour do you like?'),
      ]) {
        expect(isEngineCard(await $.ui.render(input))).toBe(true);
      }
    });
  }
});
