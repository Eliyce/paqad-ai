import type { RenderElement, RenderNode } from 'claude-code';
import { describe, expect, mock, test } from 'claude-code/testing';

import { ANSWER_TOAST, localTime } from './desktop-view';
import {
  EXPERTS_OFF,
  FAST_ORD_490,
  FAST_ORD_490_COST,
  FULL_ORD_501,
  FULL_ORD_501_COST,
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
  Stopped: 'error',
  Inconclusive: 'warning',
  'Safe to merge': 'success',
  'Needs your attention': 'error',
  Paused: null,
};

describe('the band is one card in the tone of its state (AC-41, FR-31)', () => {
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

describe('the band on each fixture change (AC-40, AC-42)', () => {
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

    test(`graduated lane: Needs you and the HIGH TABLE asking for answers on ${surface}`, async ($, on) => {
      worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(GRADUATED_ORD_482) } });
      mock.clock(on, { now: NOW });
      await $.session.start(START);
      const text = textOf(await $.ui.render(band(surface, { bodyColumns: 120 })));
      expect(text).toContain('Needs you: 1 decision waiting.');
      expect(text).toContain('HIGH TABLE');
      expect(text).toContain('needs answers');
    });

    test(`an open flag at Safe to merge turns the band amber on ${surface} (AC-41)`, async ($, on) => {
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

    test(`no snapshot yet shows the idle line, never an empty or stale card, on ${surface} (FR-39, AC-42)`, async ($, on) => {
      worldOf(on, { files: { ...ONBOARDED } });
      mock.clock(on, { now: NOW });
      await $.session.start(START);
      const text = textOf(await $.ui.render(band(surface)));
      expect(text).toContain('paqad');
      expect(text).toContain('feature development · no change in progress');
      expect(text).not.toContain('STAGE');
    });

    test(`a half-written snapshot shows the idle line and never throws on ${surface}`, async ($, on) => {
      worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: '{"schema":"paqad.hud/3","headl' } });
      mock.clock(on, { now: NOW });
      await $.session.start(START);
      const text = textOf(await $.ui.render(band(surface)));
      expect(text).toContain('no change in progress');
      expect(text).toContain('HUD data unavailable');
      expect(text).not.toContain('Safe to merge');
    });
  }

  for (const surface of SURFACES) {
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
      expect(lines[0]).toStartWith('paqad');
      expect(lines.at(-1)).toBe('another mod');
    });
  }
});

const ALL_GREEN = {
  ...FULL_ORD_501,
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

describe('the ship rail on each surface (FR-35, FR-36, AC-44, AC-45)', () => {
  test('the terminal draws marks and never an Svg; Desktop draws the rail Svg with words', async ($, on) => {
    worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(ALL_GREEN) } });
    mock.clock(on, { now: NOW });
    await $.session.start(START);
    const terminal = await $.ui.render(band('terminal', { bodyColumns: 120 }));
    expect(elementsOf(terminal, 'Svg')).toEqual([]);
    expect(textOf(terminal)).toContain('All green · merge is yours');
    const desktop = await $.ui.render(band('desktop', { bodyColumns: 93 }));
    const svgs = elementsOf(desktop, 'Svg');
    expect(svgs).toHaveLength(1);
    const props = (svgs[0] as { props: { alt?: string; width?: unknown; height?: unknown } })
      .props;
    expect(props.alt).toMatch(/ is ready for your merge\. Stage .*Delivery Merge is yours\.$/);
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
    const green = world.toasts.filter((text) => text.startsWith('All green'));
    expect(green).toHaveLength(1);
    expect(green[0]).toBe(`All green: PR ${'#'}12 is ready for your merge`);
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

describe('other workflows get one status entry and no band (FR-44, AC-40)', () => {
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

describe('minimise, close and hide (FR-46 to FR-52, AC-33 to AC-36, AC-47)', () => {
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

    test(`AC-34: Hide always in another project leaves this band showing on ${surface}`, async ($, on) => {
      const store = new Map<string, unknown>([['band.hidden:/elsewhere', true]]);
      worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(FULL_ORD_501) }, store });
      mock.clock(on, { now: NOW });
      await $.session.start(START);
      expect(cardOf(await $.ui.render(band(surface, { bodyColumns: 120 })))).toBeDefined();
    });

    test(`AC-35: a dismissed close question changes nothing on ${surface}`, async ($, on) => {
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

    test(`AC-36: a pending decision turns the closed line amber, and pressing it brings the band back on ${surface}`, async ($, on) => {
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

describe('/paqad decisions lists every packet in the repo (AC-21)', () => {
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

describe('the paqad Ledger (FR-54 to FR-58, AC-32, AC-37 to AC-39)', () => {
  for (const surface of SURFACES) {
    if (surface === 'terminal')
    test(`AC-39: opens titled paqad Ledger, with its subtitle, the five tabs and Trust shown on ${surface}`, async ($, on) => {
      const world = worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(FULL_ORD_501) } });
      mock.clock(on, { now: NOW });
      await $.session.start(START);
      const lines = drawnLines(await $.ui.render(pane(surface)));
      expect(lines[0]).toBe('what happened, with proof');
      expect(lines.slice(1, 6)).toEqual(['Trust (shown)', 'High Table', 'Ships', 'Record', 'Cost']);
      expect(world.opened).toEqual(['paqad']);
    });

    if (surface === 'terminal') {
    test(`AC-32: the brand and the Proof Button open the Ledger on Trust, and High Table names who shaped the spec, on ${surface}`, async ($, on) => {
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

    test(`AC-38: the same target closes the Ledger, another switches its tab, a double press opens then closes, on ${surface}`, async ($, on) => {
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

    test(`AC-37: auto-opens once per change, never again across sessions, and keeps 50 changes at most on ${surface}`, async ($, on) => {
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
    expect(textOf(drawn)).toBe("paqad● paqad cannot read this session's record");
    expect(lightOf(drawn)).toBe('#F37748');
  });

  test('AC-5: a session id that cannot be read says the same', async ($, on) => {
    worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(FULL_ORD_501) }, sessionId: null });
    mock.clock(on, { now: NOW });
    await $.session.start(DESKTOP_START);
    expect(textOf(await $.ui.render(band('desktop')))).toContain(
      "paqad cannot read this session's record",
    );
  });

  test('draws Ready before the first snapshot, and Getting ready on the feature route with no change', async ($, on) => {
    const world = worldOf(on, { files: { ...ONBOARDED } });
    mock.clock(on, { now: NOW });
    await $.session.start(DESKTOP_START);
    expect(textOf(await $.ui.render(band('desktop')))).toBe('paqad   Ready');
    world.put(SNAPSHOT, fileText(snapshot({ route: 'feature-development' })));
    await $.tool.call({ tool: 'Edit', file_path: '/work/a.ts' } as never);
    const ready = await $.ui.render(band('desktop'));
    expect(textOf(ready)).toContain('Getting ready');
    expect(lightOf(ready)).toBe('#8E979D');
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

  test('AC-16: the card needs 5 rows, 6 with the menu, and falls back to the minimised row', async ($, on) => {
    worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(QUIET_501) }, store: QUIET_STORE() });
    mock.clock(on, { now: NOW });
    await $.session.start(DESKTOP_START);
    const keys = async (maxRows: number) => buttonKeys(await $.ui.render(band('desktop', { maxRows })));
    expect(await keys(4)).toContain('paqad-expand');
    expect(await keys(5)).toContain('paqad-minimise');
    const mounted = await mountDesktop($);
    await mounted.press({ key: 'paqad-close' });
    await mounted.unmount();
    const menu = await keys(5);
    expect(menu).toContain('paqad-expand');
    expect(menu).toContain('paqad-close-now');
    expect(await keys(6)).toContain('paqad-minimise');
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
  test('AC-19: opens on Trust with the subtitle, equal tabs, the tab rule, the light, the gates, the claims and the flags', async ($, on) => {
    worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(CLAIMED) }, store: QUIET_STORE() });
    mock.clock(on, { now: NOW });
    await $.session.start(DESKTOP_START);
    const tree = await $.ui.render(pane('desktop'));
    expectDesktopSafe(tree);
    const lines = drawnLines(tree);
    expect(lines[0]).toStartWith('What happened, with proof');
    expect(lines.slice(1, 6)).toEqual(['Trust', 'High Table', 'Delivery', 'Record', 'Cost']);
    const tabs = everyElement(tree).filter((element) => String(keyOf(element)).startsWith('paqad-tab-'));
    expect(tabs.map(keyOf)).toEqual(
      expect.arrayContaining(['paqad-tab-trust', 'paqad-tab-table', 'paqad-tab-cost']),
    );
    for (const box of tabs.filter((element) => element.type === 'Box')) {
      expect(propsOf(box).width).toBe('20%');
    }
    const trust = tabs.find((element) => keyOf(element) === 'paqad-tab-trust' && element.type === 'Button')!;
    expect(propsOf(trust)).toMatchObject({ plain: true, dimColor: false });
    const rule = everyElement(tree).find((element) => propsOf(element).alt === 'Trust tab is shown');
    expect(propsOf(rule!).height).toBe(2);
    expect(lines).toContain('● Safe to merge');
    expect(lines).toContain('2 of 2 required gates pass.');
    for (const line of ['GATES', 'Tests, types and lint pass', 'Checked by a script', 'Pass'])
      expect(lines).toContain(line);
    expect(lines).toContain('CLAIMS AND THE TESTS THAT PROVE THEM');
    expect(lines).toContain('AC-1  Claim 1');
    expect(lines).toContain('tests/claim-1.test.ts');
    expect(lines).not.toContain('AC-5  Claim 5');
    expect(lines).toContain('+2 more, all proven');
    expect(lines).toContain('⚑ 1 near-copy of existing code is open.');
    expect(lines).toContain('Open');
    const ring = everyElement(tree).find(
      (element) => propsOf(element).alt === '2 of 2 required gates pass',
    );
    expect(propsOf(ring!)).toMatchObject({ width: 92, height: 92 });
  });

  test('AC-20: the High Table tab draws the ring, the chief, Answer in chat and See each side, and the seat details', async ($, on) => {
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
    const pressed = await desktopPane($, ['paqad-answer', 'paqad-sides', 'paqad-seat-security-auditor']);
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

  test('AC-20: who shaped the spec reads each line from the bundle spec', async ($, on) => {
    const spec = ['# Spec', '- FR-1: Export the orders page to CSV', '- FR-2: Keep the filters', '- AC-1: A file downloads'];
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
    expect(lines).toContain('12 of 3 spec lines came from an expert note.');
    expect(lines).toContain('● Approved');
  });

  test('AC-21: Delivery draws one block per step with its node, and the Open PR link when the merge is ready', async ($, on) => {
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
    expect(lines).toContain('Everything is green. The merge is yours.');
    expect(lines).toContain('feat/x on origin');
    const nodes = everyElement(tree).filter(
      (element) => element.type === 'Svg' && propsOf(element).width === 24,
    );
    expect(nodes.length).toBeGreaterThan(3);
    const link = everyElement(tree).find((element) => element.type === 'Link');
    expect(propsOf(link!).href).toBe('https://example.test/pull/12');
    expect(stringsOf(link!).join('')).toBe(`Open PR ${'#'}12`);
  });

  test('AC-22, AC-23: Record lists the events in local time and Cost draws the total, the stages and the High Table', async ($, on) => {
    worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(CLAIMED) }, store: QUIET_STORE() });
    mock.clock(on, { now: NOW });
    await $.session.start(DESKTOP_START);
    const record = drawnLines(await desktopPane($, ['paqad-tab-record']));
    expect(record).toContain(`${localTime('2026-10-18T08:41:00.000Z')}   Plan done in 1m 41s`);
    expect(record).toContain(`${localTime('2026-10-18T08:42:00.000Z')}   Rules loaded: 12 apply`);
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

  test('AC-23: the fast lane leaves the High Table out of the tabs and the Cost tab', async ($, on) => {
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

  test('AC-24: another workflow gets a light and its cost, and an unreadable record says so', async ($, on) => {
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

describe('the band fits its box (AC-30, AC-43)', () => {
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
    expect(answers.decisions).toBe(
      'No decision is waiting in this repo. 4 resolved for this change.',
    );
    expect(answers.rules).toContain('Near-copies: 1 open.');
    expect(answers.receipt).toBe(RECEIPT_TEXT);
    expect(answers.cost).toContain('not yet');
  });
});

describe('the cost pill and the Cost tab (Part 23, AC-50, AC-53, AC-55)', () => {
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
      expect(strings.some((line) => line.startsWith('Basis: API-equivalent estimate.'))).toBe(true);
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
    test(`fast lane: the Cost tab shows no expert tokens on ${surface} (AC-53)`, async ($, on) => {
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

describe('the High Table in the band (AC-56, AC-57)', () => {
  for (const surface of TERMINAL) {
    test(`AC-56: the instrument on ORD-482 and ORD-501, never on ORD-490 or with the experts off, on ${surface}`, async ($, on) => {
      const world = worldOf(on, { files: { ...ONBOARDED } });
      mock.clock(on, { now: NOW });
      await $.session.start(START);
      const textFor = async (raw: Record<string, unknown>) => {
        world.put(SNAPSHOT, fileText(raw));
        await $.tool.call({ tool: 'Bash', command: 'paqad-ai status' } as never);
        return textOf(await $.ui.render(band(surface, { bodyColumns: 120 })));
      };
      expect(await textFor(GRADUATED_ORD_482)).toContain('HIGH TABLE  needs answers');
      expect(await textFor(FULL_ORD_501)).toContain('HIGH TABLE  spec approved');
      expect(await textFor(FAST_ORD_490)).not.toContain('HIGH TABLE');
      const off = await textFor(EXPERTS_OFF);
      expect(off).not.toContain('HIGH TABLE');
      expect(off).toContain('STAGE');
      expect(off).toContain('SHIP');
      expect(await textFor(SKIPPED_TABLE)).toContain('HIGH TABLE  skipped');
    });

    test(`AC-57: after the ruling the table reads approved and the flag sits in the header on ${surface}`, async ($, on) => {
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

describe("the pane's High Table tab (AC-59)", () => {
  for (const surface of TERMINAL) {
    test(`AC-59: ORD-501 shows every seat, the rulings, the questions and the 12-line credit on ${surface}`, async ($, on) => {
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

    test(`the Ledger opens on Trust with no pick, and a picked tab holds, on ${surface}`, async ($, on) => {
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
      expect((await mounted.find({ key: 'paqad-tab-trust' }))?.text).toBe('Trust (shown)');
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
  for (const surface of TERMINAL) {
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
      expect(third.band).toContain('HIGH TABLE  needs answers');
      expect(third.card.every((line) => line.includes('(exact)'))).toBe(true);
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
    sole: true,
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
        [ENTRY_SENTINEL]: '{}',
      },
    });
    world.verdict = DENY;
    mock.clock(on, { now: NOW });
    await $.session.start(START);
    return world;
  }

  const ENTRY_SENTINEL = `.paqad/.agent-entry-loaded.d/${SESSION_ID}`;

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

  test('AC-25: a typed reason is passed to the override as one argument', async ($, on) => {
    const world = await stopped($, on);
    world.answers.push('Allow once, recorded', 'needed for the hotfix');
    expect((await check($)).decision).toBe('allow');
    expect(world.runs[0]!.argv).toEqual([...OVERRIDE_ARGV, '--reason=needed for the hotfix']);
  });

  test('AC-25: a dismissed reason still records the override without one and allows the call', async ($, on) => {
    const world = await stopped($, on);
    world.answers.push('Allow once, recorded');
    expect((await check($)).decision).toBe('allow');
    expect(world.runs[0]!.argv).toEqual(OVERRIDE_ARGV);
  });

  test('AC-22: Let Claude fix it, a dismissed card or no answer keeps the deny, runs nothing and keeps the stop', async ($, on) => {
    const world = await stopped($, on);
    world.answers.push('Let Claude fix it', null);
    expect(await check($)).toEqual(DENY);
    expect(await check($)).toEqual(DENY);
    expect(await check($)).toEqual(DENY);
    expect(world.asked).toHaveLength(3);
    expect(world.runs).toEqual([]);
    expect(world.files.get(LAST_BLOCK)).toBe(JSON.stringify(STOP));
  });

  test('Show the rule asks again with the rule text', async ($, on) => {
    const world = await stopped($, on);
    world.answers.push('Show the rule', 'Let Claude fix it');
    expect(await check($)).toEqual(DENY);
    expect(world.asked[1]!.question).toContain('No comments in code');
    expect(world.asked[1]!.options).toEqual(['Let Claude fix it', 'Allow once, recorded']);
    expect(world.runs).toEqual([]);
  });

  test('AC-20, AC-21: a managed stop offers nothing and names the organization', async ($, on) => {
    const world = await stopped($, on, { ...STOP, managed: true });
    expect(await check($)).toEqual(DENY);
    expect(world.asked).toEqual([]);
    expect(world.runs).toEqual([]);
    expect(world.toasts).toEqual(["This rule is enforced by your organization's settings."]);
  });

  test('AC-21: a stop for an older tool call, a used token or another session asks nothing', async ($, on) => {
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

  test('a stop where another paqad gate also blocked the call offers nothing', async ($, on) => {
    const world = await stopped($, on, { ...STOP, sole: false });
    expect(await check($)).toEqual(DENY);
    expect(world.asked).toEqual([]);
    expect(world.runs).toEqual([]);
  });

  test('a pending decision packet keeps the deny and offers nothing', async ($, on) => {
    const world = await stopped($, on);
    world.put('.paqad/decisions/pending/D-01ABC.json', '{}');
    expect(await check($)).toEqual(DENY);
    expect(world.asked).toEqual([]);
    expect(world.runs).toEqual([]);
  });

  test('a deny from a permissions rule in settings offers nothing', async ($, on) => {
    const world = await stopped($, on);
    const ruled = { ...DENY, rule: 'Edit(src/**)' };
    world.verdict = ruled;
    expect(await check($)).toEqual(ruled);
    expect(world.asked).toEqual([]);
    expect(world.runs).toEqual([]);
  });

  test('a session that never loaded the framework is offered nothing', async ($, on) => {
    const world = await stopped($, on);
    world.remove(ENTRY_SENTINEL);
    expect(await check($)).toEqual(DENY);
    expect(world.asked).toEqual([]);
    expect(world.runs).toEqual([]);
  });

  const subagentCheck = ($: Parameters<Parameters<typeof test>[1]>[0]) =>
    $.tool.check({
      tool: 'Edit',
      input: { file_path: '/work/src/x.ts' },
      tool_use_id: 'tu_1',
      agentId: 'agent-a1',
    } as never);

  test('a subagent edit the gate marked sole, because that subagent loaded the framework, is offered Allow once', async ($, on) => {
    const world = await stopped($, on);
    world.answers.push('Allow once, recorded', 'No reason');
    expect((await subagentCheck($)).decision).toBe('allow');
    expect(world.asked[0]!.options).toContain('Allow once, recorded');
    expect(world.runs).toEqual([{ argv: OVERRIDE_ARGV, cwd: '/work', timeoutMs: 15_000 }]);
  });

  test('a subagent edit the gate marked not sole, because its own entry marker is missing, keeps the deny and offers nothing', async ($, on) => {
    const world = await stopped($, on, { ...STOP, sole: false });
    expect(await subagentCheck($)).toEqual(DENY);
    expect(world.asked).toEqual([]);
    expect(world.runs).toEqual([]);
    expect(world.files.get(ENTRY_SENTINEL)).toBe('{}');
  });

  test('AC-18, AC-21: a failed or unstartable override keeps the deny', async ($, on) => {
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

  test('AC-21: Allow once allows one call and the next identical call is denied again', async ($, on) => {
    const world = await stopped($, on);
    world.answers.push('Allow once, recorded', 'No reason');
    expect((await check($)).decision).toBe('allow');
    expect(await check($, 'tu_2')).toEqual(DENY);
    expect(world.runs).toHaveLength(1);
  });

  test('AC-23: a second edit to the same file under the same rule asks again and records a second override', async ($, on) => {
    const world = await stopped($, on);
    world.answers.push('Allow once, recorded', 'No reason');
    expect((await check($)).decision).toBe('allow');
    world.put(LAST_BLOCK, JSON.stringify({ ...STOP, tool_use_id: 'tu_2', token: 'tok2' }));
    world.answers.push('Allow once, recorded', 'No reason');
    expect((await check($, 'tu_2')).decision).toBe('allow');
    expect(world.asked.filter((ask) => ask.options.includes('Allow once, recorded'))).toHaveLength(
      2,
    );
    expect(world.runs.map((run) => run.argv)).toEqual([
      OVERRIDE_ARGV,
      OVERRIDE_ARGV.map((arg) => (arg === 'tok' ? 'tok2' : arg === 'tu_1' ? 'tu_2' : arg)),
    ]);
  });

  test('AC-21: a question that throws keeps the deny and runs nothing', async ($, on) => {
    const world = await stopped($, on);
    world.answers.push('throw');
    expect(await check($)).toEqual(DENY);
    expect(world.runs).toEqual([]);
  });

  test('AC-21: a failure beneath the guard keeps the edit denied', async ($, on) => {
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
  for (const surface of TERMINAL) {
    test(`a landed verdict opens on Trust, gates in words, on ${surface}`, async ($, on) => {
      worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(TRUSTED) } });
      mock.clock(on, { now: NOW });
      await $.session.start(START);
      const drawn = await $.ui.render(pane(surface));
      const lines = drawnLines(drawn);
      expect(lines).toContain('Trust (shown)');
      expect(lines).toContain('Gates ●~  1/2 required');
      expect(lines).toContain('  ● code-tests-lint  pass');
      expect(lines).toContain('  ~ review-quality  inconclusive');
      expect(colorOf(textElement(drawn, 'pass'))).toBe('success');
      expect(colorOf(textElement(drawn, 'inconclusive'))).toBe('warning');
    });

    test(`a delivery in progress shows CI partly done on Ships on ${surface}`, async ($, on) => {
      worldOf(on, { files: { ...ONBOARDED, [SNAPSHOT]: fileText(DELIVERING) } });
      mock.clock(on, { now: NOW });
      await $.session.start(START);
      const lines = drawnLines(await paneOn($, surface, 'ships'));
      expect(lines).toContain('Ships (shown)');
      expect(lines.some((line) => line.startsWith('CI           running, 3 of 7 done'))).toBe(true);
      expect(lines).toContain('Merge        The merge is always yours. paqad never merges.');
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

    test(`AC-41: a folded group shows chips in words and an expanded group shows the raw calls on ${surface}`, async ($, on) => {
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

  test('AC-45: with hud_chime unset nothing plays and nothing is spoken', async ($, on) => {
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
    test(`AC-45: hud_chime on through ${name} plays once per verdict and never speaks`, async ($, on) => {
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
      expect((world.played[0] as { mime: string }).mime).toBe('audio/wav');
      expect(world.spoken).toEqual([]);
    });
  }
});
