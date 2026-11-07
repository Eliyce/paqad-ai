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
  DELIVERY_PX,
  LABEL_MIN_PX,
  STAGE_MIN_PX,
  STAGE_NAME_X,
  TABLE_PX,
  buttonPx,
  figureWords,
  seatsThatFit,
  stageBarPx,
  strip,
  stripLayout,
  stripWidth,
  tabRule,
  tableRing,
  type Mark,
  type SeatState,
  type SignoffTone,
  type StageState,
  type StripInput,
} from '../../../../runtime/claude-plugin/mod/strip.ts';

const STRIP_SOURCE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../../../runtime/claude-plugin/mod/strip.ts'),
  'utf8',
);

const FULL = ['Intake', 'Plan', 'Spec', 'Build', 'Review', 'Checks', 'Docs', 'Deliver'];
const INITIALS = ['SA', 'IA', 'DO', 'PO', 'AA', 'UF', 'QA'];

function marks<S>(labels: readonly string[], states: readonly S[]): Array<Mark<S>> {
  return labels.map((label, i) => ({ label, state: states[i]! }));
}

const stages = (...states: StageState[]) => marks(FULL, states);
const seats = (...states: SeatState[]) => marks(INITIALS, states);

const SETTLED: StripInput = {
  columns: 93,
  stages: stages('skip', 'done', 'done', 'done', 'done', 'done', 'done', 'done'),
  stageValue: 'All stages done',
  seats: seats('done', 'done', 'done', 'done', 'done', 'done', 'done'),
  chief: 'done',
  tableValue: '',
  deliveryValue: 'PR #N',
  deliveryTone: 'ink',
  deliveryFigures: null,
};

const draw = (over: Partial<StripInput> = {}) => strip({ ...SETTLED, ...over }).source;

function numbers(source: string, pattern: RegExp): number[] {
  return [...source.matchAll(pattern)].map((match) => Number(match[1]));
}

function textX(source: string, text: string): number | null {
  const match = new RegExp(`<text [^>]*x="([\\d.]+)"[^>]*>${text}</text>`).exec(source);
  return match ? Number(match[1]) : null;
}

const PALETTE = new Set(
  [
    INK.ink,
    INK.inkDark,
    INK.muted,
    INK.mutedDark,
    INK.mutedText,
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

  it('AC-9: High Table is a fixed 150 px, Delivery a fixed 190 px, and Stage takes the rest', () => {
    expect([TABLE_PX, DELIVERY_PX, STAGE_MIN_PX, LABEL_MIN_PX]).toEqual([150, 190, 340, 40]);
    const withTable = draw();
    expect(numbers(withTable, /<line class="hair" x1="([\d.]+)" y1="1"/g)).toEqual([451, 601]);
    expect(withTable).toContain('>DELIVERY</text>');
    const sections = strip(SETTLED).sections;
    expect(sections.map(({ id, px, grow }) => [id, px, grow])).toEqual([
      ['stage', 451, true],
      ['table', 150, false],
      ['delivery', 190, false],
    ]);
    const without = strip({ ...SETTLED, seats: null });
    expect(without.sections.map(({ id, px }) => [id, px])).toEqual([
      ['stage', 601],
      ['delivery', 190],
    ]);
    expect(without.source).not.toContain('HIGH TABLE');
  });

  it('AC-9: High Table shows from 680 px, Delivery from 530 px, else Stage only', () => {
    expect(stripLayout(679, true)).toEqual({ ids: ['stage', 'delivery'], px: [489, 190] });
    expect(stripLayout(680, true)).toEqual({
      ids: ['stage', 'table', 'delivery'],
      px: [340, 150, 190],
    });
    expect(stripLayout(680, false)).toEqual({ ids: ['stage', 'delivery'], px: [490, 190] });
    expect(stripLayout(530, true)).toEqual({ ids: ['stage', 'delivery'], px: [340, 190] });
    expect(stripLayout(529, true)).toEqual({ ids: ['stage'], px: [529] });
    expect(strip({ ...SETTLED, columns: 66 }).sections.map((cut) => cut.id)).toEqual([
      'stage',
      'delivery',
    ]);
    expect(strip({ ...SETTLED, columns: 57 }).sections.map((cut) => cut.id)).toEqual(['stage']);
    expect(strip({ ...SETTLED, columns: 130 }).sections.map((cut) => cut.id)).toEqual([
      'stage',
      'table',
      'delivery',
    ]);
    const stageOnly = draw({ columns: 57 });
    expect(stageOnly).not.toContain('DELIVERY');
    expect(stageOnly).not.toContain('HIGH TABLE');
  });

  it('AC-9: stage labels draw from 40 px a bar, and below it only the bars draw', () => {
    expect(stageBarPx(40 * 6 + 4 * 5, 6)).toBe(40);
    expect(stageBarPx(39 * 6 + 4 * 5, 6)).toBe(39);
    const labelled = (count: number, columns: number) => {
      const labels = Array.from({ length: count }, (_, i) => `S${i}`);
      const source = draw({
        columns,
        seats: null,
        stages: marks(labels, labels.map(() => 'todo') as StageState[]),
      });
      return (source.match(/<text class="lbl mut"[^>]*>S\d+<\/text>/g) ?? []).length;
    };
    expect(labelled(6, 93)).toBe(6);
    expect(labelled(12, 57)).toBe(0);
  });

  it('FR-14: the stage name draws right after the STAGE caption, at x0 + 44', () => {
    expect(STAGE_NAME_X).toBe(44);
    expect(textX(draw(), 'All stages done')).toBe(44);
    expect(draw({ stageValue: '' })).not.toMatch(/class="val ink" x="44.0"/);
    const long = draw({ columns: 57, stageValue: 'x'.repeat(200) });
    expect(long).toContain('…</text>');
  });

  it('draws only the stages it is given, and no delivery nodes', () => {
    const fast = draw({
      seats: null,
      stages: marks(['Plan', 'Build', 'Checks'], ['done', 'run', 'todo'] as StageState[]),
    });
    for (const label of ['Plan', 'Build', 'Checks']) {
      expect(fast).toMatch(new RegExp(`[> ]${label}</text>`));
    }
    for (const label of ['Intake', 'Spec', 'Review', 'Docs', 'Commit', 'CI', 'Edit']) {
      expect(fast).not.toMatch(new RegExp(`[> ]${label}</text>`));
    }
    expect(fast).not.toMatch(/r="8.5"/);
  });
});

describe('AC-8: Delivery is two lines of text', () => {
  it('draws the state on line 1 at y = 29.3 in its tone, and no value beside the caption', () => {
    const source = draw({ deliveryValue: 'Not pushed', deliveryTone: 'ink' });
    expect(source).toContain(
      '<text class="ink" x="619.0" y="29.3" style="font-size:12px;font-weight:500">Not pushed</text>',
    );
    expect(draw({ deliveryValue: 'CI failed', deliveryTone: 'fail' })).toContain(
      '<text class="fail" x="619.0" y="29.3"',
    );
    expect(draw({ deliveryValue: 'Not started', deliveryTone: 'mut' })).toContain(
      '<text class="mut" x="619.0" y="29.3"',
    );
  });

  it('draws the commit count only on line 2, then the line figures in green and red', () => {
    const source = draw({
      deliveryValue: 'Not pushed',
      deliveryFigures: { commits: 53, additions: 6375, deletions: 983 },
    });
    expect(source).toContain(
      '<text x="619.0" y="47" style="font-size:10.5px" xml:space="preserve"><tspan class="mut">53 commits</tspan><tspan>  </tspan><tspan class="passt">+6,375</tspan><tspan> </tspan><tspan class="fail">−983</tspan></text>',
    );
    expect(source.match(/53 commits/g)).toHaveLength(1);
    const one = draw({ deliveryFigures: { commits: 1, additions: 2, deletions: 0 } });
    expect(one).toContain('>1 commit</tspan>');
    const none = draw({ deliveryFigures: { commits: 0, additions: 2, deletions: 1 } });
    expect(none).not.toContain('commit');
    expect(draw({ deliveryFigures: { commits: 3, additions: 0, deletions: 0 } })).not.toContain(
      'y="47" style="font-size:10.5px"',
    );
    expect(figureWords(null)).toBeNull();
  });

  it('AC-5: a partly counted figure shows the counted lines with a trailing +', () => {
    const source = draw({
      deliveryFigures: { commits: 0, additions: 500, deletions: 2, partial: true },
    });
    expect(source).toContain('<tspan class="passt">+500+</tspan>');
  });

  it('clips a long state, such as a long branch name, with an ellipsis inside the section', () => {
    const source = draw({ deliveryValue: `Pushed · feat/${'x'.repeat(80)}` });
    const line = /y="29.3"[^>]*>([^<]+)<\/text>/.exec(source)![1]!;
    expect(line.endsWith('…')).toBe(true);
    expect([...line].length * 6.8).toBeLessThanOrEqual(190 - 18 - 7);
  });
});

describe('the High Table shows three seats and the chief', () => {
  const three = marks(INITIALS.slice(0, 3), ['writing', 'late', 'done'] as SeatState[]);
  const marksOf = (source: string) =>
    numbers(
      source,
      /<text class="lbl mut" x="([\d.]+)" y="47" text-anchor="middle">(?:SA|IA|DO|CA)</g,
    );
  const hairAt = (source: string) =>
    numbers(source, /<line class="hair" x1="([\d.]+)" y1="19"/g)[0]!;

  it('AC-12: draws +N after the last shown seat, then the hairline and CA; seats that all fit draw no +N', () => {
    const source = draw({ columns: 93, seats: three, hiddenSeats: 8, chief: 'ruling' });
    expect(source).toMatch(
      /<text class="lbl mut" x="[\d.]+" y="28" text-anchor="middle" style="font-weight:500">\+8<\/text>/,
    );
    expect(source).toContain('>CA</text>');
    expect(source.match(/<text class="lbl mut"[^>]*>(SA|IA|DO)<\/text>/g)).toHaveLength(3);
    expect(draw({ seats: three, hiddenSeats: 0 })).not.toMatch(/>\+\d+<\/text>/);
    expect(draw({ seats: three, hiddenSeats: 1 })).toContain('>+1</text>');
  });

  it('three seats and +N always fit the 150 px section, whatever the band width', () => {
    expect(seatsThatFit(11, 3)).toBe(3);
    expect(seatsThatFit(4, 3)).toBe(3);
    expect(seatsThatFit(3, 3)).toBe(3);
    expect(seatsThatFit(2, 3)).toBe(2);
    expect(seatsThatFit(1, 3)).toBe(1);
    expect(seatsThatFit(0, 3)).toBe(0);
  });

  for (const columns of [80, 93, 130]) {
    it(`AC-14: at ${columns} columns, marks sit 22 px apart, +N one step on, and the chief clear of the divider`, () => {
      const source = draw({ columns, seats: three, hiddenSeats: 8, chief: 'ruling' });
      const centres = marksOf(source);
      expect(centres).toHaveLength(4);
      const seatsAt = centres.slice(0, 3);
      const chief = centres.at(-1)!;
      const plus = textX(source, '\\+8')!;
      expect(plus - seatsAt.at(-1)!).toBeCloseTo(22, 1);
      const hair = hairAt(source);
      expect(hair).toBeGreaterThan(plus + 6);
      expect(chief - 5).toBeGreaterThan(hair);
      const divider = stripWidth(columns) - DELIVERY_PX;
      expect(divider - (chief + 6)).toBeGreaterThanOrEqual(18 - 0.05);
    });
  }

  it('one seat with nothing hidden joins the chief with a connector, not the hairline', () => {
    const one = draw({ seats: three.slice(0, 1), hiddenSeats: 0 });
    const x0 = 451 + 18;
    expect(one).toContain(
      `<line class="faints" x1="${(x0 + 10).toFixed(1)}" y1="25" x2="${(x0 + 30).toFixed(1)}" y2="25" stroke-width="1.2" stroke-linecap="round"/>`,
    );
    expect(one).not.toMatch(/<line class="hair" x1="[\d.]+" y1="19"/);
    expect(draw({ seats: three.slice(0, 1), hiddenSeats: 2 })).toMatch(
      /<line class="hair" x1="[\d.]+" y1="19"/,
    );
    expect(draw({ seats: three.slice(0, 2) })).toMatch(/<line class="hair" x1="[\d.]+" y1="19"/);
  });

  it('Needs answers replaces the HIGH TABLE caption in the attention colour', () => {
    const needs = draw({ tableValue: 'Needs answers', chief: 'needs' });
    expect(needs).toContain('<text class="val att" x="469.0" y="9">Needs answers</text>');
    expect(needs).not.toContain('HIGH TABLE');
    expect(draw()).toContain('>HIGH TABLE</text>');
    expect(draw({ tableValue: 'Seated' })).not.toContain('Seated');
  });

  it('cuts the strip into px sections that tile the width and keep every x', () => {
    for (const over of [
      { columns: 57 },
      { columns: 66 },
      { columns: 93 },
      { columns: 93, seats: null },
    ] as Array<Partial<StripInput>>) {
      const drawn = strip({ ...SETTLED, ...over });
      let from = 0;
      for (const cut of drawn.sections) {
        const box = /viewBox="([\d.]+) 0 ([\d.]+) 52" width="([\d.]+)" height="52"/.exec(
          cut.source,
        )!;
        expect(Number(box[1])).toBeCloseTo(from, 1);
        expect(Number(box[3])).toBe(Number(box[2]));
        expect(Number(box[2])).toBeCloseTo(cut.px, 1);
        from += Number(box[2]);
        const texts = [...cut.source.matchAll(/<text [^>]*x="([\d.]+)"[^>]*>([^<]+)</g)];
        expect(texts.length).toBeGreaterThan(0);
        for (const [, x, words] of texts) {
          expect(drawn.source).toContain(`x="${x}"`);
          expect(drawn.source).toContain(`>${words}<`);
        }
      }
      expect(from).toBeCloseTo(drawn.width, 1);
    }
  });

  it('draws each divider half a pixel inside its left section in the cuts, so the cut keeps it whole', () => {
    const drawn = strip(SETTLED);
    const [stage, table, delivery] = drawn.sections;
    expect(numbers(stage!.source, /<line class="hair" x1="([\d.]+)" y1="1"/g)).toEqual([450.5]);
    expect(numbers(table!.source, /<line class="hair" x1="([\d.]+)" y1="1"/g)).toEqual([600.5]);
    expect(delivery!.source).not.toMatch(/<line class="hair" x1="[\d.]+" y1="1"/);
  });

  it('carries the motion defs on the stage section only, and the shared style on each', () => {
    const drawn = strip({
      ...SETTLED,
      stages: stages('skip', 'done', 'run', 'todo', 'todo', 'todo', 'todo', 'todo'),
      clockMs: 0,
    });
    const [stage, table, delivery] = drawn.sections;
    expect(stage!.source).toContain('<linearGradient id="sheen"');
    expect(table!.source).not.toContain('<defs>');
    expect(delivery!.source).not.toContain('<defs>');
    for (const cut of drawn.sections) expect(cut.source).toContain('<style>');
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

  it('AC-11: a subagent tag draws the SUBAGENT pill with a breathing ring, no dot, and the title at x = 81', () => {
    const source = headline({ tag: 'SUBAGENT', clockMs: 5_000 });
    expect(source).toContain(
      `<rect class="motion" x=".6" y="3.6" width="70" height="14.8" rx="7.4" fill="none" stroke="${SIGNAL.accent}" stroke-width="1.1"><animate attributeName="stroke-opacity" values=".25;1;.25" dur="2.4s" repeatCount="indefinite" calcMode="spline" keySplines=".4 0 .6 1;.4 0 .6 1" begin="-0.200s"/></rect>`,
    );
    expect(source).toContain(
      `<rect class="still" x=".6" y="3.6" width="70" height="14.8" rx="7.4" fill="none" stroke="${SIGNAL.accent}" stroke-width="1.1" stroke-opacity=".55"/>`,
    );
    expect(source).toContain('font-size:8.5px;font-weight:600;letter-spacing:1px');
    expect(source).toContain('>SUBAGENT</text>');
    expect(source).not.toContain('<circle');
    expect(source).toContain('<text x="81" y="17"><tspan class="ttl">Building</tspan>');
    expect(headline()).toContain('<text x="20" y="17">');
    expect(headline()).not.toContain('SUBAGENT');
  });

  it('steps the dot through the breath values over 2.4 s in the signal colour', () => {
    const source = headline({ signal: 'accent' });
    expect(source).toContain(
      `<circle class="motion" cx="6" cy="11" r="5.5" fill="${SIGNAL.accent}"><animate attributeName="opacity" values="1;0.8;0.55;0.4;0.55;0.8" dur="2.4s" calcMode="discrete" repeatCount="indefinite"`,
    );
    expect(source).toContain(
      `<circle class="still" cx="6" cy="11" r="5.5" fill="${SIGNAL.accent}"/>`,
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
        deliveryFigures: { commits: 2, additions: 4, deletions: 1 },
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
    expect(white(draw({ deliveryFigures: { commits: 2, additions: 4, deletions: 1 } }))).toEqual(
      [],
    );
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

describe('Part C: the sign-off words on the Stage caption row', () => {
  const STATES: Array<[string, SignoffTone, string | null]> = [
    ['Writing design', 'acct', null],
    ['Waiting 3h', 'caut', 'Check'],
    ['Checking…', 'acct', null],
    ['Signed off', 'passt', null],
    ['Changes requested', 'fail', 'View'],
    ['Sign-off skipped', 'mutt', null],
    ['Not posted', 'mutt', 'Copy design'],
  ];

  it('AC-23, FR-31: at the 340 px Stage minimum the words and button stay whole and the stage name truncates first', () => {
    for (const [words, tone, button] of STATES) {
      const source = strip({
        ...SETTLED,
        columns: 80,
        stageValue: 'A very long stage name that cannot fit',
        signoff: { words, tone, button },
      }).sections[0]!.source;
      expect(strip({ ...SETTLED, columns: 80 }).sections[0]!.px).toBe(340);
      const end = 340 - 18 - (button ? buttonPx(button) : 0);
      expect(source).toContain(
        `<text class="val ${tone}" x="${end.toFixed(1)}" y="9" text-anchor="end">${words}</text>`,
      );
      const name = /<text class="val ink" x="44.0" y="9">([^<]*)<\/text>/.exec(source);
      const nameEnd = 44 + (name ? [...name[1]!].length * 6 : 0);
      expect(nameEnd).toBeLessThanOrEqual(end - [...words].length * 6);
      if (name) expect(name[1]!.endsWith('…')).toBe(true);
      expect(end - [...words].length * 6).toBeGreaterThan(44);
    }
  });

  it('FR-22: draws words only, no icon, and nothing without a sign-off', () => {
    const source = draw({ signoff: { words: 'Signed off', tone: 'passt', button: null } });
    expect(source).toContain('class="val passt"');
    expect(source).not.toMatch(/scale\(.45\)/);
    expect(draw()).not.toMatch(/class="val (acct|caut|mutt)"/);
  });

  it('AC-25: every sign-off word colour reaches 4.5:1 on the light and dark band', () => {
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
    for (const colour of [
      SIGNAL.accentText,
      SIGNAL.cautionText,
      SIGNAL.passText,
      SIGNAL.fail,
      INK.mutedText,
    ]) {
      expect(ratio(colour, '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
    }
    for (const colour of [
      SIGNAL.accentTextDark,
      SIGNAL.cautionDark,
      SIGNAL.passDark,
      SIGNAL.failDark,
      INK.mutedDark,
    ]) {
      expect(ratio(colour, '#1E1E1E')).toBeGreaterThanOrEqual(4.5);
    }
    const style = draw();
    expect(style).toContain(
      `.acct{fill:${SIGNAL.accentText}}.caut{fill:${SIGNAL.cautionText}}.mutt{fill:${INK.mutedText}}`,
    );
    expect(style).toContain(
      `.acct{fill:${SIGNAL.accentTextDark}}.caut{fill:${SIGNAL.cautionDark}}.mutt{fill:${INK.mutedDark}}`,
    );
  });

  it('AC-27: under reduced motion Checking… and a running Sign-off bar do not pulse', () => {
    const source = draw({
      stages: marks(['Plan', 'Spec', 'Sign-off'], ['done', 'done', 'run'] as StageState[]),
      signoff: { words: 'Checking…', tone: 'acct', button: null },
      clockMs: 0,
    });
    expect(source).toContain(
      '@media (prefers-reduced-motion: reduce){.pulse,.spin{animation:none}.motion{display:none}}',
    );
    expect(source).toMatch(/<text class="val acct"[^>]*>Checking…<\/text>/);
    expect(source).not.toMatch(/<text class="[^"]*(pulse|motion)[^"]*"[^>]*>Checking/);
  });
});
