import type { RenderElement, RenderNode } from 'claude-code';
import { describe, expect, mock, test } from 'claude-code/testing';

import { ANSWER_TOAST, TASK_LIST_SENTENCES, UPDATE_PLAN_TOOL, recordTime } from './desktop-view';
import { ALLOW_ONCE_STALE_CLI } from './model';
import {
  EXPERTS_OFF,
  FAST_ORD_490,
  FAST_ORD_490_COST,
  FULL_ORD_501,
  FULL_ORD_501_COST,
  FULL_ORD_501_PROOF,
  GRADUATED_ORD_482,
  LATE_TABLE,
  NOW,
  OTHER_WORKFLOW,
  ORD_482_SEQUENCE,
  ORD_501_SEATS,
  ORD_501_SEQUENCE,
  SKIPPED_TABLE,
  ord501At,
  PAUSED,
  RECEIPT_TEXT,
  SAFE_CLEAN,
  SCENE_FIXTURES,
  STATE_FIXTURES,
  fileText,
  snapshot,
} from './test/fixtures';
import {
  ENGINE_BAND,
  EXPERTS_COMMAND,
  HEARTBEAT,
  LAST_BLOCK,
  ONBOARDED,
  OVERRIDE_RECORDED,
  RECEIPT,
  SESSION_ID,
  SNAPSHOT,
  START,
  TAKEN,
  band,
  command,
  linesOf,
  pane,
  stringsOf,
  toolGroup,
  toolUse,
  worldOf,
  type World,
} from './test/world';

const SURFACES = ['terminal', 'desktop'] as const;
const TERMINAL = ['terminal'] as const;
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

function cardOf(node: RenderNode | null | undefined): RenderElement | undefined {
  if (node === null || node === undefined || typeof node === 'string') return undefined;
  if ((node as { props?: { borderStyle?: unknown } }).props?.borderStyle === 'round') {
    return node as RenderElement;
  }
  for (const child of (node as { children?: readonly RenderNode[] }).children ?? []) {
    const found = cardOf(child);
    if (found) return found;
  }
  return undefined;
}

const BORDER: Record<string, string | null | undefined> = {
  Ready: null,
  Working: 'suggestion',
  'Branch warning': 'warning',
  'Needs you': 'permission',
  Inconclusive: 'warning',
  'Safe to merge': 'success',
  'Needs your attention': 'error',
  Paused: null,
};

describe('AC-30: on the terminal the band is one card in the tone of its state', () => {
  for (const surface of TERMINAL) {
    for (const state of STATES) {
      test(`${state} on ${surface}`, async ($, on) => {
        worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(STATE_FIXTURES[state]) } });
        mock.clock(on, { now: NOW });
        await $.session.start(START);
        const card = cardOf(await $.ui.render(band(surface)));
        if (BORDER[state] === null) {
          expect(card).toBeUndefined();
          return;
        }
        expect(card).toBeDefined();
        expect((card as { props: { borderColor?: unknown } }).props.borderColor).toBe(
          BORDER[state],
        );
        expect(textOf(card!)).toStartWith('paqad');
      });
    }
  }
});

describe('the band on each fixture change', () => {
  for (const surface of TERMINAL) {
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
        if (fixture === PAUSED) {
          expect(await mounted.find({ key: 'paqad-status-entry' })).toBeDefined();
        } else {
          expect(await mounted.find({ key: 'paqad-brand' })).toBeDefined();
          expect(await mounted.find({ key: 'paqad-minimise' })).toBeDefined();
        }
        await mounted.unmount();
      }
    });

    test(`fast lane: eight STAGE cells, Spec not required, no HIGH TABLE on ${surface}`, async ($, on) => {
      worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(FAST_ORD_490) } });
      mock.clock(on, { now: NOW });
      await $.session.start(START);
      const text = textOf(await $.ui.render(band(surface, { bodyColumns: 120 })));
      for (const label of [
        'Intake',
        'Plan',
        'Spec',
        'Build',
        'Review',
        'Checks',
        'Docs',
        'Deliver',
      ]) {
        expect(text).toContain(label);
      }
      expect(text).toContain('STAGE');
      expect(text).toContain('Build · 2:00');
      expect(text).toContain('SHIP');
      expect(text).not.toContain('HIGH TABLE');
    });

    test(`graduated lane: Needs you for the waiting decision, and the HIGH TABLE done on ${surface}`, async ($, on) => {
      worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(GRADUATED_ORD_482) } });
      mock.clock(on, { now: NOW });
      await $.session.start(START);
      const text = textOf(await $.ui.render(band(surface, { bodyColumns: 120 })));
      expect(text).toContain('1 decision is waiting for you');
      expect(text).toContain('HIGH TABLE');
      expect(text).toContain('spec approved');
    });

    test(`an open flag at Safe to merge turns the band amber on ${surface}`, async ($, on) => {
      worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(FULL_ORD_501) } });
      mock.clock(on, { now: NOW });
      await $.session.start(START);
      const drawn = await $.ui.render(band(surface));
      expect(colorOf(textElement(drawn, 'Safe to merge'))).toBe('success');
      expect(colorOf(textElement(drawn, '1 flag'))).toBe('warning');
      expect((cardOf(drawn) as { props: { borderColor?: unknown } }).props.borderColor).toBe(
        'warning',
      );
    });

    test(`Safe to merge with no flag is green on ${surface}`, async ($, on) => {
      worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(SAFE_CLEAN) } });
      mock.clock(on, { now: NOW });
      await $.session.start(START);
      const drawn = await $.ui.render(band(surface));
      expect((cardOf(drawn) as { props: { borderColor?: unknown } }).props.borderColor).toBe(
        'success',
      );
      expect(textOf(drawn)).not.toContain('flag');
    });

    test(`no snapshot yet shows the idle line, never an empty or stale card, on ${surface}`, async ($, on) => {
      worldOf(on, { files: { ...ONBOARDED } });
      mock.clock(on, { now: NOW });
      await $.session.start(START);
      const text = textOf(await $.ui.render(band(surface)));
      expect(text).toContain('paqad');
      expect(text).toContain('Getting ready');
      expect(text).not.toContain('no change in progress');
      expect(text).not.toContain('STAGE');
    });

    test(`a half-written snapshot shows the idle line and never throws on ${surface}`, async ($, on) => {
      worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: '{"schema":"paqad.hud/3","headl' } });
      mock.clock(on, { now: NOW });
      await $.session.start(START);
      const text = textOf(await $.ui.render(band(surface)));
      expect(text).toContain('Getting ready');
      expect(text).toContain('HUD data unavailable');
      expect(text).not.toContain('Safe to merge');
    });
  }

  for (const surface of SURFACES) {
    test(`a survey holds the band: paqad draws nothing of its own on ${surface}`, async ($, on) => {
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
      expect(lines[0]).toStartWith('paqad');
      expect(lines.at(-1)).toBe('another mod');
    });
  }
});

const DONE_WORDS = 'Done';

const ALL_GREEN = {
  ...FULL_ORD_501,
  headline: { text: DONE_WORDS, tone: 'good', row: 16, word: 'Done', rung: 'done' },
  rung: 'done',
  flags: [],
  ship: {
    commits: 2,
    push: { state: 'pushed', branch: 'feat/x', sha: 'aaa' },
    pr: { number: 12, url: 'https://example.test/pull/12', draft: false, head_sha: 'aaa' },
    pr_state: 'open',
    ci: { sha: 'aaa', state: 'pass', done: 6, total: 6, reason: null, source: 'stop-check' },
    commit_list: [],
    inherited_count: 0,
    all_green: true,
    merged: false,
  },
};

function elementsOf(node: RenderNode | null | undefined, type: string): RenderElement[] {
  if (node === null || node === undefined || typeof node === 'string') return [];
  const own = node.type === type ? [node as RenderElement] : [];
  return [
    ...own,
    ...((node as { children?: readonly RenderNode[] }).children ?? []).flatMap((child) =>
      elementsOf(child, type),
    ),
  ];
}

describe('the ship rail on each surface', () => {
  test('the terminal draws marks and never an Svg; Desktop draws the rail Svg with words', async ($, on) => {
    worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(ALL_GREEN) } });
    mock.clock(on, { now: NOW });
    await $.session.start(START);
    const terminal = await $.ui.render(band('terminal', { bodyColumns: 120 }));
    expect(elementsOf(terminal, 'Svg')).toEqual([]);
    expect(textOf(terminal)).toContain('CI · 6 of 6 green');
    expect(textOf(terminal)).not.toContain('Merge');
    const desktop = await $.ui.render(band('desktop', { bodyColumns: 93 }));
    const svgs = elementsOf(desktop, 'Svg');
    expect(svgs).toHaveLength(1);
    const props = (svgs[0] as { props: { alt?: string; width?: unknown; height?: unknown } }).props;
    expect(props.alt).toMatch(/^Done\. Stage .*Delivery 6 of 6 checks green\.$/);
    expect(props.width).toBeUndefined();
    expect(props.height).toBeUndefined();
  });

  test('the all-green toast fires once per change and head across rebuilds and re-renders', async ($, on) => {
    const world = worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(ALL_GREEN) } });
    mock.clock(on, { now: NOW });
    await $.session.start(START);
    for (let index = 0; index < 10; index += 1) {
      world.put(
        SNAPSHOT,
        fileText({ ...ALL_GREEN, generated_at: `2026-10-18T09:00:${10 + index}.000Z` }),
      );
      await $.tool.call({ tool: 'Edit', file_path: '/work/a.ts' } as never);
      await $.ui.render(band('terminal'));
    }
    const green = world.toasts.filter((text) => text === DONE_WORDS);
    expect(green).toHaveLength(1);
    const card = cardOf(await $.ui.render(band('terminal', { bodyColumns: 120 })));
    expect((card as { props: { borderColor?: unknown } }).props.borderColor).toBe('success');
  });
});

const QUESTION = {
  ...OTHER_WORKFLOW,
  workflow: {
    name: 'project-question',
    started_at: '2026-10-18T08:50:00.000Z',
    tokens: 84000,
    usd: 0.05,
    unpriced: [],
  },
};

describe('other workflows get one status entry and no band', () => {
  for (const surface of TERMINAL) {
    test(`a question shows one row with its tokens, and the running time while a turn is in flight, on ${surface}`, async ($, on) => {
      const world = worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(QUESTION) } });
      const clock = mock.clock(on, { now: NOW });
      await $.session.start(START);
      const idle = await $.ui.render(band(surface));
      expect(cardOf(idle)).toBeUndefined();
      expect(linesOf(idle)).toEqual(['paqad · question · 84K tokens · ~$0.05']);
      await $.prompt.submit({ text: 'what is this?' } as never);
      await clock.advance(42_000);
      await clock.settle();
      expect(linesOf(await $.ui.render(band(surface)))[0]).toBe(
        'paqad · question · running 0:42 · 84K tokens · ~$0.05',
      );
      await $.turn.complete({ text: '' } as never);
      expect(linesOf(await $.ui.render(band(surface)))[0]).toBe(
        'paqad · question · 84K tokens · ~$0.05',
      );
      const mounted = await $.ui.mount({
        plugin: PLUGIN,
        surface,
        component: 'AbovePrompt',
        props: band(surface).props,
      });
      await mounted.press({ key: 'paqad-status-entry' });
      expect(world.opened.at(-1)).toBe('paqad');
      await mounted.unmount();
    });
  }

  for (const surface of SURFACES) {
    test(`no workflow draws nothing at all on ${surface}`, async ($, on) => {
      worldOf(on, {
        files: { ...ONBOARDED, [SNAPSHOT]: fileText({ ...QUESTION, route: 'no-workflow' }) },
      });
      mock.clock(on, { now: NOW });
      await $.session.start(START);
      expect(textOf(await $.ui.render(band(surface)))).not.toContain('paqad');
    });
  }
});

async function mountBand(
  $: Parameters<Parameters<typeof test>[1]>[0],
  surface: 'terminal' | 'desktop',
) {
  return $.ui.mount({
    plugin: PLUGIN,
    surface,
    component: 'AbovePrompt',
    props: band(surface, { bodyColumns: 120 }).props,
  });
}

describe('minimise, close and hide', () => {
  for (const surface of TERMINAL) {
    test(`minimise keeps one line across sessions and restore brings the card back on ${surface}`, async ($, on) => {
      const world = worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(FULL_ORD_501) } });
      mock.clock(on, { now: NOW });
      await $.session.start(START);
      const mounted = await mountBand($, surface);
      const minimise = await mounted.find({ key: 'paqad-minimise' });
      expect(minimise?.text).toBe('– Minimise');
      await mounted.press({ key: 'paqad-minimise' });
      await mounted.unmount();
      expect(world.store.get('band.minimised')).toBe(true);
      const short = await $.ui.render(band(surface, { bodyColumns: 120 }));
      expect(cardOf(short)).toBeUndefined();
      expect(textOf(short)).toContain('+ Restore');
      await $.session.start(START);
      expect(cardOf(await $.ui.render(band(surface, { bodyColumns: 120 })))).toBeUndefined();
      const again = await mountBand($, surface);
      await again.press({ key: 'paqad-restore' });
      await again.unmount();
      expect(world.store.has('band.minimised')).toBe(false);
      expect(cardOf(await $.ui.render(band(surface, { bodyColumns: 120 })))).toBeDefined();
    });

    test(`close asks, Close for now lasts the session, Hide always lasts in this project only on ${surface}`, async ($, on) => {
      const world = worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(FULL_ORD_501) } });
      mock.clock(on, { now: NOW });
      await $.session.start(START);
      world.answers.push('Close for now');
      let mounted = await mountBand($, surface);
      await mounted.press({ key: 'paqad-close' });
      await mounted.unmount();
      expect(world.asked.at(-1)).toMatchObject({ options: ['Close for now', 'Hide always'] });
      expect(world.asked.at(-1)!.question).toStartWith('Close the paqad band?');
      expect(textOf(await $.ui.render(band(surface)))).toContain(
        'Closed for this session · /paqad show',
      );
      await $.session.start(START);
      expect(cardOf(await $.ui.render(band(surface, { bodyColumns: 120 })))).toBeDefined();
      world.answers.push('Hide always');
      mounted = await mountBand($, surface);
      await mounted.press({ key: 'paqad-close' });
      await mounted.unmount();
      expect(world.store.get('band.hidden:/work')).toBe(true);
      await $.session.start(START);
      expect(textOf(await $.ui.render(band(surface)))).toContain('Hidden always · /paqad show');
      const reopen = await mountBand($, surface);
      await reopen.press({ key: 'paqad-reopen' });
      await reopen.unmount();
      expect(world.store.has('band.hidden:/work')).toBe(false);
      expect(cardOf(await $.ui.render(band(surface, { bodyColumns: 120 })))).toBeDefined();
    });

    test(`Hide always in another project leaves this band showing on ${surface}`, async ($, on) => {
      const store = new Map<string, unknown>([['band.hidden:/elsewhere', true]]);
      worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(FULL_ORD_501) }, store });
      mock.clock(on, { now: NOW });
      await $.session.start(START);
      expect(cardOf(await $.ui.render(band(surface, { bodyColumns: 120 })))).toBeDefined();
    });

    test(`a dismissed close question changes nothing on ${surface}`, async ($, on) => {
      const world = worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(FULL_ORD_501) } });
      mock.clock(on, { now: NOW });
      await $.session.start(START);
      world.answers.push(null);
      const mounted = await mountBand($, surface);
      await mounted.press({ key: 'paqad-close' });
      await mounted.unmount();
      expect([...world.store.keys()].filter((key) => key.startsWith('band.'))).toEqual([]);
      expect(cardOf(await $.ui.render(band(surface, { bodyColumns: 120 })))).toBeDefined();
    });

    test(`a pending decision turns the closed line amber, and pressing it brings the band back on ${surface}`, async ($, on) => {
      const store = new Map<string, unknown>([
        ['band.hidden:/work', true],
        ['band.minimised', true],
      ]);
      const world = worldOf(on, {
        files: { ...ONBOARDED, [SNAPSHOT]: fileText(GRADUATED_ORD_482) },
        store,
      });
      mock.clock(on, { now: NOW });
      await $.session.start(START);
      const drawn = await $.ui.render(band(surface));
      expect(textOf(drawn)).toBe('paqad · Needs you ▸');
      expect(colorOf(textElement(drawn, 'paqad · Needs you ▸'))).toBe('permission');
      const mounted = await mountBand($, surface);
      await mounted.press({ key: 'paqad-needs-you' });
      await mounted.unmount();
      expect([...world.store.keys()].filter((key) => key.startsWith('band.'))).toEqual([]);
      expect(cardOf(await $.ui.render(band(surface, { bodyColumns: 120 })))).toBeDefined();
    });

    test(`/paqad show clears minimise, close and hide and says so on ${surface}`, async ($, on) => {
      const store = new Map<string, unknown>([
        ['band.hidden:/work', true],
        ['band.minimised', true],
      ]);
      const world = worldOf(on, {
        files: { ...ONBOARDED, [SNAPSHOT]: fileText(FULL_ORD_501) },
        store,
      });
      mock.clock(on, { now: NOW });
      await $.session.start(START);
      expect(await $.command.run(command('show'))).toEqual({ text: 'The paqad band is back.' });
      expect([...world.store.keys()].filter((key) => key.startsWith('band.'))).toEqual([]);
      expect(cardOf(await $.ui.render(band(surface, { bodyColumns: 120 })))).toBeDefined();
    });
  }
});

describe('/paqad decisions lists every packet in the repo', () => {
  test('packets of other changes and unstamped ones are listed, labelled in this repo', async ($, on) => {
    worldOf(on, {
      files: {
        ...ONBOARDED,
        [SNAPSHOT]: fileText(FULL_ORD_501),
        '.paqad/decisions/pending/D-01OTHER.json': JSON.stringify({
          id: 'D-01OTHER',
          category: 'ux-pattern',
          title: 'Which layout?',
          change: 'another-change',
        }),
        '.paqad/decisions/pending/D-02LOOSE.json': JSON.stringify({
          id: 'D-02LOOSE',
          category: 'create-vs-reuse',
          title: 'Reuse it?',
        }),
      },
    });
    mock.clock(on, { now: NOW });
    await $.session.start(START);
    expect(await $.command.run(command('decisions'))).toEqual({
      text: [
        '2 decisions waiting in this repo. 4 resolved for this change.',
        '  D-01OTHER (ux-pattern): Which layout?',
        '  D-02LOOSE (create-vs-reuse): Reuse it?',
      ].join('\n'),
    });
  });
});

describe('the paqad Ledger', () => {
  for (const surface of SURFACES) {
    if (surface === 'terminal')
      test(`opens titled paqad Ledger, with its subtitle, the five tabs and Trust shown on ${surface}`, async ($, on) => {
        const world = worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(FULL_ORD_501) } });
        mock.clock(on, { now: NOW });
        await $.session.start(START);
        const lines = drawnLines(await $.ui.render(pane(surface)));
        expect(lines[0]).toBe('what happened, with proof');
        expect(lines.slice(1, 6)).toEqual([
          'Trust (shown)',
          'High Table',
          'Ships',
          'Record',
          'Cost',
        ]);
        expect(world.opened).toEqual(['paqad']);
      });

    if (surface === 'terminal') {
      test(`the brand and the Proof Button open the Ledger on Trust, and High Table names who shaped the spec, on ${surface}`, async ($, on) => {
        const store = new Map<string, unknown>([['ledger.autoOpened', ['dir-ord-501']]]);
        const raw = {
          ...FULL_ORD_501,
          change: { ...(FULL_ORD_501.change as object), dir: 'dir-ord-501' },
        };
        const world = worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(raw) }, store });
        mock.clock(on, { now: NOW });
        await $.session.start(START);
        expect(world.opened).toEqual([]);
        for (const key of ['paqad-proof', 'paqad-brand']) {
          const mounted = await mountBand($, surface);
          await mounted.press({ key });
          await mounted.unmount();
          expect(drawnLines(await $.ui.render(pane(surface)))).toContain('Trust (shown)');
          const closer = await mountBand($, surface);
          await closer.press({ key });
          await closer.unmount();
        }
        expect(world.opened).toEqual(['paqad', 'paqad']);
        expect(world.closedPanes).toEqual(['paqad', 'paqad']);
        expect(drawnLines(await paneOn($, surface, 'table'))).toContain(
          'Who shaped the spec (12 lines):',
        );
      });

      test(`the same target closes the Ledger, another switches its tab, a double press opens then closes, on ${surface}`, async ($, on) => {
        const store = new Map<string, unknown>([['ledger.autoOpened', ['dir-ord-501']]]);
        const raw = {
          ...FULL_ORD_501,
          change: { ...(FULL_ORD_501.change as object), dir: 'dir-ord-501' },
        };
        const world = worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(raw) }, store });
        mock.clock(on, { now: NOW });
        await $.session.start(START);
        const mounted = await mountBand($, surface);
        await mounted.press({ key: 'paqad-open-ship' });
        await mounted.press({ key: 'paqad-open-stage' });
        expect(world.closedPanes).toEqual([]);
        expect(drawnLines(await $.ui.render(pane(surface)))).toContain('Record (shown)');
        await mounted.press({ key: 'paqad-open-stage' });
        expect(world.closedPanes).toEqual(['paqad']);
        await mounted.press({ key: 'paqad-flags' });
        await mounted.press({ key: 'paqad-flags' });
        await mounted.unmount();
        expect(world.opened).toEqual(['paqad', 'paqad', 'paqad']);
        expect(world.closedPanes).toEqual(['paqad', 'paqad']);
      });
    }

    test(`auto-opens once per change, never again across sessions, and keeps 50 changes at most on ${surface}`, async ($, on) => {
      const old = Array.from({ length: 50 }, (_, index) => `dir-${index}`);
      const store = new Map<string, unknown>([['ledger.autoOpened', old]]);
      const raw = {
        ...FULL_ORD_501,
        change: { ...(FULL_ORD_501.change as object), dir: 'dir-new' },
      };
      const world = worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(raw) }, store });
      mock.clock(on, { now: NOW });
      await $.session.start(START);
      expect(world.opened).toEqual(['paqad']);
      const kept = world.store.get('ledger.autoOpened') as string[];
      expect(kept).toHaveLength(50);
      expect(kept.at(-1)).toBe('dir-new');
      expect(kept).not.toContain('dir-0');
      world.put(SNAPSHOT, fileText({ ...raw, generated_at: '2026-10-18T09:00:30.000Z' }));
      await $.tool.call({ tool: 'Edit', file_path: '/work/a.ts' } as never);
      await $.session.start(START);
      expect(world.opened).toEqual(['paqad']);
    });
  }
});

const DESKTOP_START = { ...START, surface: 'desktop' as const };

function everyElement(node: RenderNode | null | undefined): RenderElement[] {
  if (node === null || node === undefined || typeof node === 'string') return [];
  const children = (node as { children?: readonly RenderNode[] }).children ?? [];
  return [node as RenderElement, ...children.flatMap(everyElement)];
}

const propsOf = (node: RenderElement): Record<string, unknown> =>
  (node as { props?: Record<string, unknown> }).props ?? {};

const keyOf = (node: RenderElement): unknown =>
  (node as { key?: unknown }).key ?? propsOf(node).key;

function lightOf(node: RenderNode): unknown {
  const dot = everyElement(node).find(
    (element) =>
      element.type === 'Text' &&
      ((element as { children?: readonly RenderNode[] }).children ?? []).every(
        (child) => typeof child === 'string',
      ) &&
      stringsOf(element).join('').startsWith('●'),
  );
  return dot ? propsOf(dot).color : undefined;
}

const buttonKeys = (node: RenderNode): unknown[] =>
  everyElement(node)
    .filter((element) => element.type === 'Button')
    .map(keyOf);

async function mountDesktop(
  $: Parameters<Parameters<typeof test>[1]>[0],
  props: Partial<Parameters<typeof band>[1]> = {},
) {
  return $.ui.mount({
    plugin: PLUGIN,
    surface: 'desktop',
    component: 'AbovePrompt',
    props: band('desktop', props).props,
  });
}

const QUIET_501 = {
  ...FULL_ORD_501_COST,
  change: { ...(FULL_ORD_501_COST.change as object), dir: 'dir-ord-501' },
};
const QUIET_STORE = () => new Map<string, unknown>([['ledger.autoOpened', ['dir-ord-501']]]);

describe('the Desktop band', () => {
  test('AC-7, AC-9: draws the card with its identity, headline and strip, and no hotkey, label, border or tint', async ($, on) => {
    worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(QUIET_501) }, store: QUIET_STORE() });
    mock.clock(on, { now: NOW });
    await $.session.start(DESKTOP_START);
    const drawn = await $.ui.render(band('desktop', { bodyColumns: 93 }));
    const text = textOf(drawn);
    expect(text).toStartWith(
      'paqad   Feature development  ·  Full lane  ·  ORD-501  ·  1.3M tokens · ~$4.60',
    );
    expect(text).toContain('Safe to merge');
    const elements = everyElement(drawn);
    const svgs = elements.filter((element) => element.type === 'Svg');
    expect(svgs).toHaveLength(1);
    expect(String(propsOf(svgs[0]!).alt)).toStartWith('Safe to merge');
    expect(propsOf(svgs[0]!).width).toBeUndefined();
    expect(propsOf(svgs[0]!).isInteractive).toBeUndefined();
    expect(buttonKeys(drawn)).toEqual([
      'paqad-flags',
      'paqad-ledger',
      'paqad-minimise',
      'paqad-close',
    ]);
    for (const element of elements) {
      const props = propsOf(element);
      expect(props.hotkey).toBeUndefined();
      expect(props.role).toBeUndefined();
      expect(props.borderStyle).toBeUndefined();
      expect(props.backgroundColor).toBeUndefined();
    }
  });

  test('AC-5: an unreadable record says so in coral and never reads idle', async ($, on) => {
    worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: '{"schema":"paqad.hud/3","headl' } });
    mock.clock(on, { now: NOW });
    await $.session.start(DESKTOP_START);
    const drawn = await $.ui.render(band('desktop'));
    expect(textOf(drawn)).toBe("paqadLedger−×● paqad cannot read this session's record");
    expect(lightOf(drawn)).toBe('#F37748');
    expect(buttonKeys(drawn)).toEqual(['paqad-ledger', 'paqad-minimise', 'paqad-close']);
    for (const element of everyElement(drawn)) {
      const props = propsOf(element);
      expect(props.hotkey).toBeUndefined();
      expect(props.role).toBeUndefined();
    }
  });

  test('AC-5: the unreadable band opens the Ledger, whose Trust tab gives the reason', async ($, on) => {
    const world = worldOf(on, {
      files: { ...ONBOARDED, [SNAPSHOT]: '{"schema":"paqad.hud/3","headl' },
    });
    mock.clock(on, { now: NOW });
    await $.session.start(DESKTOP_START);
    const mounted = await mountDesktop($);
    await mounted.press({ key: 'paqad-ledger' });
    await mounted.unmount();
    expect(world.opened).toEqual(['paqad']);
    const trust = await $.ui.render(pane('desktop'));
    expectDesktopSafe(trust);
    expect(drawnLines(trust)).toContain('The snapshot file is not valid.');
  });

  test('AC-5: a session id that cannot be read says the same', async ($, on) => {
    worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(FULL_ORD_501) }, sessionId: null });
    mock.clock(on, { now: NOW });
    await $.session.start(DESKTOP_START);
    expect(textOf(await $.ui.render(band('desktop')))).toContain(
      "paqad cannot read this session's record",
    );
  });

  test('AC-6: draws Ready before the first snapshot, and nothing on the feature route until a change opens', async ($, on) => {
    const world = worldOf(on, { files: { ...ONBOARDED } });
    mock.clock(on, { now: NOW });
    await $.session.start(DESKTOP_START);
    expect(textOf(await $.ui.render(band('desktop')))).toBe('paqad   Ready');
    world.put(SNAPSHOT, fileText(snapshot({ route: 'feature-development' })));
    await $.tool.call({ tool: 'Edit', file_path: '/work/a.ts' } as never);
    expect(textOf(await $.ui.render(band('desktop')))).not.toContain('paqad');
  });

  test('a permission a person must answer leads the band until the next tool starts', async ($, on) => {
    const world = worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(FAST_ORD_490) } });
    mock.clock(on, { now: NOW });
    await $.session.start(DESKTOP_START);
    world.verdict = { decision: 'ask' };
    await $.tool.check({
      tool: 'Bash',
      input: { command: 'rm -rf build' },
      tool_use_id: 'tu_9',
      approver: 'person',
    } as never);
    const waiting = await $.ui.render(band('desktop'));
    expect(textOf(waiting)).toContain('Waiting for your permission');
    expect(lightOf(waiting)).toBe('#F37748');
    await $.tool.call({ tool: 'Bash', command: 'rm -rf build', tool_use_id: 'tu_9' } as never);
    expect(textOf(await $.ui.render(band('desktop')))).not.toContain('Waiting for your permission');
  });

  test('an ask the host answers, or an allow, never waits for you', async ($, on) => {
    const world = worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(FAST_ORD_490) } });
    mock.clock(on, { now: NOW });
    await $.session.start(DESKTOP_START);
    world.verdict = { decision: 'ask' };
    await $.tool.check({ tool: 'Bash', input: {}, tool_use_id: 'tu_1', approver: 'host' } as never);
    world.verdict = { decision: 'allow' };
    await $.tool.check({
      tool: 'Bash',
      input: {},
      tool_use_id: 'tu_2',
      approver: 'person',
    } as never);
    expect(textOf(await $.ui.render(band('desktop')))).not.toContain('Waiting for your');
  });

  test("a background agent ask clears at that agent's next check, and never holds the band", async ($, on) => {
    const world = worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(FAST_ORD_490) } });
    mock.clock(on, { now: NOW });
    await $.session.start(DESKTOP_START);
    world.verdict = { decision: 'ask' };
    await $.tool.check({
      tool: 'Bash',
      input: {},
      tool_use_id: 'tu_a1',
      approver: 'person',
      agentId: 'agent-a1',
    } as never);
    world.verdict = { decision: 'allow' };
    await $.tool.check({
      tool: 'Read',
      input: {},
      tool_use_id: 'tu_a2',
      approver: 'person',
      agentId: 'agent-a1',
    } as never);
    expect(textOf(await $.ui.render(band('desktop')))).not.toContain('Waiting for your permission');
  });

  test('a background agent ask clears when that agent starts a tool or its turn completes', async ($, on) => {
    const world = worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(FAST_ORD_490) } });
    mock.clock(on, { now: NOW });
    await $.session.start(DESKTOP_START);
    const askFrom = async (agentId: string, id: string) => {
      world.verdict = { decision: 'ask' };
      await $.tool.check({
        tool: 'Bash',
        input: {},
        tool_use_id: id,
        approver: 'person',
        agentId,
      } as never);
    };
    await askFrom('agent-a1', 'tu_a1');
    await $.tool.call({
      tool: 'Bash',
      command: 'ls',
      tool_use_id: 'tu_a1',
      agentId: 'agent-a1',
    } as never);
    expect(textOf(await $.ui.render(band('desktop')))).not.toContain('Waiting for your permission');
    await askFrom('agent-b2', 'tu_b1');
    await $.turn.complete({ text: '', agentId: 'agent-b2' } as never);
    expect(textOf(await $.ui.render(band('desktop')))).not.toContain('Waiting for your permission');
    await askFrom('agent-c3', 'tu_c1');
    await $.turn.start({ text: 'next', turnId: 'turn-9' } as never);
    expect(textOf(await $.ui.render(band('desktop')))).not.toContain('Waiting for your permission');
  });

  test('AC-13: a background subagent ask with no follow-up never shows Waiting for your permission', async ($, on) => {
    const world = worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(FAST_ORD_490) } });
    mock.clock(on, { now: NOW });
    await $.session.start(DESKTOP_START);
    world.verdict = { decision: 'ask' };
    await $.tool.check({
      tool: 'Bash',
      input: {},
      tool_use_id: 'tu_bg',
      approver: 'person',
      agentId: 'agent-plan',
    } as never);
    expect(textOf(await $.ui.render(band('desktop')))).not.toContain('Waiting for your permission');
  });

  test('FR-18 / AC-14: a foreground stage agent ask waits until that agent moves on', async ($, on) => {
    const world = worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(FAST_ORD_490) } });
    mock.clock(on, { now: NOW });
    await $.session.start(DESKTOP_START);
    const seen: string[] = [];
    world.during.set('Agent', async () => {
      world.verdict = { decision: 'ask' };
      await $.tool.check({
        tool: 'Bash',
        input: {},
        tool_use_id: 'tu_dev',
        approver: 'person',
        agentId: 'agent-dev',
      } as never);
      seen.push(textOf(await $.ui.render(band('desktop'))));
      await $.tool.call({ tool: 'Bash', tool_use_id: 'tu_dev', agentId: 'agent-dev' } as never);
      seen.push(textOf(await $.ui.render(band('desktop'))));
    });
    await $.tool.call({ tool: 'Agent', subagent_type: 'paqad:paqad-development' } as never);
    expect(seen[0]).toContain('Waiting for your permission');
    expect(seen[1]).not.toContain('Waiting for your permission');
  });

  test('FR-18: a foreground stage agent ask clears when the Agent call ends', async ($, on) => {
    const world = worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(FAST_ORD_490) } });
    mock.clock(on, { now: NOW });
    await $.session.start(DESKTOP_START);
    world.during.set('Agent', async () => {
      world.verdict = { decision: 'ask' };
      await $.tool.check({
        tool: 'Bash',
        input: {},
        tool_use_id: 'tu_dev',
        approver: 'person',
        agentId: 'agent-dev',
      } as never);
    });
    await $.tool.call({ tool: 'Agent', subagent_type: 'paqad:paqad-development' } as never);
    expect(textOf(await $.ui.render(band('desktop')))).not.toContain('Waiting for your permission');
  });

  test('AC-13: a background agent ask during a foreground Agent call does not wait', async ($, on) => {
    const world = worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(FAST_ORD_490) } });
    mock.clock(on, { now: NOW });
    await $.session.start(DESKTOP_START);
    await $.tool.call({
      tool: 'Agent',
      subagent_type: 'paqad:paqad-planning',
      run_in_background: true,
    } as never);
    await $.tool.call({ tool: 'Read', tool_use_id: 'tu_bg0', agentId: 'agent-bg' } as never);
    const ask = (agentId: string, id: string) =>
      $.tool.check({
        tool: 'Bash',
        input: {},
        tool_use_id: id,
        approver: 'person',
        agentId,
      } as never);
    const seen: string[] = [];
    world.during.set('Agent', async () => {
      await $.tool.call({ tool: 'Read', tool_use_id: 'tu_dev0', agentId: 'agent-dev' } as never);
      world.verdict = { decision: 'ask' };
      await ask('agent-bg', 'tu_bg1');
      seen.push(textOf(await $.ui.render(band('desktop'))));
      await ask('agent-dev', 'tu_dev1');
      seen.push(textOf(await $.ui.render(band('desktop'))));
    });
    await $.tool.call({ tool: 'Agent', subagent_type: 'paqad:paqad-development' } as never);
    expect(seen[0]).not.toContain('Waiting for your permission');
    expect(seen[1]).toContain('Waiting for your permission');
  });

  test('AC-13: an ask from an agent dispatched in the background never waits', async ($, on) => {
    const world = worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(FAST_ORD_490) } });
    mock.clock(on, { now: NOW });
    await $.session.start(DESKTOP_START);
    const seen: string[] = [];
    world.during.set('Agent', async () => {
      world.verdict = { decision: 'ask' };
      await $.tool.check({
        tool: 'Bash',
        input: {},
        tool_use_id: 'tu_bg',
        approver: 'person',
        agentId: 'agent-bg',
      } as never);
      seen.push(textOf(await $.ui.render(band('desktop'))));
    });
    await $.tool.call({
      tool: 'Agent',
      subagent_type: 'paqad:paqad-planning',
      run_in_background: true,
    } as never);
    expect(seen[0]).not.toContain('Waiting for your permission');
  });

  test('AC-13: a main ask denied with Esc clears at the next main event', async ($, on) => {
    const world = worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(FAST_ORD_490) } });
    mock.clock(on, { now: NOW });
    await $.session.start(DESKTOP_START);
    world.verdict = { decision: 'ask' };
    await $.tool.check({
      tool: 'Bash',
      input: {},
      tool_use_id: 'tu_m',
      approver: 'person',
    } as never);
    expect(textOf(await $.ui.render(band('desktop')))).toContain('Waiting for your permission');
    world.verdict = { decision: 'allow' };
    await $.tool.check({ tool: 'Read', input: {}, tool_use_id: 'tu_r', approver: 'host' } as never);
    expect(textOf(await $.ui.render(band('desktop')))).not.toContain('Waiting for your permission');
  });

  test('a main-thread ask still waits while a background agent works on', async ($, on) => {
    const world = worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(FAST_ORD_490) } });
    mock.clock(on, { now: NOW });
    await $.session.start(DESKTOP_START);
    world.verdict = { decision: 'ask' };
    await $.tool.check({
      tool: 'Bash',
      input: {},
      tool_use_id: 'tu_m1',
      approver: 'person',
    } as never);
    world.verdict = { decision: 'allow' };
    await $.tool.check({
      tool: 'Read',
      input: {},
      tool_use_id: 'tu_a1',
      approver: 'person',
      agentId: 'agent-a1',
    } as never);
    await $.tool.call({ tool: 'Read', tool_use_id: 'tu_a1', agentId: 'agent-a1' } as never);
    await $.turn.complete({ text: '', agentId: 'agent-a1' } as never);
    expect(textOf(await $.ui.render(band('desktop')))).toContain('Waiting for your permission');
    await $.tool.call({ tool: 'Bash', command: 'rm -rf build', tool_use_id: 'tu_m1' } as never);
    expect(textOf(await $.ui.render(band('desktop')))).not.toContain('Waiting for your permission');
  });

  test('the end of the main turn clears a wait, a subagent turn does not', async ($, on) => {
    const world = worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(FAST_ORD_490) } });
    mock.clock(on, { now: NOW });
    await $.session.start(DESKTOP_START);
    world.verdict = { decision: 'ask' };
    await $.tool.check({
      tool: 'Bash',
      input: {},
      tool_use_id: 'tu_1',
      approver: 'person',
    } as never);
    await $.turn.complete({ text: '', agentId: 'agent-a1' } as never);
    expect(textOf(await $.ui.render(band('desktop')))).toContain('Waiting for your permission');
    await $.turn.complete({ text: '' } as never);
    expect(textOf(await $.ui.render(band('desktop')))).not.toContain('Waiting for your permission');
  });

  test('AC-32: the band draws the row the snapshot decided, and follows the snapshot into a new turn', async ($, on) => {
    const failed = {
      ...FAST_ORD_490,
      headline: {
        text: 'Tests, types or lint failed',
        tone: 'bad',
        row: 12,
        word: 'Needs your attention',
      },
      verdict: {
        kind: 'fail',
        word: 'Needs your attention',
        reasons: [],
        written_at: new Date(NOW - 60_000).toISOString(),
      },
      gates: [
        { name: 'code-tests-lint', required: true, strength: 'deterministic', verdict: 'fail' },
      ],
    };
    const world = worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(failed) } });
    mock.clock(on, { now: NOW });
    await $.session.start(DESKTOP_START);
    expect(textOf(await $.ui.render(band('desktop')))).toContain('Tests, types or lint failed');
    await $.turn.start({ text: 'go on', turnId: 'turn-2' } as never);
    world.put(SNAPSHOT, fileText(FAST_ORD_490));
    await $.tool.call({ tool: 'Edit', file_path: '/work/a.ts' } as never);
    const drawn = textOf(await $.ui.render(band('desktop')));
    expect(drawn).toContain('Building');
    expect(drawn).not.toContain('Tests, types or lint failed');
  });

  test('AC-10: Done reads in the success colour with a dim not committed note and no warning colour', async ($, on) => {
    const done = {
      ...FULL_ORD_501,
      scope: { qualified: true, reason: 'finished' },
      flags: [],
      rung: 'done',
      headline: {
        text: 'Done',
        tone: 'good',
        row: 16,
        word: 'Done',
        rung: 'done',
        note: 'not committed',
      },
    };
    worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(done) } });
    mock.clock(on, { now: NOW });
    await $.session.start(DESKTOP_START);
    const drawn = await $.ui.render(band('desktop'));
    expect(textOf(drawn)).toContain('● Done    not committed');
    expect(lightOf(drawn)).toBe('#2F8F6B');
    expect(textOf(drawn)).not.toContain('Ready');
    const note = textElement(drawn, '    not committed') as { props?: { dimColor?: unknown } };
    expect(note?.props?.dimColor).toBe(true);
  });

  test('AC-16: the line under the headline is always drawn, blank when there is nothing to say', async ($, on) => {
    worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(FAST_ORD_490) } });
    mock.clock(on, { now: NOW });
    await $.session.start(DESKTOP_START);
    const drawn = await $.ui.render(band('desktop'));
    const blank = textElement(drawn, ' ') as { props?: { dimColor?: unknown } } | undefined;
    expect(blank?.props?.dimColor).toBe(true);
  });

  test('AC-29, AC-33: a paqad record gap shows Done and one neutral line, never a fix instruction', async ($, on) => {
    const gap = 'paqad could not record every stage of this change';
    const done = {
      ...FULL_ORD_501,
      flags: [],
      rung: 'done',
      headline: { text: 'Done', tone: 'good', row: 16, word: 'Done', rung: 'done', gap },
    };
    worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(done) } });
    mock.clock(on, { now: NOW });
    await $.session.start(DESKTOP_START);
    const drawn = await $.ui.render(band('desktop'));
    expect(textOf(drawn)).toContain(gap);
    expect(textOf(drawn)).not.toContain('Fix it and run the checks again');
    expect(lightOf(drawn)).toBe('#2F8F6B');
    const line = textElement(drawn, gap) as { props?: { dimColor?: unknown; color?: unknown } };
    expect(line?.props?.dimColor).toBe(true);
    expect(line?.props?.color).toBeUndefined();
  });

  test('AC-31: a snapshot from before the headline row renders its own words without crashing', async ($, on) => {
    worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(FULL_ORD_501) } });
    mock.clock(on, { now: NOW });
    await $.session.start(DESKTOP_START);
    const drawn = textOf(await $.ui.render(band('desktop')));
    expect(drawn).toContain('Safe to merge. 1 flag open.');
  });

  test('AC-13: the close menu opens inline; Cancel, Close for now, Show and Hide always do what they say', async ($, on) => {
    const world = worldOf(on, {
      files: { ...ONBOARDED, [SNAPSHOT]: fileText(QUIET_501) },
      store: QUIET_STORE(),
    });
    mock.clock(on, { now: NOW });
    await $.session.start(DESKTOP_START);
    const mounted = await mountDesktop($);
    expect(await mounted.find({ key: 'paqad-close-now' })).toBeUndefined();
    await mounted.press({ key: 'paqad-close' });
    expect(await mounted.find({ key: 'paqad-close-now' })).toBeDefined();
    expect(textOf(await $.ui.render(band('desktop')))).toContain(
      'Close the paqad band?Close for nowHide alwaysCancel',
    );
    await mounted.press({ key: 'paqad-close-cancel' });
    expect(await mounted.find({ key: 'paqad-close-now' })).toBeUndefined();
    await mounted.press({ key: 'paqad-close' });
    await mounted.press({ key: 'paqad-close-now' });
    expect(textOf(await $.ui.render(band('desktop')))).toBe('paqad   Closed for this sessionShow');
    expect(world.asked).toEqual([]);
    await mounted.press({ key: 'paqad-show' });
    expect(await mounted.find({ key: 'paqad-minimise' })).toBeDefined();
    await mounted.press({ key: 'paqad-close' });
    await mounted.press({ key: 'paqad-close-always' });
    await mounted.unmount();
    expect(world.store.get('band.hidden:/work')).toBe(true);
    expect(textOf(await $.ui.render(band('desktop')))).toBe('paqad   HiddenShow');
  });

  test('AC-14: minimise draws one row with the expand glyph, and expand brings the card back', async ($, on) => {
    const world = worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(FAST_ORD_490) } });
    mock.clock(on, { now: NOW });
    await $.session.start(DESKTOP_START);
    const mounted = await mountDesktop($);
    await mounted.press({ key: 'paqad-minimise' });
    expect(world.store.get('band.minimised')).toBe(true);
    expect(await mounted.find({ key: 'paqad-expand' })).toBeDefined();
    const row = await $.ui.render(band('desktop'));
    expect(textOf(row)).toStartWith('paqad   Feature development   ● Build · 2:00');
    expect(buttonKeys(row)).toEqual(['paqad-ledger', 'paqad-expand', 'paqad-close']);
    await mounted.press({ key: 'paqad-expand' });
    await mounted.unmount();
    expect(world.store.has('band.minimised')).toBe(false);
  });

  test('AC-14: a closed band with a decision waiting reads Needs you in coral', async ($, on) => {
    const store = new Map<string, unknown>([['band.hidden:/work', true]]);
    worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(GRADUATED_ORD_482) }, store });
    mock.clock(on, { now: NOW });
    await $.session.start(DESKTOP_START);
    const drawn = await $.ui.render(band('desktop'));
    expect(textOf(drawn)).toBe('paqad   ● Needs youShow');
    expect(colorOf(textElement(drawn, '   ● Needs you'))).toBe('#F37748');
  });

  test('AC-16: the card needs 6 rows, 7 with the menu, and falls back to the minimised row', async ($, on) => {
    worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(QUIET_501) }, store: QUIET_STORE() });
    mock.clock(on, { now: NOW });
    await $.session.start(DESKTOP_START);
    const keys = async (maxRows: number) =>
      buttonKeys(await $.ui.render(band('desktop', { maxRows })));
    expect(await keys(5)).toContain('paqad-expand');
    expect(await keys(6)).toContain('paqad-minimise');
    const mounted = await mountDesktop($);
    await mounted.press({ key: 'paqad-close' });
    await mounted.unmount();
    const menu = await keys(6);
    expect(menu).toContain('paqad-expand');
    expect(menu).toContain('paqad-close-now');
    expect(await keys(7)).toContain('paqad-minimise');
  });

  test('AC-23: the High Table tab comes forward once when the table sits, unless the person picked a tab', async ($, on) => {
    const world = worldOf(on, {
      files: { ...ONBOARDED, [SNAPSHOT]: fileText(QUIET_501) },
      store: QUIET_STORE(),
    });
    mock.clock(on, { now: NOW });
    await $.session.start(DESKTOP_START);
    const shownAlt = async () =>
      everyElement(await $.ui.render(pane('desktop')))
        .map((element) => propsOf(element).alt)
        .find((alt) => typeof alt === 'string' && alt.endsWith('tab is shown'));
    expect(await shownAlt()).toBe('Trust tab is shown');
    const writing = ord501At('writing');
    world.put(
      SNAPSHOT,
      fileText({ ...writing, change: { ...(writing.change as object), dir: 'dir-ord-501' } }),
    );
    await $.tool.call({ tool: 'Edit', file_path: '/work/a.ts' } as never);
    expect(await shownAlt()).toBe('High Table tab is shown');
  });

  test('the Ledger Button toggles the Ledger and the flags open it on Trust', async ($, on) => {
    const world = worldOf(on, {
      files: { ...ONBOARDED, [SNAPSHOT]: fileText(QUIET_501) },
      store: QUIET_STORE(),
    });
    mock.clock(on, { now: NOW });
    await $.session.start(DESKTOP_START);
    expect(world.opened).toEqual([]);
    const mounted = await mountDesktop($);
    await mounted.press({ key: 'paqad-ledger' });
    expect(world.opened).toEqual(['paqad']);
    await mounted.press({ key: 'paqad-ledger' });
    expect(world.closedPanes).toEqual(['paqad']);
    await mounted.press({ key: 'paqad-flags' });
    await mounted.unmount();
    expect(world.opened).toEqual(['paqad', 'paqad']);
    expect(drawnLines(await $.ui.render(pane('terminal')))).toContain('Trust (shown)');
  });

  test('AC-15: another workflow gets one row with its cost, running while a turn is in flight', async ($, on) => {
    const world = worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(QUESTION) } });
    const clock = mock.clock(on, { now: NOW });
    await $.session.start(DESKTOP_START);
    const idle = await $.ui.render(band('desktop'));
    expect(textOf(idle)).toBe('paqad   Question   ● idle84K tokens · ~$0.05Ledger');
    expect(everyElement(idle).some((element) => element.type === 'Svg')).toBe(false);
    await $.prompt.submit({ text: 'what is this?' } as never);
    await clock.advance(42_000);
    await clock.settle();
    const running = await $.ui.render(band('desktop'));
    expect(textOf(running)).toContain('Question   ● running · 0:42');
    expect(lightOf(running)).toMatch(/^#F90093[0-9A-F]{2}$/);
    await $.turn.complete({ text: '' } as never);
    expect(textOf(await $.ui.render(band('desktop')))).toContain('● idle');
    const mounted = await mountDesktop($);
    await mounted.press({ key: 'paqad-workflow-ledger' });
    await mounted.unmount();
    expect(world.opened.at(-1)).toBe('paqad');
  });

  test('AC-25: the live light breathes on the 400 ms tick and the clock follows it; a settled light stays still', async ($, on) => {
    const world = worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(FAST_ORD_490) } });
    const clock = mock.clock(on, { now: NOW });
    await $.session.start(DESKTOP_START);
    const first = lightOf(await $.ui.render(band('desktop')));
    await clock.advance(400);
    await clock.settle();
    const second = lightOf(await $.ui.render(band('desktop')));
    expect(first).toMatch(/^#F90093[0-9A-F]{2}$/);
    expect(second).toMatch(/^#F90093[0-9A-F]{2}$/);
    expect(second).not.toBe(first);
    await clock.advance(1_000);
    await clock.settle();
    expect(textOf(await $.ui.render(band('desktop')))).toContain('Building    2:01');
    world.put(SNAPSHOT, fileText(SAFE_CLEAN));
    await $.tool.call({ tool: 'Edit', file_path: '/work/a.ts' } as never);
    const settled = lightOf(await $.ui.render(band('desktop')));
    expect(settled).toBe('#2F8F6B');
    await clock.advance(800);
    await clock.settle();
    expect(lightOf(await $.ui.render(band('desktop')))).toBe(settled);
  });
});

async function desktopPane(
  $: Parameters<Parameters<typeof test>[1]>[0],
  press: string[] = [],
): Promise<RenderNode> {
  const mounted = await $.ui.mount({
    plugin: PLUGIN,
    surface: 'desktop',
    component: 'Pane',
    requestId: 'paqad',
    props: pane('desktop').props,
  });
  for (const key of press) await mounted.press({ key });
  await mounted.unmount();
  return $.ui.render(pane('desktop'));
}

function expectDesktopSafe(tree: RenderNode): void {
  for (const element of everyElement(tree)) {
    const props = propsOf(element);
    expect(props.hotkey).toBeUndefined();
    expect(props.role).toBeUndefined();
    expect(props.isInteractive).toBeUndefined();
    expect(props.borderStyle).toBeUndefined();
    expect(props.backgroundColor).toBeUndefined();
    if (typeof props.width === 'string') expect(props.width).toMatch(/^\d+%$/);
  }
}

const CLAIMED = {
  ...QUIET_501,
  headline: { text: 'Safe to merge', tone: 'good', row: 8, word: 'Safe to merge' },
  claims: Array.from({ length: 6 }, (_, index) => ({
    kind: 'acceptance',
    id: `AC-${index + 1}`,
    label: `Claim ${index + 1}`,
    verdict: 'pass',
    test_id: `tests/claim-${index + 1}.test.ts`,
  })),
  timeline: [
    { at: '2026-10-18T08:41:00.000Z', kind: 'stage_end', stage: 'planning', duration_ms: 101_000 },
    { at: '2026-10-18T08:42:00.000Z', kind: 'rules_loaded', count: 12 },
  ],
};

describe('the Desktop Ledger', () => {
  test('AC-19, AC-34: opens on Trust with the subtitle, equal tabs, the tab rule, the stages with their steps and gates, the claims and the flags', async ($, on) => {
    worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(CLAIMED) }, store: QUIET_STORE() });
    mock.clock(on, { now: NOW });
    await $.session.start(DESKTOP_START);
    const tree = await $.ui.render(pane('desktop'));
    expectDesktopSafe(tree);
    const lines = drawnLines(tree);
    expect(lines[0]).toStartWith('What happened, with proof');
    expect(lines.slice(1, 6)).toEqual(['Trust', 'High Table', 'Delivery', 'Record', 'Cost']);
    const tabs = everyElement(tree).filter((element) =>
      String(keyOf(element)).startsWith('paqad-tab-'),
    );
    expect(tabs.map(keyOf)).toEqual(
      expect.arrayContaining(['paqad-tab-trust', 'paqad-tab-table', 'paqad-tab-cost']),
    );
    for (const box of tabs.filter((element) => element.type === 'Box')) {
      expect(propsOf(box).width).toBe('20%');
    }
    const trust = tabs.find(
      (element) => keyOf(element) === 'paqad-tab-trust' && element.type === 'Button',
    )!;
    expect(propsOf(trust)).toMatchObject({ plain: true, dimColor: false });
    const rule = everyElement(tree).find(
      (element) => propsOf(element).alt === 'Trust tab is shown',
    );
    expect(propsOf(rule!).height).toBe(2);
    expect(lines).not.toContain('● Safe to merge');
    expect(lines.some((line) => line.includes('required gates pass'))).toBe(false);
    for (const line of ['PLAN', 'SPEC', 'BUILD', 'REVIEW', 'CHECKS', 'DOCS', '✓ Done'])
      expect(lines).toContain(line);
    expect(lines).not.toContain('Recorded');
    expect(lines).toContain('✓  Plan compiled  ·  6 steps');
    for (const line of ['Tests, types and lint pass', 'Pass', 'Not required'])
      expect(lines).toContain(line);
    expect(lines.indexOf('PLAN')).toBeLessThan(lines.indexOf('DOCS'));
    expect(lines).toContain('CLAIMS AND THE TESTS THAT PROVE THEM');
    expect(lines).toContain('AC-1  Claim 1');
    expect(lines).toContain('tests/claim-1.test.ts');
    expect(lines).not.toContain('AC-5  Claim 5');
    expect(lines).toContain('+2 more, all proven');
    expect(lines).toContain('⚑ 1 near-copy of existing code is open.');
    expect(lines).toContain('Open');
    const ring = everyElement(tree).find((element) =>
      String(propsOf(element).alt ?? '').includes('required gates'),
    );
    expect(ring).toBeUndefined();
  });

  test('AC-21: the High Table tab draws the ring, the chief, Answer in chat and See each side, and the seat details', async ($, on) => {
    const world = worldOf(on, {
      files: { ...ONBOARDED, [SNAPSHOT]: fileText(ord501At('ruled')) },
      store: new Map<string, unknown>([['ledger.autoOpened', ['dir-ord-501']]]),
    });
    const fills: string[] = [];
    let fill = false;
    on('prompt.fill', ($, e) => {
      fills.push(e.text);
      return { isFilled: fill };
    });
    mock.clock(on, { now: NOW });
    await $.session.start(DESKTOP_START);
    const table = await desktopPane($, ['paqad-tab-table']);
    expectDesktopSafe(table);
    const lines = drawnLines(table);
    expect(lines).toContain('CHIEF ARCHITECT');
    expect(lines).toContain('● Needs your answers');
    expect(lines).toContain('1.  Customer email in the export');
    expect(lines).toContain('Answer in chat');
    expect(lines).toContain('See each side');
    expect(lines.some((line) => line.startsWith('The chief architect recommends'))).toBe(false);
    const ring = everyElement(table).find((element) => propsOf(element).width === 150);
    expect(propsOf(ring!)).toMatchObject({ height: 150, alt: '7 of 7 notes landed' });
    expect(lines).toContain('SA   Security auditor   picked');
    expect(lines).not.toContain('the export carries customer emails and addresses');
    const pressed = await desktopPane($, [
      'paqad-answer',
      'paqad-sides',
      'paqad-seat-security-auditor',
    ]);
    expect(fills).toEqual(['Walk me through the 1 open decision']);
    expect(world.toasts).toContain(ANSWER_TOAST);
    const after = drawnLines(pressed);
    expect(after).toContain(
      'The chief architect recommends: leave the email out by default and let an admin turn it on.',
    );
    expect(after).toContain('the export carries customer emails and addresses');
    fill = true;
    await desktopPane($, ['paqad-answer', 'paqad-seat-security-auditor']);
    expect(world.toasts.filter((text) => text === ANSWER_TOAST)).toHaveLength(1);
    expect(drawnLines(await $.ui.render(pane('desktop')))).not.toContain(
      'the export carries customer emails and addresses',
    );
  });

  test('AC-21: who shaped the spec reads each line from the bundle spec', async ($, on) => {
    const spec = [
      '# Spec',
      '- FR-1: Export the orders page to CSV',
      '- FR-2: Keep the filters',
      '- AC-1: A file downloads',
    ];
    worldOf(on, {
      files: {
        ...ONBOARDED,
        [SNAPSHOT]: fileText(QUIET_501),
        '.paqad/ledger/feature-evidence/dir-ord-501/spec.md': spec.join('\n'),
      },
      store: QUIET_STORE(),
    });
    mock.clock(on, { now: NOW });
    await $.session.start(DESKTOP_START);
    const lines = drawnLines(await desktopPane($, ['paqad-tab-table']));
    expect(lines).toContain('WHO SHAPED THE SPEC');
    expect(lines).toContain('FR-1  Export the orders page to CSV');
    expect(lines).toContain('NFR-1  ');
    expect(lines).toContain('2 of 3 spec lines came from an expert note.');
    expect(lines).toContain('● Approved');
  });

  test('AC-22: Delivery draws one block per step with its node, and the Open PR link on the open PR', async ($, on) => {
    worldOf(on, {
      files: {
        ...ONBOARDED,
        [SNAPSHOT]: fileText({ ...ALL_GREEN, change: QUIET_501.change }),
      },
      store: QUIET_STORE(),
    });
    mock.clock(on, { now: NOW });
    await $.session.start(DESKTOP_START);
    const tree = await desktopPane($, ['paqad-tab-ships']);
    expectDesktopSafe(tree);
    const lines = drawnLines(tree);
    expect(lines).not.toContain('Merge');
    expect(lines).toContain('feat/x on origin');
    const nodes = everyElement(tree).filter(
      (element) => element.type === 'Svg' && propsOf(element).width === 24,
    );
    expect(nodes.length).toBeGreaterThan(3);
    const link = everyElement(tree).find((element) => element.type === 'Link');
    expect(propsOf(link!).href).toBe('https://example.test/pull/12');
    expect(stringsOf(link!).join('')).toBe(`Open PR ${'#'}12`);
  });

  test('AC-23: Record lists the events in local time and Cost draws the total, the stages and the High Table', async ($, on) => {
    worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(CLAIMED) }, store: QUIET_STORE() });
    mock.clock(on, { now: NOW });
    await $.session.start(DESKTOP_START);
    const record = drawnLines(await desktopPane($, ['paqad-tab-record']));
    expect(record).toContain(`${recordTime('2026-10-18T08:41:00.000Z')}   Plan done in 1m 41s`);
    expect(record).toContain(`${recordTime('2026-10-18T08:42:00.000Z')}   Rules loaded: 12 apply`);
    const cost = await desktopPane($, ['paqad-tab-cost']);
    expectDesktopSafe(cost);
    const lines = drawnLines(cost);
    expect(lines).toContain('1.3M tokens');
    expect(lines.some((line) => line.startsWith('~$4.60 estimate at API prices'))).toBe(true);
    expect(lines).toContain('BY STAGE');
    expect(lines).toContain('HIGH TABLE');
    expect(lines).toContain('Chief architect');
    expect(lines).toContain(
      'Not counted: your own typing time, other sessions, and the HUD itself (0 tokens).',
    );
  });

  test('AC-19, AC-23: the fast lane leaves the High Table out of the tabs and the Cost tab', async ($, on) => {
    worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(FAST_ORD_490_COST) } });
    mock.clock(on, { now: NOW });
    await $.session.start(DESKTOP_START);
    const trust = await $.ui.render(pane('desktop'));
    expect(drawnLines(trust).slice(1, 5)).toEqual(['Trust', 'Delivery', 'Record', 'Cost']);
    expectDesktopSafe(trust);
    const cost = drawnLines(await desktopPane($, ['paqad-tab-cost']));
    expect(cost).not.toContain('HIGH TABLE');
    expect(cost.join('\n')).not.toContain('Chief architect');
  });

  test('AC-24, AC-5: another workflow gets a light and its cost, and an unreadable record says so', async ($, on) => {
    const world = worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(QUESTION) } });
    mock.clock(on, { now: NOW });
    await $.session.start(DESKTOP_START);
    const lines = drawnLines(await $.ui.render(pane('desktop')));
    expect(lines).toEqual([
      '● Question',
      'No change in this session, so there is nothing to prove. paqad shows what this workflow cost.',
      '84K tokens',
      '~$0.05 estimate at API prices',
      'Counted from when this question started in this session. Nothing from other sessions or earlier changes.',
    ]);
    world.put(SNAPSHOT, '{"schema":"paqad.hud/3","headl');
    await $.tool.call({ tool: 'Edit', file_path: '/work/a.ts' } as never);
    expect(drawnLines(await $.ui.render(pane('desktop')))).toEqual([
      "● paqad cannot read this session's record",
      'The snapshot file is not valid.',
    ]);
  });
});

const SCENE_NAMES = Object.keys(SCENE_FIXTURES) as Array<keyof typeof SCENE_FIXTURES>;
const WORKFLOW_SCENES: ReadonlySet<string> = new Set(['Question', 'Health check']);

const SCENE_WORDS: Record<keyof typeof SCENE_FIXTURES, string> = {
  'High Table writing': 'The High Table is writing its notes',
  Building: 'Building',
  'Needs you': 'The chief architect has 1 question for you',
  'Shipping with CI live': 'Delivering',
  Failed: 'Tests, types or lint failed',
  'CI passed': 'Done',
  'Fast lane': 'Building',
  'Edit only': 'Done    left uncommitted, as you asked',
  'No CI': 'Delivering',
  Closed: 'Safe to merge',
  Question: 'Question   ● idle',
  'Health check': 'Codebase health   ● idle',
};

async function cardControls(
  $: Parameters<Parameters<typeof test>[1]>[0],
  mounted: Awaited<ReturnType<typeof mountDesktop>>,
): Promise<void> {
  const rows = async (maxRows: number) =>
    buttonKeys(await $.ui.render(band('desktop', { maxRows })));
  expect(await rows(5)).toContain('paqad-expand');
  expect(await rows(6)).toContain('paqad-minimise');
  await mounted.press({ key: 'paqad-ledger' });
  await mounted.press({ key: 'paqad-ledger' });
  if (await mounted.find({ key: 'paqad-flags' })) await mounted.press({ key: 'paqad-flags' });
  await mounted.press({ key: 'paqad-close' });
  expect(await mounted.find({ key: 'paqad-close-now' })).toBeDefined();
  expect(await rows(6)).toEqual(expect.arrayContaining(['paqad-expand', 'paqad-close-now']));
  expect(await rows(7)).toContain('paqad-minimise');
  expectDesktopSafe(await $.ui.render(band('desktop')));
  await mounted.press({ key: 'paqad-close-cancel' });
  expect(await mounted.find({ key: 'paqad-close-now' })).toBeUndefined();
  await mounted.press({ key: 'paqad-minimise' });
  expect(await mounted.find({ key: 'paqad-expand' })).toBeDefined();
  expectDesktopSafe(await $.ui.render(band('desktop')));
  await mounted.press({ key: 'paqad-expand' });
  expect(await mounted.find({ key: 'paqad-minimise' })).toBeDefined();
}

describe('every scene on Desktop', () => {
  for (const scene of SCENE_NAMES) {
    test(`AC-28, AC-7, AC-16: ${scene} mounts the band and every Ledger tab on desktop, and every control answers`, async ($, on) => {
      const world = worldOf(on, {
        files: { ...ONBOARDED, [SNAPSHOT]: fileText(SCENE_FIXTURES[scene]) },
      });
      on('prompt.fill', () => ({ isFilled: true }));
      mock.clock(on, { now: NOW });
      await $.session.start(DESKTOP_START);
      const drawn = await $.ui.render(band('desktop'));
      expect(textOf(drawn)).toStartWith('paqad');
      expect(textOf(drawn)).toContain(SCENE_WORDS[scene]);
      expectDesktopSafe(drawn);
      const mounted = await mountDesktop($);
      if (WORKFLOW_SCENES.has(scene)) {
        expect(everyElement(drawn).some((element) => element.type === 'Svg')).toBe(false);
        await mounted.press({ key: 'paqad-workflow-ledger' });
        expect(world.opened.at(-1)).toBe('paqad');
      } else if (scene === 'Closed') {
        await mounted.press({ key: 'paqad-close' });
        await mounted.press({ key: 'paqad-close-now' });
        expect(await mounted.find({ key: 'paqad-show' })).toBeDefined();
        expectDesktopSafe(await $.ui.render(band('desktop')));
        await mounted.press({ key: 'paqad-show' });
        expect(await mounted.find({ key: 'paqad-minimise' })).toBeDefined();
      } else {
        await cardControls($, mounted);
      }
      await mounted.unmount();

      const ledger = await $.ui.mount({
        plugin: PLUGIN,
        surface: 'desktop',
        component: 'Pane',
        requestId: 'paqad',
        props: pane('desktop').props,
      });
      const first = await $.ui.render(pane('desktop'));
      expectDesktopSafe(first);
      const tabs = buttonKeys(first).filter((key) => String(key).startsWith('paqad-tab-'));
      if (WORKFLOW_SCENES.has(scene)) {
        expect(tabs).toEqual([]);
        expect(drawnLines(first)[0]).toStartWith('● ');
      } else {
        expect(tabs.length).toBeGreaterThanOrEqual(4);
        expect(drawnLines(first)[0]).toStartWith('What happened, with proof');
      }
      for (const tab of tabs) {
        await ledger.press({ key: String(tab) });
        const shown = await $.ui.render(pane('desktop'));
        expectDesktopSafe(shown);
        expect(
          propsOf(
            everyElement(shown).find(
              (element) => keyOf(element) === tab && element.type === 'Button',
            )!,
          ).dimColor,
        ).toBe(false);
        for (const key of buttonKeys(shown).filter(
          (key) => !String(key).startsWith('paqad-tab-'),
        )) {
          await ledger.press({ key: String(key) });
        }
        expectDesktopSafe(await $.ui.render(pane('desktop')));
      }
      await ledger.unmount();
    });
  }
});

describe('the band fits its box', () => {
  test('one row of instruments at 120 columns, stacked at 80, one line when rows run out', async ($, on) => {
    worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(FULL_ORD_501) } });
    mock.clock(on, { now: NOW });
    await $.session.start(START);
    const directionOf = async (bodyColumns: number) => {
      const card = cardOf(await $.ui.render(band('terminal', { bodyColumns, maxRows: 14 })));
      const body = (card as { children: RenderNode[] }).children[1] as {
        props: { flexDirection?: string };
      };
      return body.props.flexDirection;
    };
    expect(await directionOf(120)).toBe('row');
    expect(await directionOf(80)).toBe('column');
    const short = await $.ui.render(band('terminal', { bodyColumns: 120, maxRows: 4 }));
    expect(cardOf(short)).toBeUndefined();
    expect(linesOf(short)[0]).toContain('paqad ORD-501 Safe to merge');
  });
});

describe('stand-downs: the mod registers nothing', () => {
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

  test('a project never onboarded keeps /paqad alone, to say so', async ($, on) => {
    const world = worldOf(on, { files: {} });
    mock.clock(on, { now: NOW });
    await $.session.start(START);
    expect(world.commands).toEqual(['paqad']);
    expect(textOf(await $.ui.render(band('terminal')))).not.toContain('paqad');
    const answer = await $.command.run(command('status'));
    expect(answer.text).toBe('paqad is not active here: this project was never onboarded.');
  });
});

describe('the HUD binds first and falls back to /paqad-hud', () => {
  const PRODUCT_TAKEN = "it is the plugin's /paqad-product-discovery:paqad";
  const FILES = { ...ONBOARDED, [SNAPSHOT]: fileText(FULL_ORD_501), [RECEIPT]: RECEIPT_TEXT };

  test('AC-1: with /paqad owned by another plugin the session binds and draws the change', async ($, on) => {
    const world = worldOf(on, { files: FILES, refuse: { paqad: TAKEN } });
    mock.clock(on, { now: NOW });
    await $.session.start(START);
    expect(world.files.has(HEARTBEAT)).toBe(true);
    expect(world.reads).toContain(SNAPSHOT);
    for (const surface of SURFACES) {
      expect(textOf(await $.ui.render(band(surface)))).toContain('ORD-501');
    }
  });

  test('AC-2: a refused /paqad registers /paqad-hud and says so in the debug log only', async ($, on) => {
    const world = worldOf(on, { files: FILES, refuse: { paqad: TAKEN } });
    mock.clock(on, { now: NOW });
    await $.session.start(START);
    expect(world.commands).toEqual(['paqad-hud']);
    expect(world.logs).toEqual([
      {
        text: `paqad: /paqad is taken (${PRODUCT_TAKEN}); the HUD command is /paqad-hud`,
        to: 'debug',
      },
    ]);
    expect(world.toasts).toEqual([]);
  });

  test('AC-2: /paqad-hud answers every subcommand and every hint names it', async ($, on) => {
    const world = worldOf(on, { files: FILES, refuse: { paqad: TAKEN } });
    mock.clock(on, { now: NOW });
    await $.session.start(START);
    const run = async (args: string) =>
      (await $.command.run(command(args, 'paqad-hud'))).text ?? '';
    expect(await run('')).toContain('Try /paqad-hud status, /paqad-hud decisions');
    expect(await run('status')).toContain('Change: #ORD-501 Add CSV export to the orders page.');
    expect(await run('rules')).toContain('Near-copies: 1 open.');
    expect(await run('receipt')).toBe(RECEIPT_TEXT);
    expect(await run('delivery')).toBe(await run('ships'));
    expect(await run('record')).toContain('written, see /paqad-hud receipt');
    expect(await run('nope')).toStartWith('There is no /paqad-hud nope. Try /paqad-hud status');
    expect(await run('hide')).toBe(
      'The paqad band is hidden. Run /paqad-hud show to bring it back.',
    );
    expect(world.store.get('band.hidden:/work')).toBe(true);
    expect(textOf(await $.ui.render(band('terminal')))).toContain(
      'Hidden always · /paqad-hud show',
    );
    expect(await run('show')).toBe('The paqad band is back.');
    expect(world.store.has('band.hidden:/work')).toBe(false);
    const card = await $.ui.render({
      component: 'CommandOutput',
      surface: 'terminal',
      requestId: 'out',
      props: { command: 'paqad-hud', args: 'receipt', text: RECEIPT_TEXT, isErrored: false },
    } as never);
    expect(drawnLines(card)[0]).toBe('paqad receipt');
  });

  test('AC-3: with /paqad free the HUD registers /paqad and every hint names it', async ($, on) => {
    const world = worldOf(on, { files: FILES });
    mock.clock(on, { now: NOW });
    await $.session.start(START);
    expect(world.commands).toEqual(['paqad']);
    expect(world.logs).toEqual([]);
    expect((await $.command.run(command(''))).text).toContain(
      'Try /paqad status, /paqad decisions',
    );
    expect((await $.command.run(command('hide'))).text).toBe(
      'The paqad band is hidden. Run /paqad show to bring it back.',
    );
    expect(textOf(await $.ui.render(band('terminal')))).toContain('Hidden always · /paqad show');
  });

  test('AC-4: with both names refused the HUD still binds and nothing escapes the hook', async ($, on) => {
    const world = worldOf(on, {
      files: FILES,
      refuse: { paqad: TAKEN, 'paqad-hud': '"/paqad-hud" refused: it is taken too' },
    });
    mock.clock(on, { now: NOW });
    await $.session.start(START);
    expect(world.commands).toEqual([]);
    expect(world.files.has(HEARTBEAT)).toBe(true);
    expect(world.logs).toEqual([
      {
        text: `paqad: /paqad is taken (${PRODUCT_TAKEN}) and /paqad-hud is taken (it is taken too); the HUD has no command`,
        to: 'debug',
      },
    ]);
    expect(textOf(await $.ui.render(band('terminal')))).toContain('ORD-501');
  });

  test('a session id that cannot be read leaves the session unbound and the hook quiet', async ($, on) => {
    const world = worldOf(on, { files: FILES, sessionId: null });
    mock.clock(on, { now: NOW });
    await $.session.start(START);
    expect(world.commands).toEqual(['paqad']);
    expect(world.writes).toEqual([]);
    expect(world.reads.filter((path) => path.startsWith('.paqad/session'))).toEqual([]);
  });
});

describe('/paqad answers from the snapshot, with no model turn', () => {
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
    expect(answers.decisions).toBe(
      'No decision is waiting in this repo. 4 resolved for this change.',
    );
    expect(answers.rules).toContain('Near-copies: 1 open.');
    expect(answers.receipt).toBe(RECEIPT_TEXT);
    expect(answers.cost).toContain('not yet');
  });
});

describe('the cost pill and the Cost tab', () => {
  for (const surface of SURFACES) {
    if (surface === 'terminal')
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
        const pill = await mounted.find({ key: 'paqad-tokens' });
        expect(pill?.text).toBe('1.3M tokens');
        await mounted.press({ key: 'paqad-tokens' });
        expect(world.opened.at(-1)).toBe('paqad');
        await mounted.unmount();

        const strings = stringsOf(await $.ui.render(pane(surface)));
        expect(strings).toContain('Cost (shown)');
        expect(strings.find((line) => line.startsWith('Cost of this change'))).toBe(
          'Cost of this change: 1,300,000 tokens, ~$4.60, estimate at API prices (API-equivalent on a Pro or Max plan), prices of 2026-10-19.',
        );
        for (const heading of ['By stage:', 'By expert:']) expect(strings).toContain(heading);
        expect(strings.some((line) => line.startsWith('Chief architect: '))).toBe(true);
        expect(strings.some((line) => line.startsWith('Basis: API-equivalent estimate.'))).toBe(
          true,
        );
        expect(strings.some((line) => line.startsWith('Not counted: The fast mode premium'))).toBe(
          true,
        );
        for (const line of strings.filter((text) => text.includes('$'))) {
          expect(line).toContain('estimate');
          expect(line).toContain('2026-10-19');
        }
      });

    if (surface === 'terminal')
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

    if (surface === 'terminal')
      test(`fast lane: the Cost tab shows no expert tokens on ${surface}`, async ($, on) => {
        worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(FAST_ORD_490_COST) } });
        mock.clock(on, { now: NOW });
        await $.session.start(START);
        const strings = stringsOf(await paneOn($, surface, 'cost'));
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

describe('when the band reads the snapshot again', () => {
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
    expect(textOf(await $.ui.render(band('terminal')))).toContain(
      'paqad · question · running 0:00 · counting',
    );
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

describe('the High Table in the band', () => {
  for (const surface of TERMINAL) {
    test(`the instrument on ORD-482 and ORD-501, never on ORD-490 or with the experts off, on ${surface}`, async ($, on) => {
      const world = worldOf(on, { files: { ...ONBOARDED } });
      mock.clock(on, { now: NOW });
      await $.session.start(START);
      const textFor = async (raw: Record<string, unknown>) => {
        world.put(SNAPSHOT, fileText(raw));
        await $.tool.call({ tool: 'Bash', command: 'paqad-ai status' } as never);
        return textOf(await $.ui.render(band(surface, { bodyColumns: 120 })));
      };
      expect(await textFor(GRADUATED_ORD_482)).toContain('HIGH TABLE  spec approved');
      expect(await textFor(FULL_ORD_501)).toContain('HIGH TABLE  spec approved');
      expect(await textFor(FAST_ORD_490)).not.toContain('HIGH TABLE');
      const off = await textFor(EXPERTS_OFF);
      expect(off).not.toContain('HIGH TABLE');
      expect(off).toContain('STAGE');
      expect(off).toContain('SHIP');
      expect(await textFor(SKIPPED_TABLE)).toContain('HIGH TABLE  skipped');
    });

    test(`after the ruling the table reads approved and the flag sits in the header on ${surface}`, async ($, on) => {
      worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(LATE_TABLE) } });
      mock.clock(on, { now: NOW });
      await $.session.start(START);
      const drawn = await $.ui.render(band(surface, { bodyColumns: 120 }));
      expect(textOf(drawn)).toContain('HIGH TABLE  spec approved');
      expect(colorOf(textElement(drawn, '1 flag'))).toBe('warning');
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
      expect(world.opened.at(-1)).toBe('paqad');
      await mounted.unmount();
      expect(drawnLines(await $.ui.render(pane(surface)))).toContain('High Table (shown)');
    });
  }
});

describe('the live High Table card in the chat', () => {
  for (const surface of SURFACES) {
    test(`drawn once over the first experts row, redrawn in place, on ${surface}`, async ($, on) => {
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
        '  ● Chief architect: ruled in 2m 00s, verdict: proceed, Note: ~3K tokens of its 10K budget. Run: 28.5K tokens, mostly the code it read (exact)',
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

async function paneOn(
  $: Parameters<Parameters<typeof test>[1]>[0],
  surface: 'terminal' | 'desktop',
  tab: string,
) {
  const mounted = await $.ui.mount({
    plugin: PLUGIN,
    surface,
    component: 'Pane',
    requestId: 'paqad',
    props: pane(surface).props,
  });
  await mounted.press({ key: `paqad-tab-${tab}` });
  await mounted.unmount();
  return $.ui.render(pane(surface));
}

describe("the pane's High Table tab", () => {
  for (const surface of TERMINAL) {
    test(`ORD-501 shows every seat, the rulings, the questions and the 12-line credit on ${surface}`, async ($, on) => {
      worldOf(on, {
        files: { ...ONBOARDED, [SNAPSHOT]: fileText({ ...FULL_ORD_501, verdict: null }) },
      });
      mock.clock(on, { now: NOW });
      await $.session.start(START);
      const drawn = await paneOn($, surface, 'table');
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
      const drawn = await paneOn($, surface, 'table');
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
        await mounted.find({ text: 'Run: 26.5K tokens, mostly the code it read (exact).' }),
      ).toBeDefined();
      await mounted.press({ key: 'paqad-seat-performance-analyst' });
      expect(
        await mounted.find({ text: 'Note: ~1.9K tokens of its 5K budget, within the ceiling.' }),
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
      const drawn = await paneOn($, surface, 'table');
      const lines = drawnLines(drawn);
      expect(lines.find((line) => line.includes(' Security auditor: '))).toContain(
        'late: its note landed after the spec was frozen',
      );
      const credit =
        'Who shaped the spec: no spec line. The High Table met after the spec was frozen.';
      expect(lines).toContain(credit);
      expect(colorOf(textElement(drawn, credit))).toBe('warning');
    });

    test(`the Ledger brings High Table forward while seats write, and a picked tab holds, on ${surface}`, async ($, on) => {
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

describe('the High Table as it moves', () => {
  for (const surface of TERMINAL) {
    test(`ORD-501's seats go seated, writing, done in order on ${surface}`, async ($, on) => {
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
        note('pane', seatStates(drawnLines(await paneOn($, surface, 'table'))));
      }
      for (const where of ['card', 'pane'] as const) {
        expect(Object.keys(seen[where])).toHaveLength(7);
        for (const states of Object.values(seen[where])) {
          expect(states).toEqual(['seated', 'writing', 'done']);
        }
      }
    });

    if (surface === 'terminal')
      test(`ORD-482's four seats write in parallel, tokens land with each note, then only dots on ${surface}`, async ($, on) => {
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
            band: textOf(await $.ui.render(band(surface, { bodyColumns: 120 }))),
            card: linesOf(await $.ui.render(toolUse(surface, 'tu-1', EXPERTS_COMMAND))).slice(1, 5),
          };
        };
        const [writing, landing, ruled] = ORD_482_SEQUENCE;
        const first = await look(writing!);
        expect(first.band).toContain('HIGH TABLE  0 of 4 notes');
        for (const line of first.card) {
          expect(line).toContain('writing for');
          expect(line).not.toContain('tokens');
        }
        const second = await look(landing!);
        expect(second.band).toContain('HIGH TABLE  2 of 4 notes');
        expect(second.card.filter((line) => line.includes('(exact)'))).toHaveLength(2);
        expect(second.card.find((line) => line.includes('Product owner'))).toContain(
          'done in 1m 39s, Note: ~',
        );
        expect(second.card.find((line) => line.includes('Product owner'))).toContain(
          'Run: 16.4K tokens, mostly the code it read (exact)',
        );
        const third = await look(ruled!);
        expect(third.band).toContain('HIGH TABLE  spec approved');
        expect(third.card.every((line) => line.includes('(exact)'))).toBe(true);
      });
  }
});

const planItems = (...words: string[]) => words.map((content) => ({ content, status: 'pending' }));

const FULL_PLAN = planItems(
  'Read the ticket',
  'Plan the change',
  'Spec: freeze it',
  'Load rules',
  'Build the export',
  'Review',
  'Checks',
  'Docs',
  'Open the PR',
);

async function updatePlan(
  $: Parameters<Parameters<typeof test>[1]>[0],
  input: Record<string, unknown>,
): Promise<unknown> {
  return $.tool.call({ tool: UPDATE_PLAN_TOOL, ...input } as never);
}

function servePlan(on: Parameters<Parameters<typeof test>[1]>[1]): void {
  on('tool.call', { tool: UPDATE_PLAN_TOOL }, () => ({ result: 'planned' }) as never);
}

describe('the task list carries the stages (AC-18)', () => {
  test('AC-18: a full-lane list without the stage words is refused once per turn with the lane sentence', async ($, on) => {
    worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(QUIET_501) }, store: QUIET_STORE() });
    servePlan(on);
    mock.clock(on, { now: NOW });
    await $.session.start(START);
    await $.prompt.submit({ text: 'build it' } as never);
    const bad = { items: planItems('Read the ticket', 'Write the code', 'Open the PR') };
    expect(await updatePlan($, bad)).toMatchObject({ deny: TASK_LIST_SENTENCES.full });
    expect(await updatePlan($, bad)).not.toHaveProperty('deny');
    await $.prompt.submit({ text: 'again' } as never);
    const outOfOrder = {
      items: planItems('Spec', 'Plan', 'Load rules', 'Build', 'Review', 'Checks', 'Docs'),
    };
    expect(await updatePlan($, outOfOrder)).toMatchObject({ deny: TASK_LIST_SENTENCES.full });
  });

  test('AC-18: the stage words in order pass with other items around them, and advance, done and start always pass', async ($, on) => {
    worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(QUIET_501) }, store: QUIET_STORE() });
    servePlan(on);
    mock.clock(on, { now: NOW });
    await $.session.start(START);
    await $.prompt.submit({ text: 'build it' } as never);
    expect(await updatePlan($, { items: FULL_PLAN })).not.toHaveProperty('deny');
    for (const action of ['advance', 'done', 'start']) {
      expect(
        await updatePlan($, { action, items: planItems('Write the code') }),
      ).not.toHaveProperty('deny');
    }
    expect(await updatePlan($, { status: 'done' })).not.toHaveProperty('deny');
    expect(await updatePlan($, { items: planItems('Write the code') })).toMatchObject({
      deny: TASK_LIST_SENTENCES.full,
    });
  });

  test('AC-18: the fast lane checks its own three words and says its own sentence', async ($, on) => {
    worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(FAST_ORD_490) } });
    servePlan(on);
    mock.clock(on, { now: NOW });
    await $.session.start(START);
    await $.prompt.submit({ text: 'fix it' } as never);
    expect(await updatePlan($, { items: planItems('plan', 'build', 'checks') })).not.toHaveProperty(
      'deny',
    );
    expect(await updatePlan($, { items: planItems('Plan', 'Checks') })).toMatchObject({
      deny: TASK_LIST_SENTENCES.fast,
    });
  });

  test('AC-18: other routes are never checked', async ($, on) => {
    worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(QUESTION) } });
    servePlan(on);
    mock.clock(on, { now: NOW });
    await $.session.start(START);
    await $.prompt.submit({ text: 'what is this?' } as never);
    expect(await updatePlan($, { items: planItems('Read the code') })).not.toHaveProperty('deny');
  });
});

type TestEngine = Parameters<Parameters<typeof test>[1]>[0];
type TestOn = Parameters<Parameters<typeof test>[1]>[1];

type PreToolUseAnswer = Record<string, unknown> | (() => unknown);

interface PreToolUseGate {
  seen: unknown[];
  answers: PreToolUseAnswer[];
  calls: number;
}

type PreToolUseHook = (
  $: unknown,
  e: { tool?: unknown; tool_use_id?: unknown },
  next: (e: unknown) => unknown,
) => unknown;

const GATE_DENY = { deny: 'RL-13 blocked the edit' };
const GATE_ASK = { ask: 'You allowed this edit once' };

function preToolUse(
  on: TestOn,
  answers: readonly PreToolUseAnswer[] = [GATE_DENY, GATE_ASK],
): PreToolUseGate {
  const gate: PreToolUseGate = { seen: [], answers: [...answers], calls: 0 };
  const hook: PreToolUseHook = ($, e, next) => {
    if (e.tool === 'AskUserQuestion') return next(e);
    gate.seen.push(e.tool_use_id);
    gate.calls += 1;
    const answer = gate.answers[gate.calls - 1];
    if (typeof answer === 'function') return answer();
    return answer ?? next(e);
  };
  on('classic.PreToolUse' as never, hook as never);
  return gate;
}

const RULE_STOP = {
  rule: 'RL-13',
  title: 'No comments in code',
  file: 'src/x.ts',
  tool_use_id: 'tu_1',
  managed: false,
  sole: true,
  at: '2026-10-20T10:00:00.000Z',
  diff: '+ // note',
  token: 'tok',
  used: false,
  session: SESSION_ID,
};

const RULE_STOP_ENTRY = `.paqad/.agent-entry-loaded.d/${SESSION_ID}`;

async function ruleStopped($: TestEngine, on: TestOn, record: Record<string, unknown> = RULE_STOP) {
  const world = worldOf(on, {
    files: {
      ...ONBOARDED,
      [SNAPSHOT]: fileText(FULL_ORD_501),
      [LAST_BLOCK]: JSON.stringify(record),
      [RULE_STOP_ENTRY]: '{}',
    },
  });
  const gate = preToolUse(on);
  mock.clock(on, { now: NOW });
  await $.session.start(START);
  return { world, gate };
}

function editCall(
  $: TestEngine,
  gate: PreToolUseGate,
  toolUseId = 'tu_1',
  tool = 'Edit',
  extra: Record<string, unknown> = {},
) {
  gate.calls = 0;
  return $.tool.call({
    tool,
    file_path: '/work/src/x.ts',
    tool_use_id: toolUseId,
    ...extra,
  } as never);
}

function expectDenied(result: unknown): void {
  expect(result).toMatchObject({ isError: true });
  expect(String((result as { result?: unknown }).result)).toContain('RL-13 blocked the edit');
}

function expectLanded(result: unknown): void {
  expect((result as { result?: unknown }).result).toBe('ok');
  expect((result as { isError?: unknown }).isError).not.toBe(true);
}

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

const outcomeArgv = (outcome: string) => [
  'paqad-ai',
  'rules',
  'override',
  '--outcome',
  outcome,
  '--rule',
  'RL-13',
  '--file',
  'src/x.ts',
  '--tool-use-id',
  'tu_1',
  '--session',
  SESSION_ID,
  '--project-root',
  '/work',
];

const overrideRuns = (world: World) => world.runs.filter((run) => run.argv.includes('--token'));

describe('a retried edit reaches PreToolUse again', () => {
  test('AC-1: Allow once runs the override and the same tool_use_id meets PreToolUse a second time', async ($, on) => {
    const { world, gate } = await ruleStopped($, on);
    world.answers.push('Allow once, recorded', 'No reason');
    const result = await editCall($, gate);
    expect(gate.seen).toEqual(['tu_1', 'tu_1']);
    expect(world.runs.map((run) => run.argv)).toEqual([OVERRIDE_ARGV, outcomeArgv('landed')]);
    expectLanded(result);
  });
});

describe('the rule stop answer on a denied edit', () => {
  test('AC-1: Allow once asks the rule stop question, runs the one override verb with the token and retries the call once', async ($, on) => {
    const { world, gate } = await ruleStopped($, on);
    world.answers.push('Allow once, recorded', 'No reason');
    expectLanded(await editCall($, gate));
    expect(world.asked[0]!.options).toEqual([
      'Let Claude fix it',
      'Allow once, recorded',
      'Show the rule',
    ]);
    expect(world.asked[0]!.question).toContain('RL-13 stopped this edit to src/x.ts');
    expect(overrideRuns(world)).toEqual([{ argv: OVERRIDE_ARGV, cwd: '/work', timeoutMs: 15_000 }]);
    expect(gate.seen).toEqual(['tu_1', 'tu_1']);
  });

  test('a typed reason is passed to the override as one argument', async ($, on) => {
    const { world, gate } = await ruleStopped($, on);
    world.answers.push('Allow once, recorded', 'needed for the hotfix');
    expectLanded(await editCall($, gate));
    expect(overrideRuns(world)[0]!.argv).toEqual([
      ...OVERRIDE_ARGV,
      '--reason=needed for the hotfix',
    ]);
  });

  test('a dismissed reason still records the override without one and retries the call', async ($, on) => {
    const { world, gate } = await ruleStopped($, on);
    world.answers.push('Allow once, recorded');
    expectLanded(await editCall($, gate));
    expect(overrideRuns(world)[0]!.argv).toEqual(OVERRIDE_ARGV);
    expect(gate.seen).toEqual(['tu_1', 'tu_1']);
  });

  test('AC-2: Let Claude fix it keeps the deny, retries nothing and marks the stop answered', async ($, on) => {
    const { world, gate } = await ruleStopped($, on);
    world.answers.push('Let Claude fix it');
    expectDenied(await editCall($, gate));
    expect(gate.seen).toEqual(['tu_1']);
    expectDenied(await editCall($, gate));
    expect(world.asked).toHaveLength(1);
    expect(world.runs).toEqual([]);
    expect(JSON.parse(world.files.get(LAST_BLOCK)!)).toEqual({ ...RULE_STOP, used: true });
    for (const surface of SURFACES) {
      expect(textOf(await $.ui.render(band(surface)))).not.toContain('Needs you');
    }
  });

  for (const answer of [null, undefined]) {
    test(`AC-2: a ${answer === null ? 'dismissed card' : 'missing answer'} keeps the deny and marks the stop answered`, async ($, on) => {
      const { world, gate } = await ruleStopped($, on);
      if (answer === null) world.answers.push(null);
      expectDenied(await editCall($, gate));
      expect(gate.seen).toEqual(['tu_1']);
      expect(world.runs).toEqual([]);
      expect(JSON.parse(world.files.get(LAST_BLOCK)!)).toEqual({ ...RULE_STOP, used: true });
    });
  }

  test('AC-2: Show the rule asks again with the rule text', async ($, on) => {
    const { world, gate } = await ruleStopped($, on);
    world.answers.push('Show the rule', 'Let Claude fix it');
    expectDenied(await editCall($, gate));
    expect(world.asked[1]!.question).toContain('No comments in code');
    expect(world.asked[1]!.options).toEqual(['Let Claude fix it', 'Allow once, recorded']);
    expect(world.runs).toEqual([]);
    expect(gate.seen).toEqual(['tu_1']);
  });

  test('AC-2: a managed stop offers nothing and names the organization', async ($, on) => {
    const { world, gate } = await ruleStopped($, on, { ...RULE_STOP, managed: true });
    expectDenied(await editCall($, gate));
    expect(world.asked).toEqual([]);
    expect(world.runs).toEqual([]);
    expect(world.toasts).toEqual(["This rule is enforced by your organization's settings."]);
    expect(gate.seen).toEqual(['tu_1']);
  });

  test('AC-2: a stop for an older tool call, a used token or another session asks nothing', async ($, on) => {
    const { world, gate } = await ruleStopped($, on);
    expectDenied(await editCall($, gate, 'tu_2'));
    world.put(LAST_BLOCK, JSON.stringify({ ...RULE_STOP, used: true }));
    expectDenied(await editCall($, gate));
    world.put(LAST_BLOCK, JSON.stringify({ ...RULE_STOP, session: 'other' }));
    expectDenied(await editCall($, gate));
    world.put(LAST_BLOCK, '{not json');
    expectDenied(await editCall($, gate));
    expect(world.asked).toEqual([]);
    expect(gate.seen).toEqual(['tu_2', 'tu_1', 'tu_1', 'tu_1']);
  });

  test('AC-2: a stop where another paqad gate also blocked the call offers nothing', async ($, on) => {
    const { world, gate } = await ruleStopped($, on, { ...RULE_STOP, sole: false });
    expectDenied(await editCall($, gate));
    expect(world.asked).toEqual([]);
    expect(world.runs).toEqual([]);
    expect(gate.seen).toEqual(['tu_1']);
  });

  test('AC-2: a pending decision packet keeps the deny and offers nothing', async ($, on) => {
    const { world, gate } = await ruleStopped($, on);
    world.put('.paqad/decisions/pending/D-01ABC.json', '{}');
    expectDenied(await editCall($, gate));
    expect(world.asked).toEqual([]);
    expect(world.runs).toEqual([]);
    expect(gate.seen).toEqual(['tu_1']);
  });

  test('AC-3: a call that comes back without a deny is returned as it came and nothing is asked', async ($, on) => {
    const { world, gate } = await ruleStopped($, on);
    gate.answers = [];
    world.answers.push('Allow once, recorded', 'No reason');
    expectLanded(await editCall($, gate));
    expect(gate.seen).toEqual(['tu_1']);
    expect(world.asked).toEqual([]);
    expect(world.runs).toEqual([]);
    expect(world.toasts).toEqual([]);
  });

  test('AC-2: a failure inside the offer keeps the deny', async ($, on) => {
    const { world, gate } = await ruleStopped($, on);
    world.unreadable.add(RULE_STOP_ENTRY);
    world.answers.push('Allow once, recorded', 'No reason');
    expectDenied(await editCall($, gate));
    expect(world.runs).toEqual([]);
    expect(gate.seen).toEqual(['tu_1']);
  });

  test('AC-2: a session that never loaded the framework is offered nothing', async ($, on) => {
    const { world, gate } = await ruleStopped($, on);
    world.remove(RULE_STOP_ENTRY);
    expectDenied(await editCall($, gate));
    expect(world.asked).toEqual([]);
    expect(world.runs).toEqual([]);
    expect(gate.seen).toEqual(['tu_1']);
  });

  test('a subagent edit the gate marked sole, because that subagent loaded the framework, is offered Allow once', async ($, on) => {
    const { world, gate } = await ruleStopped($, on);
    world.answers.push('Allow once, recorded', 'No reason');
    expectLanded(await editCall($, gate, 'tu_1', 'Edit', { agentId: 'agent-a1' }));
    expect(world.asked[0]!.options).toContain('Allow once, recorded');
    expect(overrideRuns(world)).toEqual([{ argv: OVERRIDE_ARGV, cwd: '/work', timeoutMs: 15_000 }]);
    expect(gate.seen).toEqual(['tu_1', 'tu_1']);
  });

  test('AC-2: a subagent edit the gate marked not sole, because its own entry marker is missing, keeps the deny and offers nothing', async ($, on) => {
    const { world, gate } = await ruleStopped($, on, { ...RULE_STOP, sole: false });
    expectDenied(await editCall($, gate, 'tu_1', 'Edit', { agentId: 'agent-a1' }));
    expect(world.asked).toEqual([]);
    expect(world.runs).toEqual([]);
    expect(world.files.get(RULE_STOP_ENTRY)).toBe('{}');
    expect(gate.seen).toEqual(['tu_1']);
  });

  test('AC-2: a failed or unstartable override keeps the deny', async ($, on) => {
    const { world, gate } = await ruleStopped($, on);
    world.run = { exitCode: 1, stdout: '', stderr: 'refused' };
    world.answers.push('Allow once, recorded', 'No reason');
    expectDenied(await editCall($, gate));
    expect(gate.seen).toEqual(['tu_1']);
    world.run = 'reject';
    world.answers.push('Allow once, recorded', 'No reason');
    expectDenied(await editCall($, gate));
    expect(gate.seen).toEqual(['tu_1', 'tu_1']);
    expect(world.runs).toHaveLength(2);
    expect(world.toasts).toHaveLength(2);
    const failures = world.logs.filter((log) => log.text.startsWith('paqad-ai rules override'));
    expect(failures).toHaveLength(2);
    expect(failures.every((log) => log.to === 'debug')).toBe(true);
    expect(failures[0]!.text).toContain('refused');
  });

  test('AC-2: an override that exits 0 without its recorded line keeps the deny', async ($, on) => {
    const { world, gate } = await ruleStopped($, on);
    world.run = { exitCode: 0, stdout: '', stderr: '' };
    world.answers.push('Allow once, recorded', 'No reason');
    expectDenied(await editCall($, gate));
    expect(gate.seen).toEqual(['tu_1']);
    expect(world.runs).toHaveLength(1);
    expect(world.toasts).toEqual([
      'paqad could not record the override, so the edit stays blocked.',
    ]);
    expect(
      world.logs.some(
        (log) => log.to === 'debug' && log.text.startsWith('paqad-ai rules override'),
      ),
    ).toBe(true);
  });

  test('Allow once covers one call and the next identical call is denied again', async ($, on) => {
    const { world, gate } = await ruleStopped($, on);
    world.answers.push('Allow once, recorded', 'No reason');
    expectLanded(await editCall($, gate));
    expectDenied(await editCall($, gate, 'tu_2'));
    expect(overrideRuns(world)).toHaveLength(1);
    expect(gate.seen).toEqual(['tu_1', 'tu_1', 'tu_2']);
  });

  test('a second edit to the same file under the same rule asks again and records a second override', async ($, on) => {
    const { world, gate } = await ruleStopped($, on);
    world.answers.push('Allow once, recorded', 'No reason');
    expectLanded(await editCall($, gate));
    world.put(LAST_BLOCK, JSON.stringify({ ...RULE_STOP, tool_use_id: 'tu_2', token: 'tok2' }));
    world.answers.push('Allow once, recorded', 'No reason');
    expectLanded(await editCall($, gate, 'tu_2'));
    expect(world.asked.filter((ask) => ask.options.includes('Allow once, recorded'))).toHaveLength(
      2,
    );
    expect(overrideRuns(world).map((run) => run.argv)).toEqual([
      OVERRIDE_ARGV,
      OVERRIDE_ARGV.map((arg) => (arg === 'tok' ? 'tok2' : arg === 'tu_1' ? 'tu_2' : arg)),
    ]);
  });

  test('AC-2, AC-6: a question that throws after the first call keeps the deny and runs nothing', async ($, on) => {
    const { world, gate } = await ruleStopped($, on);
    world.answers.push('throw');
    expectDenied(await editCall($, gate));
    expect(world.runs).toEqual([]);
    expect(gate.seen).toEqual(['tu_1']);
  });

  test('AC-5: a foreign PreToolUse deny on the retry keeps the edit denied, retried once and asked once', async ($, on) => {
    const { world, gate } = await ruleStopped($, on);
    gate.answers = [GATE_DENY, { deny: 'RL-13 blocked the edit, and so did another hook' }];
    world.answers.push('Allow once, recorded', 'No reason');
    expectDenied(await editCall($, gate));
    expect(gate.seen).toEqual(['tu_1', 'tu_1']);
    expect(world.asked.filter((ask) => ask.options.includes('Allow once, recorded'))).toHaveLength(
      1,
    );
    expect(world.runs.at(-1)!.argv).toEqual(outcomeArgv('still-blocked'));
  });

  test('an edit that fails as a tool with no paqad stop for its call is never retried', async ($, on) => {
    const { world, gate } = await ruleStopped($, on, { ...RULE_STOP, tool_use_id: 'tu_9' });
    world.answers.push('Allow once, recorded', 'No reason');
    expectDenied(await editCall($, gate));
    expect(gate.seen).toEqual(['tu_1']);
    expect(world.asked).toEqual([]);
  });

  test('a tool outside the edit tools passes through untouched', async ($, on) => {
    const { world, gate } = await ruleStopped($, on);
    world.answers.push('Allow once, recorded', 'No reason');
    expectDenied(await editCall($, gate, 'tu_1', 'Bash'));
    expect(gate.seen).toEqual(['tu_1']);
    expect(world.asked).toEqual([]);
    expect(world.runs).toEqual([]);
  });

  test('Write and NotebookEdit get the same answer as Edit', async ($, on) => {
    const { world, gate } = await ruleStopped($, on);
    for (const tool of ['Write', 'NotebookEdit']) {
      world.put(LAST_BLOCK, JSON.stringify(RULE_STOP));
      world.answers.push('Allow once, recorded', 'No reason');
      expectLanded(await editCall($, gate, 'tu_1', tool));
    }
    expect(gate.seen).toEqual(['tu_1', 'tu_1', 'tu_1', 'tu_1']);
    expect(overrideRuns(world)).toHaveLength(2);
  });

  test('AC-6: a failure beneath the hook runs the call once and asks nothing', async ($, on) => {
    const { world, gate } = await ruleStopped($, on);
    gate.answers = [];
    let ran = 0;
    world.during.set('Edit', async () => {
      ran += 1;
      throw new Error('edit failed');
    });
    await editCall($, gate).catch(() => undefined);
    expect(ran).toBe(1);
    expect(world.asked).toEqual([]);
  });

  test('INV-1: the mod never turns a deny into an allow, whatever the person picks', async ($, on) => {
    const { world, gate } = await ruleStopped($, on);
    gate.answers = [GATE_DENY, GATE_DENY];
    const results = [];
    for (const answers of [
      ['Allow once, recorded', 'No reason'],
      ['Let Claude fix it'],
      ['Show the rule', 'Allow once, recorded', 'needed'],
      [null],
      [],
    ]) {
      world.put(LAST_BLOCK, JSON.stringify(RULE_STOP));
      world.answers.push(...answers);
      results.push(await editCall($, gate));
    }
    for (const result of results) expectDenied(result);
  });
});

describe('the outcome line after an allowed-once retry', () => {
  test('AC-14: a retry that lands records landed', async ($, on) => {
    const { world, gate } = await ruleStopped($, on);
    world.answers.push('Allow once, recorded', 'No reason');
    expectLanded(await editCall($, gate));
    expect(world.runs.map((run) => run.argv)).toEqual([OVERRIDE_ARGV, outcomeArgv('landed')]);
    expect(world.runs[1]!.timeoutMs).toBe(15_000);
  });

  test('AC-14: a retry Claude Code asked about and then denied records refused', async ($, on) => {
    const { world, gate } = await ruleStopped($, on);
    gate.answers = [
      GATE_DENY,
      async () => {
        world.verdict = { decision: 'ask', reason: 'approve?' };
        await $.tool.check({ tool: 'Edit', input: {}, tool_use_id: 'tu_1' });
        return { deny: 'RL-13 blocked the edit: the person said no' };
      },
    ];
    world.answers.push('Allow once, recorded', 'No reason');
    expectDenied(await editCall($, gate));
    expect(world.runs.at(-1)!.argv).toEqual(outcomeArgv('refused'));
  });

  test('AC-14: an ask seen before the retry does not count, so a deny with no ask records still-blocked', async ($, on) => {
    const { world, gate } = await ruleStopped($, on);
    world.verdict = { decision: 'ask' };
    await $.tool.check({ tool: 'Edit', input: {}, tool_use_id: 'tu_1' });
    gate.answers = [GATE_DENY, GATE_DENY];
    world.answers.push('Allow once, recorded', 'No reason');
    expectDenied(await editCall($, gate));
    expect(world.runs.at(-1)!.argv).toEqual(outcomeArgv('still-blocked'));
  });

  test('AC-14: a failed outcome run leaves the returned result as it was', async ($, on) => {
    const { world, gate } = await ruleStopped($, on);
    for (const failure of [
      'reject',
      { exitCode: 1, stdout: '', stderr: 'outcome not recorded' },
    ] as const) {
      world.put(LAST_BLOCK, JSON.stringify(RULE_STOP));
      world.run = { exitCode: 0, stdout: OVERRIDE_RECORDED, stderr: '' };
      world.logs.length = 0;
      gate.answers = [
        GATE_DENY,
        () => {
          world.run = failure;
          return GATE_ASK;
        },
      ];
      world.answers.push('Allow once, recorded', 'No reason');
      expectLanded(await editCall($, gate));
      expect(world.runs.at(-1)!.argv).toEqual(outcomeArgv('landed'));
      expect(
        world.logs.some(
          (log) => log.to === 'debug' && log.text.startsWith('paqad-ai rules override failed'),
        ),
      ).toBe(true);
    }
  });

  test('AC-15: an override that leaves no allowed-once mark shows the update toast, keeps the deny and retries nothing', async ($, on) => {
    const { world, gate } = await ruleStopped($, on);
    world.marksAllowedOnce = false;
    world.answers.push('Allow once, recorded', 'No reason');
    expectDenied(await editCall($, gate));
    expect(gate.seen).toEqual(['tu_1']);
    expect(world.runs.map((run) => run.argv)).toEqual([OVERRIDE_ARGV]);
    expect(world.toasts).toEqual([ALLOW_ONCE_STALE_CLI]);
  });
});

describe('the permission reader', () => {
  test('AC-4: the mod hands every permission answer on exactly as it came', async ($, on) => {
    const { world } = await ruleStopped($, on);
    for (const verdict of [
      { decision: 'allow' as const },
      { decision: 'ask' as const, reason: 'check' },
      { decision: 'deny' as const, reason: 'RL-13 blocked the edit' },
      { decision: 'deny' as const, rule: 'Edit(src/**)' },
    ]) {
      world.verdict = verdict;
      for (const tool of ['Edit', 'Write', 'NotebookEdit', 'Bash']) {
        expect(
          await $.tool.check({ tool, input: { file_path: '/work/src/x.ts' }, tool_use_id: 'tu_1' }),
        ).toEqual(verdict);
      }
    }
    expect(world.asked).toEqual([]);
    expect(world.runs).toEqual([]);
  });
});

const TRUSTED = {
  ...FULL_ORD_501,
  gates: [
    { name: 'code-tests-lint', required: true, strength: 'deterministic', verdict: 'pass' },
    { name: 'quality-ratchet', required: true, strength: 'deterministic', verdict: 'inconclusive' },
  ],
  proof: FULL_ORD_501_PROOF.map((stage) =>
    stage.stage === 'checks'
      ? {
          ...stage,
          gates: (stage.gates as Array<Record<string, unknown>>).map((gate) =>
            gate.code === 'quality-ratchet' ? { ...gate, state: 'inconclusive' } : gate,
          ),
        }
      : stage,
  ),
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
  for (const surface of TERMINAL) {
    test(`a landed verdict opens on Trust, stages and gates in words, on ${surface}`, async ($, on) => {
      worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(TRUSTED) } });
      mock.clock(on, { now: NOW });
      await $.session.start(START);
      const drawn = await $.ui.render(pane(surface));
      const lines = drawnLines(drawn);
      expect(lines).toContain('Trust (shown)');
      expect(lines).toContain('Checks  ✓ Done');
      expect(lines).toContain('    Tests, types and lint pass  Pass');
      expect(lines).toContain('    Quality did not drop  Could not prove');
      expect(lines.some((line) => /\d+\/\d+ required|^Verdict /.test(line))).toBe(false);
      expect(colorOf(textElement(drawn, 'Pass'))).toBe('success');
      expect(colorOf(textElement(drawn, 'Could not prove'))).toBe('warning');
    });

    test(`a delivery in progress shows CI partly done on Ships on ${surface}`, async ($, on) => {
      worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(DELIVERING) } });
      mock.clock(on, { now: NOW });
      await $.session.start(START);
      const lines = drawnLines(await paneOn($, surface, 'ships'));
      expect(lines).toContain('Ships (shown)');
      expect(lines.some((line) => line.startsWith('CI           running, 3 of 7 done'))).toBe(true);
      expect(lines.some((line) => line.startsWith('Merge'))).toBe(false);
    });

    test(`a picked Record tab holds when the verdict lands and a delivery starts on ${surface}`, async ($, on) => {
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

    test(`each new tab names its empty state, and CI never saved reads unknown on ${surface}`, async ($, on) => {
      const bare = snapshot({ active: true, ship: null, rules: { recorded: true, applicable: 1 } });
      const world = worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(bare) } });
      mock.clock(on, { now: NOW });
      await $.session.start(START);
      const mounted = await mountPane($, surface);
      await mounted.press({ key: 'paqad-tab-trust' });
      expect(await mounted.find({ text: 'Nothing to prove yet' })).toBeDefined();
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

  test('the toast fires once per verdict across snapshot rebuilds', async ($, on) => {
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
    test(`a 60-row packet fills the host row cap with a "+N more" line above the engine card on ${surface}`, async ($, on) => {
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

    test(`a missing or unreadable packet, or one with no evidence, leaves the question alone on ${surface}`, async ($, on) => {
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

const BUILDING = {
  ...FAST_ORD_490,
  evidence_expected: [{ file: 'plan.json', expectation: 'always', present: true }],
};

function stageRow(
  surface: 'terminal' | 'desktop',
  id: string,
  command: string,
  over: Record<string, unknown> = {},
) {
  const input = toolUse(surface, id, command);
  return { ...input, props: { ...input.props, ...over } } as typeof input;
}

describe("chips for paqad's own calls", () => {
  for (const surface of SURFACES) {
    test(`a recorded stage call reads as a chip, an unrecorded one stays raw on ${surface}`, async ($, on) => {
      worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(BUILDING) }, band: ENGINE_ROW });
      mock.clock(on, { now: NOW });
      await $.session.start(START);
      const chip = await $.ui.render(
        stageRow(surface, 't1', 'SE_SESSION=s paqad-ai stage start development'),
      );
      expect(drawnLines(chip)).toEqual(['paqad ✓ Build started recorded']);
      expect(colorOf(textElement(chip, 'recorded'))).toBe('success');
      for (const command of ['paqad-ai stage start review', 'ls -la', 'paqad-ai status']) {
        expect(drawnLines(await $.ui.render(stageRow(surface, 't2', command)))).toEqual([
          'engine row',
        ]);
      }
    });

    test(`a failed or blocked call says so in words and colour on ${surface}`, async ($, on) => {
      worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(BUILDING) }, band: ENGINE_ROW });
      mock.clock(on, { now: NOW });
      await $.session.start(START);
      const blocked = await $.ui.render(
        stageRow(surface, 't3', 'paqad-ai stage end review', {
          isErrored: true,
          output: 'Stage end blocked: no artifact was recorded.',
        }),
      );
      expect(drawnLines(blocked)).toEqual(['paqad ! Review ended blocked']);
      expect(colorOf(textElement(blocked, 'blocked'))).toBe('warning');
      const failed = await $.ui.render(
        stageRow(surface, 't4', 'paqad-ai plan compile', { isErrored: true, output: 'boom' }),
      );
      expect(drawnLines(failed)).toEqual(['paqad ✗ Plan compiled failed']);
      expect(colorOf(textElement(failed, 'failed'))).toBe('error');
    });

    test(`a folded group shows chips in words and an expanded group shows the raw calls on ${surface}`, async ($, on) => {
      worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(BUILDING) }, band: ENGINE_ROW });
      mock.clock(on, { now: NOW });
      await $.session.start(START);
      const group = toolGroup(surface, [
        'paqad-ai stage start development',
        'paqad-ai stage end review',
        'paqad-ai stage start checks',
      ]);
      const calls = group.props.calls.map((call, index) =>
        index === 1 ? { ...call, isErrored: true, output: 'blocked by the stage gate' } : call,
      );
      const folded = await $.ui.render({ ...group, props: { ...group.props, calls } });
      expect(drawnLines(folded)).toEqual([
        'paqad ✓ Build started recorded  ! Review ended blocked',
        'engine row',
      ]);
      await $.ui.render({ ...group, props: { ...group.props, calls, isExpanded: true } });
      expect(
        drawnLines(await $.ui.render(stageRow(surface, 'g0', 'paqad-ai stage start development'))),
      ).toEqual(['engine row']);
    });

    test(`a group of only plain calls is left to the engine on ${surface}`, async ($, on) => {
      worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(BUILDING) }, band: ENGINE_ROW });
      mock.clock(on, { now: NOW });
      await $.session.start(START);
      expect(drawnLines(await $.ui.render(toolGroup(surface, ['ls', 'pwd'])))).toEqual([
        'engine row',
      ]);
    });

    test(`the spinner says the running stage and the footer the lane on ${surface}`, async ($, on) => {
      const world = worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(BUILDING) } });
      mock.clock(on, { now: NOW });
      await $.session.start(START);
      await $.ui.render({
        component: 'Spinner',
        surface,
        requestId: 'spin',
        props: { word: 'Sauteing', message: null, suffix: '…', mode: 'thinking' },
      } as never);
      await $.ui.render({
        component: 'SessionMode',
        surface,
        requestId: 'mode',
        props: { modes: ['auto'] },
      } as never);
      const spinner = world.drawn.find((entry) => entry.component === 'Spinner');
      const mode = world.drawn.find((entry) => entry.component === 'SessionMode');
      expect((spinner?.props as { word: string }).word).toBe('Building');
      expect((mode?.props as { modes: string[] }).modes).toEqual(['auto', 'paqad fast lane']);
    });
  }

  test('with no change in progress the spinner and footer keep the engine words', async ($, on) => {
    const world = worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(PAUSED) } });
    mock.clock(on, { now: NOW });
    await $.session.start(START);
    await $.ui.render({
      component: 'Spinner',
      surface: 'terminal',
      requestId: 'spin',
      props: { word: 'Sauteing', message: null, suffix: '…', mode: 'thinking' },
    } as never);
    await $.ui.render({
      component: 'SessionMode',
      surface: 'terminal',
      requestId: 'mode',
      props: { modes: [] },
    } as never);
    expect(
      (world.drawn.find((entry) => entry.component === 'Spinner')?.props as { word: string }).word,
    ).toBe('Sauteing');
    expect(
      (world.drawn.find((entry) => entry.component === 'SessionMode')?.props as { modes: string[] })
        .modes,
    ).toEqual([]);
  });
});

describe('the heartbeat and the chime', () => {
  test('the mod writes a heartbeat at start, on each prompt and every minute', async ($, on) => {
    const world = worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(FAST_ORD_490) } });
    const clock = mock.clock(on, { now: NOW });
    await $.session.start(START);
    expect(world.writes.map((write) => write.path)).toEqual([HEARTBEAT]);
    expect(JSON.parse(world.writes[0]!.text)).toEqual({
      session_id: SESSION_ID,
      written_at: new Date(NOW).toISOString(),
    });
    await $.prompt.submit({ text: 'go', origin: { kind: 'composer' } } as never);
    expect(world.writes).toHaveLength(2);
    await clock.advance(60_000);
    await clock.settle();
    expect(world.writes.length).toBeGreaterThanOrEqual(3);
    expect(new Set(world.writes.map((write) => write.path))).toEqual(new Set([HEARTBEAT]));
  });

  test('AC-12: a root with a trailing separator writes under <root>/.paqad/session/hud/', async ($, on) => {
    const world = worldOf(on, {
      files: { ...ONBOARDED, [SNAPSHOT]: fileText(FAST_ORD_490) },
      root: '/work/',
    });
    mock.clock(on, { now: NOW });
    await $.session.start({ ...START, cwd: '/work/' });
    expect(world.writes.map((write) => write.path)).toEqual([HEARTBEAT]);
  });

  test('AC-12: a session id with path characters is made safe in the heartbeat file name', async ($, on) => {
    const world = worldOf(on, {
      files: { ...ONBOARDED, '.paqad/session/hud/s_1_x.json': fileText(FAST_ORD_490) },
      sessionId: 's/1:x',
    });
    mock.clock(on, { now: NOW });
    await $.session.start(START);
    expect(world.writes.map((write) => write.path)).toEqual(['.paqad/session/hud/s_1_x.live']);
  });

  test('AC-12: a project root of / stays / and writes under /.paqad/session/hud/', async ($, on) => {
    const world = worldOf(on, {
      files: { '/.paqad/framework-path.txt': '~/.paqad-ai/current\n' },
      root: '/',
    });
    mock.clock(on, { now: NOW });
    await $.session.start({ ...START, cwd: '/' });
    expect(world.writes.map((write) => write.path)).toEqual([
      `/.paqad/session/hud/${SESSION_ID}.live`,
    ]);
  });

  test('a mod that stands down writes no heartbeat', async ($, on) => {
    const world = worldOf(on, {
      files: { ...ONBOARDED, [SNAPSHOT]: fileText(FAST_ORD_490) },
      env: { PAQAD_DISABLED: '1' },
    });
    mock.clock(on, { now: NOW });
    await $.session.start(START);
    await $.prompt.submit({ text: 'go', origin: { kind: 'composer' } } as never);
    expect(world.writes).toEqual([]);
  });

  async function landVerdictTwice(
    $: Parameters<Parameters<typeof test>[1]>[0],
    world: ReturnType<typeof worldOf>,
  ) {
    world.put(SNAPSHOT, fileText(SAFE_CLEAN));
    await $.tool.call({ tool: 'Bash', command: 'paqad-ai status' } as never);
    world.put(SNAPSHOT, fileText({ ...SAFE_CLEAN, generated_at: '2026-10-18T09:05:00.000Z' }));
    await $.tool.call({ tool: 'Bash', command: 'paqad-ai status' } as never);
  }

  test('with hud_chime unset nothing plays and nothing is spoken', async ($, on) => {
    const world = worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(FAST_ORD_490) } });
    mock.clock(on, { now: NOW });
    await $.session.start(START);
    await landVerdictTwice($, world);
    expect(world.toasts).toHaveLength(1);
    expect(world.played).toEqual([]);
    expect(world.spoken).toEqual([]);
  });

  for (const [name, options] of [
    ['the env variable', { env: { PAQAD_HUD_CHIME: 'true' } }],
    ['the team app config', { files: { '.paqad/configs/.config.app': 'hud_chime=true\n' } }],
  ] as const) {
    test(`hud_chime on through ${name} plays once per verdict and never speaks`, async ($, on) => {
      const world = worldOf(on, {
        ...options,
        files: {
          ...ONBOARDED,
          [SNAPSHOT]: fileText(FAST_ORD_490),
          ...('files' in options ? options.files : {}),
        },
      });
      mock.clock(on, { now: NOW });
      await $.session.start(START);
      await landVerdictTwice($, world);
      expect(world.played).toHaveLength(1);
      const clip = world.played[0] as Record<string, unknown>;
      expect(Object.keys(clip).sort()).toEqual(['base64', 'mime']);
      expect(typeof clip.base64).toBe('string');
      expect(clip.mime).toBe('audio/wav');
      expect(clip).not.toHaveProperty('url');
      expect(clip).not.toHaveProperty('asset');
      expect(world.spoken).toEqual([]);
    });
  }
});

const CI_WATCHED = SCENE_FIXTURES['Shipping with CI live'];
const shipOf = (fixture: Record<string, unknown>) => fixture.ship as Record<string, unknown>;
const ciOf = (fixture: Record<string, unknown>) => shipOf(fixture).ci as Record<string, unknown>;

function ciFixture(state: string, over: Record<string, unknown> = {}) {
  return snapshot({
    ...CI_WATCHED,
    ship: { ...shipOf(CI_WATCHED), ci: { ...ciOf(CI_WATCHED), state }, ...over },
  });
}

function prFixture(prState: string) {
  return snapshot({ ...CI_WATCHED, ship: { ...shipOf(CI_WATCHED), pr_state: prState } });
}

function newHeadFixture(head: string) {
  const ship = shipOf(CI_WATCHED);
  return snapshot({
    ...CI_WATCHED,
    ship: {
      ...ship,
      pr: { ...(ship.pr as Record<string, unknown>), head_sha: head },
      ci: { ...ciOf(CI_WATCHED), sha: head },
    },
  });
}

const refreshRuns = (world: World) =>
  world.runs.filter((run) => run.argv.includes('delivery-link'));

const REFRESH_TAIL = (seconds: string) => [
  'delivery-link',
  'refresh',
  '--session',
  SESSION_ID,
  '--project-root',
  '/work',
  '--min-age-seconds',
  seconds,
];

const signedOut = {
  exitCode: 0,
  stdout: '{"refreshed":false,"reason":"gh is signed out"}\n',
  stderr: '',
};

describe('the HUD follows CI while an open PR is pending', () => {
  test('AC-16: the first check runs the fixed refresh 30 s in, through the shipped paqad-ai', async ($, on) => {
    const world = worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(CI_WATCHED) } });
    const clock = mock.clock(on, { now: NOW });
    await $.session.start(START);
    await clock.advance(29_999);
    await clock.settle();
    expect(refreshRuns(world)).toEqual([]);
    await clock.advance(1);
    await clock.settle();
    const runs = refreshRuns(world);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.argv[0]).toMatch(/(^|\/)runtime\/claude-plugin\/bin\/paqad-ai$|^paqad-ai$/);
    expect(runs[0]!.argv.slice(1)).toEqual(REFRESH_TAIL('30'));
    expect(runs[0]!.cwd).toBe('/work');
    expect(runs[0]!.timeoutMs).toBe(15_000);
  });

  test('AC-5: the checks back off 30 s, 60 s, 120 s while CI stays pending', async ($, on) => {
    const world = worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(CI_WATCHED) } });
    const clock = mock.clock(on, { now: NOW });
    await $.session.start(START);
    for (const step of [30_000, 60_000, 120_000]) {
      await clock.advance(step);
      await clock.settle();
    }
    expect(refreshRuns(world).map((run) => run.argv.at(-1))).toEqual(['30', '60', '120']);
  });

  test('AC-5: the watch never starts without an open PR whose CI is pending', async ($, on) => {
    const world = worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(FULL_ORD_501) } });
    const clock = mock.clock(on, { now: NOW });
    await $.session.start(START);
    await clock.advance(600_000);
    await clock.settle();
    expect(refreshRuns(world)).toEqual([]);
  });

  for (const [name, next] of [
    ['pass', ciFixture('pass')],
    ['fail', ciFixture('fail')],
    ['closed', prFixture('closed')],
    ['merged', prFixture('merged')],
  ] as const) {
    test(`AC-5: the watch stops once the refresh reads ${name}`, async ($, on) => {
      const world = worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(CI_WATCHED) } });
      world.onRun = () => world.put(SNAPSHOT, fileText(next));
      const clock = mock.clock(on, { now: NOW });
      await $.session.start(START);
      await clock.advance(30_000);
      await clock.settle();
      await clock.advance(3_600_000);
      await clock.settle();
      expect(refreshRuns(world)).toHaveLength(1);
    });
  }

  test('AC-6: one refresh at a time, and a snapshot reload starts no second timer', async ($, on) => {
    const world = worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(CI_WATCHED) } });
    let release: () => void = () => {};
    world.runGate = new Promise<void>((done) => {
      release = done;
    });
    const clock = mock.clock(on, { now: NOW });
    await $.session.start(START);
    await clock.advance(30_000);
    await $.tool.call({ tool: 'Bash', command: 'paqad-ai status' } as never);
    world.put(
      SNAPSHOT,
      fileText(snapshot({ ...CI_WATCHED, generated_at: '2026-10-18T09:00:01.000Z' })),
    );
    await $.tool.call({ tool: 'Bash', command: 'paqad-ai status' } as never);
    await clock.advance(120_000);
    expect(refreshRuns(world)).toHaveLength(1);
    world.runGate = null;
    release();
    await clock.settle();
    await clock.advance(59_999);
    await clock.settle();
    expect(refreshRuns(world)).toHaveLength(1);
    await clock.advance(1);
    await clock.settle();
    expect(refreshRuns(world)).toHaveLength(2);
  });

  test('AC-17: after 60 minutes the watch pauses with a note, and a git push starts it again', async ($, on) => {
    const world = worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(CI_WATCHED) } });
    const clock = mock.clock(on, { now: NOW });
    await $.session.start(START);
    for (let minute = 0; minute < 70; minute += 1) {
      await clock.advance(60_000);
      await clock.settle();
    }
    const polls = refreshRuns(world).length;
    expect(polls).toBeGreaterThan(10);
    expect(polls).toBeLessThanOrEqual(16);
    expect((await $.command.run(command('status'))).text).toContain(
      'CI updates paused: checked for 60 minutes',
    );
    await $.tool.call({ tool: 'Bash', command: 'git push origin HEAD' } as never);
    await clock.advance(30_000);
    await clock.settle();
    expect(refreshRuns(world)).toHaveLength(polls + 1);
    expect((await $.command.run(command('status'))).text).not.toContain('CI updates paused');
  });

  test('AC-17: a pending CI on a newer PR head restarts the watch by itself', async ($, on) => {
    const world = worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(CI_WATCHED) } });
    world.run = signedOut;
    const clock = mock.clock(on, { now: NOW });
    await $.session.start(START);
    await clock.advance(30_000);
    await clock.settle();
    await clock.advance(60_000);
    await clock.settle();
    expect(refreshRuns(world)).toHaveLength(2);
    world.run = { exitCode: 0, stdout: '{"refreshed":true,"reason":null}\n', stderr: '' };
    world.put(SNAPSHOT, fileText(newHeadFixture('bbb2222')));
    await $.tool.call({ tool: 'Bash', command: 'paqad-ai status' } as never);
    await clock.advance(30_000);
    await clock.settle();
    expect(refreshRuns(world)).toHaveLength(3);
  });

  test('AC-24: two signed-out reads in a row stop the watch, and Done stays', async ($, on) => {
    const world = worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(CI_WATCHED) } });
    world.run = signedOut;
    const clock = mock.clock(on, { now: NOW });
    await $.session.start(START);
    await clock.advance(30_000);
    await clock.settle();
    await clock.advance(60_000);
    await clock.settle();
    await clock.advance(600_000);
    await clock.settle();
    expect(refreshRuns(world)).toHaveLength(2);
    const text = (await $.command.run(command('status'))).text;
    expect(text).toContain('CI updates paused: gh is signed out');
    expect(world.asked).toEqual([]);
  });

  test('AC-26: once the HUD unbinds, a scheduled check never runs', async ($, on) => {
    const world = worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(CI_WATCHED) } });
    const clock = mock.clock(on, { now: NOW });
    await $.session.start(START);
    world.remove('.paqad/framework-path.txt');
    await $.session.start(START);
    await clock.advance(600_000);
    await clock.settle();
    expect(refreshRuns(world)).toEqual([]);
  });
});
