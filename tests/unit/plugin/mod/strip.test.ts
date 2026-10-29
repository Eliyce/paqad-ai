import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  BREATH,
  INK,
  PX_PER_COLUMN,
  SIGNAL,
  lightColor,
  signalColor,
} from '../../../../runtime/claude-plugin/mod/palette.ts';
import {
  STRIP_HEIGHT,
  escapeXml,
  hairline,
  liveHeadline,
  meter,
  miniStages,
  nodeIcon,
  strip,
  stripAlt,
  stripWidth,
  tabRule,
  tableRing,
  type Mark,
  type SeatState,
  type ShipState,
  type StageState,
  type StripInput,
} from '../../../../runtime/claude-plugin/mod/strip.ts';

const STRIP_SOURCE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../../../runtime/claude-plugin/mod/strip.ts'),
  'utf8',
);

const FULL = ['Intake', 'Plan', 'Spec', 'Build', 'Review', 'Checks', 'Docs', 'Deliver'];
const STEPS = ['Edit', 'Commit', 'Push', 'PR', 'CI'];
const INITIALS = ['SA', 'IA', 'DO', 'PO', 'AA', 'UF', 'QA'];

function marks<S>(labels: readonly string[], states: readonly S[]): Array<Mark<S>> {
  return labels.map((label, i) => ({ label, state: states[i]! }));
}

const stages = (...states: StageState[]) => marks(FULL, states);
const steps = (...states: ShipState[]) => marks(STEPS, states);
const seats = (...states: SeatState[]) => marks(INITIALS, states);

const SETTLED: StripInput = {
  columns: 93,
  stages: stages('skip', 'done', 'done', 'done', 'done', 'done', 'done', 'done'),
  stageValue: 'All stages done',
  seats: seats('done', 'done', 'done', 'done', 'done', 'done', 'done'),
  chief: 'done',
  tableValue: 'Spec approved',
  delivery: steps('done', 'done', 'done', 'done', 'done'),
  ci: null,
  deliveryValue: 'PR #N merged',
};

const draw = (over: Partial<StripInput> = {}) => strip({ ...SETTLED, ...over }).source;

function numbers(source: string, pattern: RegExp): number[] {
  return [...source.matchAll(pattern)].map((match) => Number(match[1]));
}

function textX(source: string, text: string): number | null {
  const match = new RegExp(`<text [^>]*x="([\\d.]+)"[^>]*>${text}</text>`).exec(source);
  return match ? Number(match[1]) : null;
}

const nodeCentres = (source: string) => [
  ...new Set(numbers(source, /<circle [^>]*cx="([\d.]+)"[^>]*r="8.5"/g)),
];

function connectors(source: string): Array<[number, number]> {
  return [
    ...source.matchAll(
      /<line class="(?:inks|faints)" x1="([\d.]+)" y1="25" x2="([\d.]+)" y2="25" stroke-width="1.2"/g,
    ),
  ].map((match) => [Number(match[1]), Number(match[2])]);
}

const PALETTE = new Set(
  [
    INK.ink,
    INK.inkDark,
    INK.muted,
    INK.mutedDark,
    INK.headline,
    INK.headlineDark,
    ...Object.values(SIGNAL),
  ].map((colour) => colour.toUpperCase()),
);
const colours = (source: string) => source.match(/#[0-9A-Fa-f]{6}\b/g) ?? [];

describe('the strip geometry', () => {
  it('is round(bodyColumns × 8.5) wide with a minimum of 480, and 52 high', () => {
    expect(PX_PER_COLUMN).toBe(8.5);
    expect(stripWidth(57)).toBe(485);
    expect(stripWidth(93)).toBe(791);
    expect(stripWidth(40)).toBe(480);
    const drawn = strip({ ...SETTLED, columns: 93 });
    expect(drawn).toMatchObject({ width: 791, height: 52 });
    expect(STRIP_HEIGHT).toBe(52);
    expect(drawn.source).toContain('viewBox="0 0 791 52" width="791" height="52"');
    expect(drawn.source).not.toContain('preserveAspectRatio');
  });

  it('splits STAGE 40%, HIGH TABLE 26% and DELIVERY 34%, or 56% and 44% without a table', () => {
    const withTable = draw();
    expect(numbers(withTable, /<line class="hair" x1="([\d.]+)" y1="1"/g)).toEqual([316.4, 522.1]);
    expect(withTable).toContain('>HIGH TABLE</text>');
    const without = draw({ seats: null });
    expect(numbers(without, /<line class="hair" x1="([\d.]+)" y1="1"/g)).toEqual([443]);
    expect(without).not.toContain('HIGH TABLE');
    expect(without).toContain('>STAGE</text>');
    expect(without).toContain('>DELIVERY</text>');
  });

  it('insets the last section 7 px so its value lines up with the close glyph', () => {
    expect(textX(draw(), 'PR #N merged')).toBe(791 - 7);
    expect(textX(draw({ seats: null, columns: 57 }), 'PR #N merged')).toBe(485 - 7);
    expect(textX(draw(), 'All stages done')).toBe(316.4 - 18);
  });

  it('draws a section value only when the section is wider than 150 px', () => {
    expect(draw({ columns: 93 })).toContain('>Spec approved</text>');
    expect(draw({ columns: 57 })).not.toContain('Spec approved');
    expect(draw({ stageValue: '' })).not.toContain('class="val ink" x="298.4"');
  });

  it('AC-11: stops every connector 4 px short of the nodes it joins', () => {
    const source = draw({ seats: null });
    const centres = nodeCentres(source);
    expect(centres).toHaveLength(5);
    const lines = connectors(source);
    expect(lines).toHaveLength(4);
    lines.forEach(([from, to], i) => {
      expect(from).toBeCloseTo(centres[i]! + 8.5 + 4, 1);
      expect(to).toBeCloseTo(centres[i + 1]! - 8.5 - 4, 1);
    });
  });

  it('AC-11: caps the node spacing at 96 px and insets the nodes 12 px from the section', () => {
    const two = draw({ delivery: marks(['Edit', 'Commit'], ['done', 'todo'] as ShipState[]) });
    const [first, second] = nodeCentres(two);
    expect(second! - first!).toBeCloseTo(96, 1);
    expect(first).toBeCloseTo(522.1 + 18 + 12 + 8.5, 1);
    const one = draw({ delivery: marks(['Edit'], ['done'] as ShipState[]) });
    expect(nodeCentres(one)).toHaveLength(1);
    expect(connectors(one)).toEqual([]);
  });

  it('AC-11: keeps the nodes round and the CI arc clear of its label', () => {
    const source = draw({
      delivery: steps('done', 'done', 'done', 'done', 'run'),
      ci: 0.5,
    });
    expect(source).toMatch(/viewBox="0 0 791 52" width="791" height="52"/);
    expect(source).not.toMatch(/<ellipse/);
    const arc =
      /<circle class="accs" cx="[\d.]+" cy="25" r="([\d.]+)" fill="none" stroke-width="([\d.]+)"/.exec(
        source,
      );
    expect(arc).not.toBeNull();
    const bottom = 25 + Number(arc![1]) + Number(arc![2]) / 2;
    expect(bottom).toBeLessThan(47 - 9);
    const length = 2 * Math.PI * Number(arc![1]);
    expect(source).toContain(
      `stroke-dasharray="${(length * 0.5).toFixed(1)} ${length.toFixed(1)}"`,
    );
  });

  it('draws only the stages and delivery steps it is given', () => {
    const fast = draw({
      seats: null,
      stages: marks(['Plan', 'Build', 'Checks'], ['done', 'run', 'todo'] as StageState[]),
      delivery: marks(['Edit'], ['run'] as ShipState[]),
    });
    for (const label of ['Plan', 'Build', 'Checks', 'Edit']) {
      expect(fast).toMatch(new RegExp(`[> ]${label}</text>`));
    }
    for (const label of ['Intake', 'Spec', 'Review', 'Docs', 'Commit', 'CI']) {
      expect(fast).not.toMatch(new RegExp(`[> ]${label}</text>`));
    }
  });
});

describe('AC-18 / AC-19: strip motion keeps its place across re-renders', () => {
  const withStage = (state: StageState, clockMs?: number) =>
    draw({
      stages: stages('skip', 'done', state, 'todo', 'todo', 'todo', 'todo', 'todo'),
      ...(clockMs === undefined ? {} : { clockMs }),
    });
  const withoutClasses = (source: string) => source.replace(/ class="[^"]*"/g, '');

  it('running, paused and marked share one skeleton: only classes change', () => {
    const run = withoutClasses(withStage('run', 0));
    expect(withoutClasses(withStage('paused', 0))).toBe(run);
    expect(withoutClasses(withStage('marked', 0))).toBe(run);
    expect(withStage('paused', 0)).not.toBe(withStage('run', 0));
  });

  it('every animation starts at a phase taken from the shared clock', () => {
    const at0 = withStage('run', 0);
    const at1 = withStage('run', 1000);
    expect(at0).toContain('.pulse{animation-delay:-0.000s}');
    expect(at1).toContain('.pulse{animation-delay:-1.000s}');
    expect(at1).toContain('.spin{animation-delay:-1.000s}');
    expect(at0).toContain('begin="-0.000s"');
    expect(at1).toContain('begin="-1.000s"');
    expect(withStage('run', 4600)).toContain('.spin{animation-delay:-0.600s}');
  });

  it('honours reduced motion and keeps the state readable from colour', () => {
    const source = withStage('run', 0);
    expect(source).toContain('@media (prefers-reduced-motion: reduce){');
    expect(source).toMatch(/<rect class="acc pulse"/);
  });
});

describe('the strip marks', () => {
  it('draws a running stage pink with a glow, a pulse and a sweeping sheen', () => {
    const source = draw({
      stages: stages('skip', 'done', 'run', 'todo', 'todo', 'todo', 'todo', 'todo'),
    });
    expect(source).toContain('filter="url(#glow)"');
    expect(source).toContain('<animate attributeName="opacity" values=".55;.15;.55" dur="1.6s"');
    expect(source).toMatch(/<rect class="acc pulse"/);
    expect(source).toContain('fill="url(#sheen)"');
    expect(source).toContain('dur="2.2s" calcMode="spline" keyTimes="0;1" keySplines=".4 0 .2 1"');
    expect(source).toMatch(/<text class="lbl acc cur"[^>]*>Spec<\/text>/);
  });

  it('draws paused coral without motion, marked amber with an ink label, failed red', () => {
    const source = draw({
      stages: stages('skip', 'done', 'paused', 'marked', 'fail', 'todo', 'todo', 'todo'),
    });
    expect(source).toMatch(/<text class="lbl att cur"[^>]*>Spec<\/text>/);
    expect(source).toMatch(/<text class="lbl ink"[^>]*>Build<\/text>/);
    expect(source).toMatch(/<text class="lbl fail cur"[^>]*>Review<\/text>/);
    expect(source.match(/<rect class="att"/g)).toHaveLength(1);
    expect(source.match(/<rect class="cau"/g)).toHaveLength(1);
    expect(source).toMatch(/<rect class="fail"/);
    expect(source).not.toMatch(/class="[^"]*pulse/);
    expect(source).not.toMatch(/class="[^"]*(?<!off )motion"/);
  });

  it('draws not required as a dashed faint line and not yet as a faint bar', () => {
    const source = draw({
      stages: stages('skip', 'todo', 'todo', 'todo', 'todo', 'todo', 'todo', 'todo'),
    });
    expect(source).toMatch(/<line class="faints" [^>]*stroke-dasharray="2 3"/);
    expect(source.match(/<rect class="faint"/g)).toHaveLength(7);
    expect(source).toMatch(/<text class="lbl mut"[^>]*>Intake<\/text>/);
  });

  it('draws the High Table seats, a late seat in amber and the chief by its state', () => {
    const writing = draw({
      seats: seats('done', 'writing', 'late', 'seated', 'done', 'done', 'done'),
      chief: 'ruling',
    });
    expect(writing).toMatch(/<circle class="acc pulse" [^>]*r="4" fill-opacity=".22"/);
    expect(writing).toMatch(/<circle class="caus" [^>]*r="4" fill="none"/);
    expect(writing).toMatch(/<circle class="faints" [^>]*r="3.6"/);
    expect(writing).toMatch(/<circle class="accs spin" [^>]*r="5"/);
    for (const initials of [...INITIALS, 'CA']) expect(writing).toContain(`>${initials}</text>`);
    expect(draw({ chief: 'needs' })).toMatch(/<circle class="att pulse" [^>]*r="5"/);
    expect(draw({ chief: 'waiting' })).toMatch(
      /<circle class="faints" [^>]*r="5"[^>]*stroke-dasharray="2 2"/,
    );
    expect(draw({ chief: 'done' })).toMatch(/<circle class="ink" cx="[\d.]+" cy="25" r="5"\/>/);
  });

  it('draws delivery nodes done, running, failed and not yet, and no Merge node', () => {
    const source = draw({
      delivery: steps('done', 'run', 'fail', 'todo', 'todo'),
      ci: null,
    });
    expect(source).toMatch(/<circle class="ink" [^>]*r="8.5" fill-opacity=".1"/);
    expect(source).toMatch(/<g class="spin"><circle class="accs"/);
    expect(source).toMatch(/<circle class="fails" [^>]*r="8.5"/);
    expect(source).not.toMatch(/class="pass motion"/);
    expect(source).not.toContain('>Merge</text>');
    expect(source).toMatch(/<text class="lbl mut"[^>]*>PR<\/text>/);
  });

  it('moves nothing when nothing is live', () => {
    const source = draw();
    expect(source).not.toContain('<animate');
    expect(source).not.toMatch(/class="[^"]*(pulse|spin)/);
    expect(source).not.toContain('<defs>');
  });

  it('escapes the words it writes into the image', () => {
    expect(escapeXml(`a & <b> "c" 'd'`)).toBe('a &amp; &lt;b&gt; &quot;c&quot; &apos;d&apos;');
    const source = draw({
      deliveryValue: 'Tom & <Jerry>',
      stages: marks(['<Plan>'], ['done'] as StageState[]),
    });
    expect(source).toContain('Tom &amp; &lt;Jerry&gt;');
    expect(source).toContain('&lt;Plan&gt;');
    expect(source).not.toContain('<Jerry>');
  });

  it('says the headline, the stage value and each section value in its alt text', () => {
    expect(stripAlt('Building', { ...SETTLED, stageValue: 'Build' })).toBe(
      'Building. Stage Build. High Table Spec approved. Delivery PR #N merged.',
    );
    expect(
      stripAlt('Every stage is recorded. Waiting for the verdict.', {
        stageValue: '',
        seats: null,
        tableValue: 'Seated',
        deliveryValue: '',
      }),
    ).toBe('Every stage is recorded. Waiting for the verdict. Stage not started.');
  });
});

describe('the live headline image', () => {
  const HEAD = {
    columns: 93,
    signal: 'accent' as const,
    text: 'Building',
    note: '3 finished',
    clock: '2:01',
  };
  const headline = (over: Partial<Parameters<typeof liveHeadline>[0]> = {}) =>
    liveHeadline({ ...HEAD, clockMs: 0, ...over }).source;
  const beginOf = (source: string, dur: string) =>
    new RegExp(`dur="${dur}"[^>]*begin="(-[\\d.]+)s"`).exec(source)?.[1];

  it('is as wide as the strip and 24 high, with the title, the note and the clock', () => {
    const drawn = liveHeadline({ ...HEAD, clockMs: 0 });
    expect(drawn).toMatchObject({ width: stripWidth(93), height: 24 });
    expect(drawn.source).toContain('viewBox="0 0 791 24" width="791" height="24"');
    expect(liveHeadline({ ...HEAD, columns: 57 }).source).toContain('viewBox="0 0 485 24"');
    expect(drawn.source).toContain('<text x="20" y="17"><tspan class="ttl">Building</tspan>');
    expect(drawn.source).toContain('<tspan class="aside mut" dx="16">3 finished</tspan>');
    expect(drawn.source).toContain('<tspan class="aside mut" dx="16">2:01</tspan>');
    expect(drawn.source).toContain('.ttl{fill:url(#title-sheen);font-size:17px;font-weight:600}');
    expect(drawn.source).toContain('.aside{font-size:12px;font-weight:400}');
    expect(drawn.source).toContain('font-variant-numeric:tabular-nums');
    expect(headline({ note: null, clock: null })).not.toContain('class="aside');
  });

  it('sweeps an accent sheen across the title every 3.6 s: 2.2 s of sweep, then a rest', () => {
    const source = headline();
    expect(source).toContain(
      '<linearGradient id="title-sheen" gradientUnits="objectBoundingBox" x1="0" x2=".18">',
    );
    expect(source).toContain(`<stop offset=".5" stop-color="${SIGNAL.accent}" stop-opacity=".9"/>`);
    expect(source.match(/<stop class="hs" offset="[01]"\/>/g)).toHaveLength(2);
    expect(source).toContain(
      'attributeName="gradientTransform" type="translate" values="-.3 0;1.3 0;1.3 0" keyTimes="0;.61;1" calcMode="spline" keySplines=".4 0 .2 1;0 0 1 1" dur="3.6s" repeatCount="indefinite"',
    );
  });

  it('AC-10: takes its phase from the shared clock, so a redraw never restarts the light', () => {
    expect(headline({ clockMs: 5_000 })).toBe(headline({ clockMs: 5_000 }));
    expect(beginOf(headline({ clockMs: 5_000 }), '3.6s')).toBe('-1.400');
    expect(beginOf(headline({ clockMs: 5_400 }), '3.6s')).toBe('-1.800');
    expect(beginOf(headline({ clockMs: 5_000 }), '2.4s')).toBe('-0.200');
    expect(beginOf(headline({ clockMs: 5_400 }), '2.4s')).toBe('-0.600');
    expect(liveHeadline(HEAD).source).not.toContain('begin=');
  });

  it('steps the dot through the breath values over 2.4 s in the signal colour', () => {
    const source = headline({ signal: 'accent' });
    expect(source).toContain(
      `<circle class="motion" cx="6" cy="12" r="5.5" fill="${SIGNAL.accent}"><animate attributeName="opacity" values="1;0.8;0.55;0.4;0.55;0.8" dur="2.4s" calcMode="discrete" repeatCount="indefinite"`,
    );
    expect(source).toContain(
      `<circle class="still" cx="6" cy="12" r="5.5" fill="${SIGNAL.accent}"/>`,
    );
    expect(headline({ signal: 'pass' })).toContain(`fill="${SIGNAL.pass}"`);
  });

  it('AC-11: under reduced motion the title is solid headline and the dot solid at full opacity', () => {
    const source = headline();
    expect(source).toContain('.still{display:none}');
    expect(source).toContain(
      `@media (prefers-reduced-motion: reduce){.ttl{fill:${INK.headline}}.motion{display:none}.still{display:inline}}`,
    );
    expect(source).toContain(
      `@media (prefers-color-scheme: dark) and (prefers-reduced-motion: reduce){.ttl{fill:${INK.headlineDark}}}`,
    );
    expect(source).toContain(
      `@media (prefers-color-scheme: dark){.hs{stop-color:${INK.headlineDark}}.mut{fill:${INK.mutedDark}}}`,
    );
    expect(source).toContain(`.hs{stop-color:${INK.headline}}.mut{fill:${INK.muted}}`);
  });

  it('escapes the words it writes', () => {
    const source = headline({ text: 'Tom & <Jerry>', note: '"a"', clock: null });
    expect(source).toContain('>Tom &amp; &lt;Jerry&gt;</tspan>');
    expect(source).toContain('>&quot;a&quot;</tspan>');
    expect(source).not.toContain('<Jerry>');
  });
});

describe('the Ledger drawings', () => {
  it('draws the mini stages 64 × 4, one mark per stage', () => {
    const source = miniStages(['done', 'run', 'paused', 'skip']);
    expect(source).toContain('viewBox="0 0 64 4" width="64" height="4"');
    expect(source.match(/<rect /g)).toHaveLength(3);
    expect(source).toMatch(/<line class="faints"/);
    expect(source).toMatch(/<rect class="acc pulse"/);
  });

  it('draws the table ring with a findings badge on each landed seat and the chief word', () => {
    const source = tableRing(
      [
        { label: 'SA', state: 'done', findings: 9 },
        { label: 'IA', state: 'writing', findings: null },
        { label: 'DO', state: 'seated', findings: null },
        { label: 'PO', state: 'late', findings: 4 },
      ],
      'needs',
    );
    expect(source).toContain('viewBox="0 0 150 150" width="150" height="150"');
    expect(source).toMatch(/<path class="accs pulse"/);
    expect(source).toMatch(/<path class="caus"/);
    expect(source).toMatch(/<path class="faints"[^>]*style="stroke-opacity:.3"/);
    expect(source.match(/<circle class="ink" [^>]*r="6.5"/g)).toHaveLength(2);
    expect(source).toContain('>9</text>');
    expect(source).toContain('>4</text>');
    expect(source).toMatch(/<circle class="atts pulse" cx="75" cy="75" r="24"/);
    expect(source).toContain('>needs you</text>');
    for (const [chief, word] of [
      ['waiting', 'listening'],
      ['ruling', 'ruling'],
      ['done', 'approved'],
    ] as const) {
      expect(tableRing([], chief)).toContain(`>${word}</text>`);
    }
  });

  it('draws a 24 × 24 node in the strip art, with the CI share as its arc', () => {
    const running = nodeIcon('CI', 'run', 0.5);
    expect(running).toContain('viewBox="0 0 24 24" width="24" height="24"');
    expect(running).not.toContain('class="spin"');
    expect(nodeIcon('Push', 'run')).toContain('<g class="spin">');
    expect(nodeIcon('CI', 'run')).not.toContain('class="spin"');
    expect(nodeIcon('Odd', 'todo')).toContain('<circle cx="8" cy="8" r="2.4"/>');
  });

  it('draws a meter as a share of its track, or an indeterminate pink sweep while running', () => {
    const half = meter(0.5, 'ink');
    expect(half).toContain(
      'viewBox="0 0 2000 4" width="2000" height="4" preserveAspectRatio="none"',
    );
    expect(half).toContain('<rect class="ink" x="0" y="0" width="1000.0" height="4" rx="2"/>');
    expect(half).toContain('style="fill-opacity:.18"');
    expect(meter(4, 'acc')).toContain('width="2000.0"');
    expect(meter(-1)).toContain('<rect class="ink" x="0" y="0" width="0.0"');
    const running = meter(null);
    expect(running).toContain('<rect x="-600" y="0" width="600"');
    expect(running).toContain('values="-600;2000" dur="2.2s"');
    expect(running).toContain(`stop-color="${SIGNAL.accent}"`);
  });

  it('draws the tab rule with a pink segment 60% of the shown tab, centred under it', () => {
    const source = tabRule(4, 1);
    expect(source).toContain(
      'viewBox="0 0 2000 2" width="2000" height="2" preserveAspectRatio="none"',
    );
    expect(source).toContain(
      `<rect x="600.0" y="0" width="300.0" height="2" rx="1" fill="${SIGNAL.accent}"/>`,
    );
    expect(hairline()).toContain(
      'viewBox="0 0 2000 1" width="2000" height="1" preserveAspectRatio="none"',
    );
  });
});

describe('AC-26: every colour comes from the palette', () => {
  it('keeps hex literals, gray and white out of strip.ts', () => {
    expect(STRIP_SOURCE).toContain("from './palette'");
    expect(STRIP_SOURCE).not.toMatch(/#[0-9A-Fa-f]{3,8}\b/);
    expect(STRIP_SOURCE).not.toMatch(/gr[ae]y|white/i);
  });

  it('draws only palette colours', () => {
    const drawn = [
      draw({
        stages: stages('skip', 'done', 'run', 'paused', 'fail', 'todo', 'todo', 'todo'),
        seats: seats('done', 'writing', 'late', 'seated', 'done', 'done', 'done'),
        delivery: steps('done', 'run', 'fail', 'todo', 'run'),
        ci: 0.3,
      }),
      miniStages(['done', 'run', 'fail']),
      tableRing([{ label: 'SA', state: 'done', findings: 3 }], 'done'),
      nodeIcon('CI', 'done'),
      meter(null),
      tabRule(5, 0),
      hairline(),
      liveHeadline({
        columns: 57,
        signal: 'accent',
        text: 'Building',
        note: '3 finished',
        clock: '2:01',
        clockMs: 0,
      }).source,
    ];
    for (const source of drawn) {
      for (const colour of colours(source)) expect(PALETTE.has(colour.toUpperCase())).toBe(true);
    }
  });

  it('uses white only as onSignal: the badge numbers and the running sheen', () => {
    expect(SIGNAL.onSignal).toBe('#FFFFFF');
    const white = (source: string) =>
      [...source.matchAll(/([\w-]+)="#FFFFFF"/g)].map((match) => match[1]);
    expect(white(draw())).toEqual([]);
    expect(white(draw({ delivery: steps('done', 'done', 'done', 'done', 'done') }))).toEqual([]);
    expect(
      white(
        draw({ stages: stages('skip', 'done', 'run', 'todo', 'todo', 'todo', 'todo', 'todo') }),
      ),
    ).toEqual(['stop-color', 'stop-color', 'stop-color']);
    expect(white(tableRing([{ label: 'SA', state: 'done', findings: 3 }], 'done'))).toEqual([
      'fill',
    ]);
    expect(white(nodeIcon('CI', 'done'))).toEqual([]);
    for (const source of [meter(null), meter(1)]) {
      expect(white(source)).toEqual([]);
    }
  });
});

describe('the palette', () => {
  it('holds the tokens, faintStroke at 45% beside faint at 30%', () => {
    expect(INK).toMatchObject({
      ink: '#6E7D86',
      muted: '#8E979D',
      faintOpacity: 0.3,
      hairOpacity: 0.28,
    });
    expect(INK.faintStrokeOpacity).toBe(0.45);
    expect(INK).toMatchObject({ headline: '#1F2428', headlineDark: '#E8ECEE' });
    expect(SIGNAL).toMatchObject({
      accent: '#F90093',
      attention: '#F37748',
      pass: '#2F8F6B',
      passText: '#26775A',
      fail: '#D23B3B',
    });
    expect(BREATH).toEqual(['FF', 'CC', '8C', '66', '8C', 'CC']);
  });

  it('colours the light by signal, and breathes it one step per tick only when live', () => {
    expect(signalColor('accent')).toBe(SIGNAL.accent);
    expect(signalColor('attention')).toBe(SIGNAL.attention);
    expect(signalColor('pass')).toBe(SIGNAL.pass);
    expect(signalColor('fail')).toBe(SIGNAL.fail);
    expect(signalColor('idle')).toBe(INK.muted);
    expect([0, 1, 2, 3, 4, 5, 6].map((tick) => lightColor('accent', true, tick))).toEqual(
      ['FF', 'CC', '8C', '66', '8C', 'CC', 'FF'].map((alpha) => `${SIGNAL.accent}${alpha}`),
    );
    expect(lightColor('pass', false, 3)).toBe(SIGNAL.pass);
  });
});

describe('finished stages turn green, and the strip glows once', () => {
  const allDone = stages('skip', 'done', 'done', 'done', 'done', 'done', 'done', 'done');
  const settledAt = 1_000_000;

  it('AC-13: a done bar uses the pass class and its label passText, with a check in the same run', () => {
    const source = draw({ stages: allDone });
    expect(source).toMatch(/<rect class="pass" [^>]*height="3" rx="1.5"\/>/);
    expect(source).not.toMatch(/<rect class="ink" [^>]*height="3"/);
    expect(source).toMatch(
      /<text class="lbl passt" [^>]*text-anchor="middle"><tspan class="pass">✓<\/tspan> Plan<\/text>/,
    );
    expect(source).toContain(`.passt{fill:${SIGNAL.passText}}`);
    expect(source).toContain(`.passt{fill:${SIGNAL.passDark}}`);
    expect(miniStages(['done', 'todo'])).toMatch(/<rect class="pass" /);
  });

  it('AC-23: the done label text and the bars meet the contrast rules in both themes', () => {
    const channel = (hex: string, at: number) => {
      const c = parseInt(hex.slice(at, at + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    const lum = (hex: string) =>
      0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
    const ratio = (a: string, b: string) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (hi! + 0.05) / (lo! + 0.05);
    };
    expect(SIGNAL.passText).toBe('#26775A');
    expect(ratio(SIGNAL.passText, '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
    expect(ratio(SIGNAL.pass, '#FFFFFF')).toBeGreaterThanOrEqual(3);
    expect(ratio(SIGNAL.passDark, '#1E1E1E')).toBeGreaterThanOrEqual(4.5);
  });

  it('AC-12: glows once for about 2 s when the last stage has just finished', () => {
    const source = draw({ stages: allDone, settledAtMs: settledAt, clockMs: settledAt + 500 });
    const glows = source.match(/<g class="motion settle">.*?<\/g>/g) ?? [];
    expect(glows).toHaveLength(1);
    expect(glows[0]).toContain('filter="url(#glow)"');
    expect(glows[0]).toContain(
      'values=".5;0" dur="2s" repeatCount="1" fill="freeze" begin="-0.500s"',
    );
    expect(source).toContain('<filter id="glow"');
    expect(source).toContain('.motion{display:none}');
  });

  it('AC-12: a redraw keeps the phase, and nothing glows outside the window', () => {
    const later = draw({ stages: allDone, settledAtMs: settledAt, clockMs: settledAt + 1500 });
    expect(later).toContain('begin="-1.500s"');
    expect(
      draw({ stages: allDone, settledAtMs: settledAt, clockMs: settledAt + 2000 }),
    ).not.toContain('settle');
    expect(draw({ stages: allDone, settledAtMs: settledAt, clockMs: settledAt - 1 })).not.toContain(
      'settle',
    );
    expect(draw({ stages: allDone, clockMs: settledAt })).not.toContain('settle');
    expect(draw({ stages: allDone })).not.toContain('<animate');
  });
});
