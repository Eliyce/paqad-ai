import { INK, PX_PER_COLUMN, SIGNAL, STATUS_B, SVG_FONT } from './palette';

export type StageState = 'done' | 'run' | 'paused' | 'marked' | 'fail' | 'skip' | 'todo';
export type SeatState = 'done' | 'writing' | 'seated' | 'late';
export type ChiefState = 'waiting' | 'ruling' | 'needs' | 'done';
export type ShipState = 'done' | 'run' | 'todo' | 'ready' | 'fail';
export type MeterTone = 'ink' | 'acc' | 'pass';

export interface Mark<S> {
  label: string;
  state: S;
}

export interface TableSeat extends Mark<SeatState> {
  findings: number | null;
}

export interface StripInput {
  columns: number;
  stages: ReadonlyArray<Mark<StageState>>;
  stageValue: string;
  seats: ReadonlyArray<Mark<SeatState>> | null;
  chief: ChiefState;
  tableValue: string;
  delivery: ReadonlyArray<Mark<ShipState>>;
  ci: number | null;
  deliveryValue: string;
  /** The shared clock, so every animation resumes at its phase when the strip is redrawn. */
  clockMs?: number;
}

export const STRIP_HEIGHT = 52;

const PULSE_MS = 1600;
const SPIN_MS = 4000;
const SHEEN_MS = 2200;
const READY_MS = 2400;

// How far into its cycle an animation of this length is at the shared clock: a redraw starts
// it there (a negative delay), so the motion continues instead of restarting.
function phase(clockMs: number | undefined, periodMs: number): string | null {
  if (clockMs === undefined || !Number.isFinite(clockMs)) return null;
  const into = ((clockMs % periodMs) + periodMs) % periodMs;
  return `-${(into / 1000).toFixed(3)}s`;
}

function begin(clockMs: number | undefined, periodMs: number): string {
  const at = phase(clockMs, periodMs);
  return at === null ? '' : ` begin="${at}"`;
}

const STRIP_MIN_WIDTH = 480;
const SECTION_PAD = 18;
const RIGHT_INSET = 7;
const VALUE_MIN_WIDTH = 150;
const DELIVERY_INSET = 12;
const NODE_RADIUS = 8.5;
const NODE_SPACING = 96;
const CONNECTOR_GAP = 4;
const SEAT_SPACING = 22;
const Y_CAP = 9;
const Y_MARK = 25;
const Y_LBL = 47;

const XML: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

export function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => XML[ch] ?? ch);
}

function fixed(n: number): string {
  return n.toFixed(1);
}

function svg(width: number, height: number, body: string, extra = ''): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"${extra}>${body}</svg>`;
}

function phaseRules(clockMs: number | undefined): string {
  const pulse = phase(clockMs, PULSE_MS);
  const spin = phase(clockMs, SPIN_MS);
  return pulse === null || spin === null
    ? ''
    : `.pulse{animation-delay:${pulse}}.spin{animation-delay:${spin}}`;
}

function css(clockMs?: number): string {
  return [
    '<style>',
    `text{font-family:${SVG_FONT};font-variant-numeric:tabular-nums}`,
    `.ink{fill:${INK.ink}}.inks{stroke:${INK.ink}}.mut{fill:${INK.muted}}`,
    `.faint{fill:${INK.muted};fill-opacity:${INK.faintOpacity}}`,
    `.faints{stroke:${INK.muted};stroke-opacity:${INK.faintStrokeOpacity}}`,
    `.hair{stroke:${INK.muted};stroke-opacity:${INK.hairOpacity}}`,
    `.acc{fill:${SIGNAL.accent}}.accs{stroke:${SIGNAL.accent}}`,
    `.att{fill:${SIGNAL.attention}}.atts{stroke:${SIGNAL.attention}}`,
    `.cau{fill:${SIGNAL.caution}}.caus{stroke:${SIGNAL.caution}}`,
    `.pass{fill:${STATUS_B.done}}.passs{stroke:${STATUS_B.done}}`,
    `.fail{fill:${STATUS_B.failed}}.fails{stroke:${STATUS_B.failed}}`,
    '.cap{font-size:8.5px;font-weight:600;letter-spacing:1.1px}',
    '.val{font-size:10.5px;font-weight:500}',
    '.lbl{font-size:9px}.cur{font-weight:650}',
    '@media (prefers-color-scheme: dark){',
    `.ink{fill:${INK.inkDark}}.inks{stroke:${INK.inkDark}}.mut{fill:${INK.mutedDark}}`,
    `.pass{fill:${STATUS_B.doneDark}}.passs{stroke:${STATUS_B.doneDark}}`,
    `.fail{fill:${STATUS_B.failedDark}}.fails{stroke:${STATUS_B.failedDark}}`,
    `.cau{fill:${SIGNAL.cautionDark}}.caus{stroke:${SIGNAL.cautionDark}}`,
    '}',
    '@keyframes pulse{0%,100%{opacity:1}50%{opacity:.45}}',
    '@keyframes spin{to{transform:rotate(360deg)}}',
    '.pulse{animation:pulse 1.6s ease-in-out infinite}',
    '.spin{transform-box:fill-box;transform-origin:center;animation:spin 4s linear infinite}',
    phaseRules(clockMs),
    '.off{display:none}',
    '@media (prefers-reduced-motion: reduce){.pulse,.spin{animation:none}.motion{display:none}}',
    '</style>',
  ].join('');
}

function sheenStops(): string {
  return [0, 0.5, 1]
    .map(
      (offset) =>
        `<stop offset="${offset}" stop-color="${SIGNAL.onSignal}" stop-opacity="${offset === 0.5 ? 0.75 : 0}"/>`,
    )
    .join('');
}

function defs(glow: boolean, sheen: boolean): string {
  if (!glow && !sheen) return '';
  return [
    '<defs>',
    glow
      ? '<filter id="glow" x="-50%" y="-200%" width="200%" height="500%"><feGaussianBlur stdDeviation="2.2"/></filter>'
      : '',
    sheen ? `<linearGradient id="sheen" x1="0" x2="1">${sheenStops()}</linearGradient>` : '',
    '</defs>',
  ].join('');
}

function arc(c: number, r: number, from: number, to: number): string {
  const point = (a: number) =>
    `${(c + r * Math.cos(a)).toFixed(2)} ${(c + r * Math.sin(a)).toFixed(2)}`;
  return `M ${point(from)} A ${r} ${r} 0 ${to - from > Math.PI ? 1 : 0} 1 ${point(to)}`;
}

function polar(c: number, r: number, a: number): { x: string; y: string } {
  return { x: (c + r * Math.cos(a)).toFixed(2), y: (c + r * Math.sin(a)).toFixed(2) };
}

const GIT: Readonly<Record<string, string>> = {
  Edit: '<path d="M10.8 2.7l2.5 2.5-7.6 7.6-3.2.7.7-3.2z"/>',
  Commit: '<circle cx="8" cy="8" r="2.6"/><path d="M1.5 8h3.9M10.6 8h3.9"/>',
  Push: '<path d="M8 12.5V3.5M4.5 7 8 3.5 11.5 7"/>',
  PR: '<circle cx="4.5" cy="3.5" r="1.7"/><circle cx="4.5" cy="12.5" r="1.7"/><circle cx="11.5" cy="12.5" r="1.7"/><path d="M4.5 5.2v5.6M11.5 10.8V7.2a3 3 0 0 0-3-3H7"/>',
  CI: '<path d="m4.5 8.3 2.3 2.3 4.7-4.9"/>',
  Merge:
    '<circle cx="4.5" cy="3.5" r="1.7"/><circle cx="4.5" cy="12.5" r="1.7"/><circle cx="11.5" cy="8" r="1.7"/><path d="M4.5 5.2v5.6M4.5 5.2c0 2.3 2.5 2.8 5.3 2.8"/>',
};

const DOT_ICON = '<circle cx="8" cy="8" r="2.4"/>';

interface Section {
  x0: number;
  x1: number;
  inner: number;
  last: boolean;
}

function section({ x0, x1, inner, last }: Section, cap: string, value: string): string {
  let out = `<text class="cap mut" x="${fixed(x0)}" y="${Y_CAP}">${cap}</text>`;
  if (value && inner - x0 > VALUE_MIN_WIDTH) {
    out += `<text class="val ink" x="${fixed(inner)}" y="${Y_CAP}" text-anchor="end">${escapeXml(value)}</text>`;
  }
  if (!last) {
    out += `<line class="hair" x1="${fixed(x1)}" y1="1" x2="${fixed(x1)}" y2="${STRIP_HEIGHT - 2}" stroke-width="1"/>`;
  }
  return out;
}

const STAGE_BAR: Readonly<Record<StageState, string>> = {
  done: 'ink',
  run: 'acc pulse',
  paused: 'att',
  marked: 'cau',
  fail: 'fail',
  skip: 'faints',
  todo: 'faint',
};

const STAGE_LABEL: Readonly<Record<StageState, string>> = {
  done: 'ink',
  run: 'acc cur',
  paused: 'att cur',
  marked: 'ink',
  fail: 'fail cur',
  skip: 'mut',
  todo: 'mut',
};

// Running, paused and marked stages share one skeleton (glow, bar, sheen). A state flip only
// changes classes: the glow and sheen show while running and are hidden otherwise.
const LIVE_BAR_STATES: ReadonlySet<StageState> = new Set(['run', 'paused', 'marked']);

function liveBar(
  x: number,
  w: number,
  y: number,
  index: number,
  state: StageState,
  clockMs: number | undefined,
): string {
  const at = `x="${fixed(x)}" y="${y}" width="${fixed(w)}"`;
  const running = state === 'run';
  const glow = running ? 'acc motion' : `${STAGE_BAR[state]} off`;
  const sheen = running ? 'motion' : 'off';
  return [
    `<rect class="${glow}" x="${fixed(x)}" y="${y - 1}" width="${fixed(w)}" height="5" rx="2.5" filter="url(#glow)" opacity=".55"><animate attributeName="opacity" values=".55;.15;.55" dur="1.6s" repeatCount="indefinite"${begin(clockMs, PULSE_MS)}/></rect>`,
    `<clipPath id="run${index}"><rect ${at} height="3" rx="1.5"/></clipPath>`,
    `<rect class="${STAGE_BAR[state]}" ${at} height="3" rx="1.5"/>`,
    `<g class="${sheen}" clip-path="url(#run${index})"><rect x="${fixed(x - 28)}" y="${y}" width="28" height="3" fill="url(#sheen)"><animate attributeName="x" values="${fixed(x - 28)};${fixed(x + w)}" dur="2.2s" calcMode="spline" keyTimes="0;1" keySplines=".4 0 .2 1" repeatCount="indefinite"${begin(clockMs, SHEEN_MS)}/></rect></g>`,
  ].join('');
}

function stageMarks(
  x0: number,
  x1: number,
  stages: ReadonlyArray<Mark<StageState>>,
  clockMs?: number,
): string {
  const gap = 4;
  const n = Math.max(1, stages.length);
  const w = (x1 - x0 - gap * (n - 1)) / n;
  const y = Y_MARK - 1.5;
  return stages
    .map(({ label, state }, i) => {
      const x = x0 + i * (w + gap);
      const bar =
        state === 'skip'
          ? `<line class="faints" x1="${fixed(x + 1)}" y1="${Y_MARK}" x2="${fixed(x + w - 1)}" y2="${Y_MARK}" stroke-width="1" stroke-dasharray="2 3"/>`
          : LIVE_BAR_STATES.has(state)
            ? liveBar(x, w, y, i, state, clockMs)
            : `<rect class="${STAGE_BAR[state]}" x="${fixed(x)}" y="${y}" width="${fixed(w)}" height="3" rx="1.5"/>`;
      return `${bar}<text class="lbl ${STAGE_LABEL[state]}" x="${fixed(x + w / 2)}" y="${Y_LBL}" text-anchor="middle">${escapeXml(label)}</text>`;
    })
    .join('');
}

function seatMark(state: SeatState, cx: string): string {
  if (state === 'done') return `<circle class="ink" cx="${cx}" cy="${Y_MARK}" r="4"/>`;
  if (state === 'writing') {
    return `<circle class="acc pulse" cx="${cx}" cy="${Y_MARK}" r="4" fill-opacity=".22"/><circle class="accs" cx="${cx}" cy="${Y_MARK}" r="4" fill="none" stroke-width="1.4"/>`;
  }
  if (state === 'late') {
    return `<circle class="caus" cx="${cx}" cy="${Y_MARK}" r="4" fill="none" stroke-width="1.4"/>`;
  }
  return `<circle class="faints" cx="${cx}" cy="${Y_MARK}" r="3.6" fill="none" stroke-width="1.2"/>`;
}

function chiefMark(chief: ChiefState, cx: string): string {
  if (chief === 'ruling') {
    return `<circle class="accs spin" cx="${cx}" cy="${Y_MARK}" r="5" fill="none" stroke-width="1.6" stroke-dasharray="3.5 2.6"/>`;
  }
  if (chief === 'needs') {
    return `<circle class="att pulse" cx="${cx}" cy="${Y_MARK}" r="5" fill-opacity=".25"/><circle class="atts" cx="${cx}" cy="${Y_MARK}" r="5" fill="none" stroke-width="1.6"/>`;
  }
  if (chief === 'done') return `<circle class="ink" cx="${cx}" cy="${Y_MARK}" r="5"/>`;
  return `<circle class="faints" cx="${cx}" cy="${Y_MARK}" r="5" fill="none" stroke-width="1.2" stroke-dasharray="2 2"/>`;
}

function tableMarks(
  x0: number,
  x1: number,
  seats: ReadonlyArray<Mark<SeatState>>,
  chief: ChiefState,
): string {
  const step = Math.min(SEAT_SPACING, (x1 - x0 - 34) / Math.max(1, seats.length));
  let out = '';
  seats.forEach(({ label, state }, i) => {
    const cx = fixed(x0 + 5 + i * step);
    out += seatMark(state, cx);
    out += `<text class="lbl mut" x="${cx}" y="${Y_LBL}" text-anchor="middle">${escapeXml(label)}</text>`;
  });
  const sx = x0 + 5 + seats.length * step - step / 2 + 6;
  out += `<line class="hair" x1="${fixed(sx)}" y1="${Y_MARK - 6}" x2="${fixed(sx)}" y2="${Y_MARK + 6}" stroke-width="1"/>`;
  const ccx = fixed(sx + 14);
  out += chiefMark(chief, ccx);
  out += `<text class="lbl mut" x="${ccx}" y="${Y_LBL}" text-anchor="middle">CA</text>`;
  return out;
}

function shareOf(label: string, ci: number | null): number | null {
  return label === 'CI' && ci !== null ? Math.max(0.05, Math.min(1, ci)) : null;
}

function nodeArt(
  state: ShipState,
  x: string,
  y: string,
  r: number,
  share: number | null,
  outer: number,
): { ring: string; stroke: string } {
  if (state === 'done') {
    return {
      ring: `<circle class="ink" cx="${x}" cy="${y}" r="${r}" fill-opacity=".1"/><circle class="inks" cx="${x}" cy="${y}" r="${r}" fill="none" stroke-width="1.2"/>`,
      stroke: 'class="inks"',
    };
  }
  if (state === 'run') {
    const rr = r + outer;
    const len = 2 * Math.PI * rr;
    const arcLength = len * (share ?? 0.3);
    return {
      ring: [
        `<circle class="faints" cx="${x}" cy="${y}" r="${r}" fill="none" stroke-width="1.2"/>`,
        `<circle class="faints" cx="${x}" cy="${y}" r="${rr}" fill="none" stroke-width="1.4" style="stroke-opacity:.18"/>`,
        `<g${share === null ? ' class="spin"' : ''}><circle class="accs" cx="${x}" cy="${y}" r="${rr}" fill="none" stroke-width="1.6" stroke-linecap="round" stroke-dasharray="${fixed(arcLength)} ${fixed(len)}" transform="rotate(-90 ${x} ${y})"/></g>`,
      ].join(''),
      stroke: 'class="accs"',
    };
  }
  if (state === 'fail') {
    return {
      ring: `<circle class="fails" cx="${x}" cy="${y}" r="${r}" fill="none" stroke-width="1.4"/>`,
      stroke: 'class="fails"',
    };
  }
  if (state === 'ready') {
    return {
      ring: `<circle class="pass" cx="${x}" cy="${y}" r="${r}"/>`,
      stroke: `stroke="${SIGNAL.onSignal}"`,
    };
  }
  return {
    ring: `<circle class="faints" cx="${x}" cy="${y}" r="${r}" fill="none" stroke-width="1.2"/>`,
    stroke: 'class="faints"',
  };
}

function icon(label: string, x: number, y: number, stroke: string): string {
  return `<g transform="translate(${fixed(x - 5)} ${fixed(y - 5)}) scale(.625)" fill="none" ${stroke} stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${GIT[label] ?? DOT_ICON}</g>`;
}

const NODE_LABEL: Readonly<Record<ShipState, string>> = {
  done: 'ink',
  run: 'acc cur',
  ready: 'pass cur',
  fail: 'fail cur',
  todo: 'mut',
};

function deliveryMarks(
  x0: number,
  x1: number,
  steps: ReadonlyArray<Mark<ShipState>>,
  ci: number | null,
  clockMs?: number,
): string {
  const r = NODE_RADIUS;
  const n = steps.length;
  const step = n > 1 ? Math.min(NODE_SPACING, (x1 - x0 - 2 * r) / (n - 1)) : 0;
  const cx = (i: number) => x0 + r + i * step;
  let out = '';
  for (let i = 0; i < n - 1; i += 1) {
    const next = steps[i + 1]!.state;
    const reached = next === 'done' || next === 'run' || next === 'ready';
    out += `<line class="${reached ? 'inks' : 'faints'}" x1="${fixed(cx(i) + r + CONNECTOR_GAP)}" y1="${Y_MARK}" x2="${fixed(cx(i + 1) - r - CONNECTOR_GAP)}" y2="${Y_MARK}" stroke-width="1.2" stroke-linecap="round"/>`;
  }
  steps.forEach(({ label, state }, i) => {
    const x = fixed(cx(i));
    if (state === 'ready') {
      out += `<circle class="pass motion" cx="${x}" cy="${Y_MARK}" r="${r + 4}" filter="url(#glow)" opacity=".5"><animate attributeName="opacity" values=".5;.15;.5" dur="2.4s" repeatCount="indefinite"${begin(clockMs, READY_MS)}/></circle>`;
    }
    const art = nodeArt(state, x, String(Y_MARK), r, shareOf(label, ci), 3);
    out += art.ring + icon(label, cx(i), Y_MARK, art.stroke);
    out += `<text class="lbl ${NODE_LABEL[state]}" x="${x}" y="${Y_LBL}" text-anchor="middle">${escapeXml(label)}</text>`;
  });
  return out;
}

export function stripWidth(columns: number): number {
  return Math.max(STRIP_MIN_WIDTH, Math.round(columns * PX_PER_COLUMN));
}

export function strip(input: StripInput): { source: string; width: number; height: number } {
  const width = stripWidth(input.columns);
  const parts = input.seats ? [0.4, 0.26, 0.34] : [0.56, 0.44];
  const edges = [0];
  parts.forEach((part, i) => edges.push(edges[i]! + part * width));
  const sections: Section[] = parts.map((_, i) => {
    const last = i === parts.length - 1;
    const x1 = edges[i + 1]!;
    return {
      x0: edges[i]! + (i === 0 ? 0 : SECTION_PAD),
      x1,
      inner: last ? x1 - RIGHT_INSET : x1 - SECTION_PAD,
      last,
    };
  });
  const stage = sections[0]!;
  const delivery = sections.at(-1)!;
  let body = section(stage, 'STAGE', input.stageValue);
  body += stageMarks(stage.x0, stage.inner, input.stages, input.clockMs);
  if (input.seats) {
    const table = sections[1]!;
    body += section(table, 'HIGH TABLE', input.tableValue);
    body += tableMarks(table.x0, table.inner, input.seats, input.chief);
  }
  body += section(delivery, 'DELIVERY', input.deliveryValue);
  body += deliveryMarks(
    delivery.x0 + DELIVERY_INSET,
    delivery.inner - DELIVERY_INSET,
    input.delivery,
    input.ci,
    input.clockMs,
  );
  const live = input.stages.some((mark) => LIVE_BAR_STATES.has(mark.state));
  const ready = input.delivery.some((mark) => mark.state === 'ready');
  return {
    source: svg(width, STRIP_HEIGHT, css(input.clockMs) + defs(live || ready, live) + body),
    width,
    height: STRIP_HEIGHT,
  };
}

export function stripAlt(
  headline: string,
  input: Pick<StripInput, 'stageValue' | 'seats' | 'tableValue' | 'deliveryValue'>,
): string {
  const parts = [`${headline.replace(/\.$/, '')}.`, `Stage ${input.stageValue || 'not started'}.`];
  if (input.seats && input.tableValue) parts.push(`High Table ${input.tableValue}.`);
  if (input.deliveryValue) parts.push(`Delivery ${input.deliveryValue}.`);
  return parts.join(' ');
}

export function miniStages(stages: readonly StageState[]): string {
  const w = 64;
  const gap = 2;
  const n = Math.max(1, stages.length);
  const bw = (w - gap * (n - 1)) / n;
  const body = stages
    .map((state, i) => {
      const x = i * (bw + gap);
      return state === 'skip'
        ? `<line class="faints" x1="${fixed(x)}" y1="2" x2="${fixed(x + bw)}" y2="2" stroke-width="1" stroke-dasharray="1.5 2"/>`
        : `<rect class="${STAGE_BAR[state]}" x="${fixed(x)}" y=".5" width="${fixed(bw)}" height="3" rx="1.5"/>`;
    })
    .join('');
  return svg(w, 4, css() + body);
}

export function tabRule(count: number, selected: number): string {
  const w = 2000;
  const seg = w / Math.max(1, count);
  return svg(
    w,
    2,
    `<rect x="0" y="1" width="${w}" height="1" fill="${INK.muted}" fill-opacity="${INK.hairOpacity}"/><rect x="${fixed(selected * seg + seg * 0.2)}" y="0" width="${fixed(seg * 0.6)}" height="2" rx="1" fill="${SIGNAL.accent}"/>`,
    ' preserveAspectRatio="none"',
  );
}

export function hairline(): string {
  return svg(
    2000,
    1,
    `<rect x="0" y="0" width="2000" height="1" fill="${INK.muted}" fill-opacity="${INK.hairOpacity}"/>`,
    ' preserveAspectRatio="none"',
  );
}

const SEAT_ARC: Readonly<Record<SeatState, string>> = {
  done: 'inks',
  writing: 'accs pulse',
  seated: 'faints',
  late: 'caus',
};

const CHIEF_RING: Readonly<Record<ChiefState, string>> = {
  waiting: 'faints',
  ruling: 'accs spin',
  needs: 'atts pulse',
  done: 'inks',
};

const CHIEF_WORD: Readonly<Record<ChiefState, { word: string; tone: string }>> = {
  waiting: { word: 'listening', tone: 'mut' },
  ruling: { word: 'ruling', tone: 'acc' },
  needs: { word: 'needs you', tone: 'att' },
  done: { word: 'approved', tone: 'pass' },
};

export function tableRing(seats: readonly TableSeat[], chief: ChiefState): string {
  const size = 150;
  const c = size / 2;
  const r = 52;
  const n = Math.max(1, seats.length);
  let body = '';
  seats.forEach(({ label, state, findings }, i) => {
    const from = (i / n) * Math.PI * 2 - Math.PI / 2 + 0.07;
    const to = ((i + 1) / n) * Math.PI * 2 - Math.PI / 2 - 0.07;
    const mid = (from + to) / 2;
    const faded = state === 'seated' ? ' style="stroke-opacity:.3"' : '';
    body += `<path class="${SEAT_ARC[state]}" d="${arc(c, r, from, to)}" fill="none" stroke-width="7" stroke-linecap="round"${faded}/>`;
    if (state !== 'seated') {
      const a = polar(c, r - 8, mid);
      const b = polar(c, 30, mid);
      const writing = state === 'writing';
      body += `<line class="${writing ? 'accs' : 'hair'}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke-width="1"${writing ? ' stroke-dasharray="2 3" style="stroke-opacity:.7"' : ''}/>`;
    }
    const at = polar(c, r + 15, mid);
    body += `<text class="mut" x="${at.x}" y="${fixed(Number(at.y) + 3)}" text-anchor="middle" style="font-size:9px;font-weight:600">${escapeXml(label)}</text>`;
    if ((state === 'done' || state === 'late') && typeof findings === 'number') {
      const badge = polar(c, r, mid);
      body += `<circle class="ink" cx="${badge.x}" cy="${badge.y}" r="6.5"/><text fill="${SIGNAL.onSignal}" x="${badge.x}" y="${fixed(Number(badge.y) + 2.8)}" text-anchor="middle" style="font-size:7.5px;font-weight:600">${findings}</text>`;
    }
  });
  const dash = chief === 'ruling' || chief === 'waiting' ? ' stroke-dasharray="4 3"' : '';
  body += `<circle class="${CHIEF_RING[chief]}" cx="${c}" cy="${c}" r="24" fill="none" stroke-width="1.6"${dash}/>`;
  body += `<text class="ink" x="${c}" y="${c - 1}" text-anchor="middle" style="font-size:11px;font-weight:600">Chief</text>`;
  body += `<text class="${CHIEF_WORD[chief].tone}" x="${c}" y="${c + 11}" text-anchor="middle" style="font-size:8.5px">${CHIEF_WORD[chief].word}</text>`;
  return svg(size, size, css() + body);
}

export function nodeIcon(label: string, state: ShipState, ci: number | null = null): string {
  const size = 24;
  const x = size / 2;
  const art =
    state === 'ready'
      ? {
          ring: `<circle class="pass" cx="${x}" cy="${x}" r="${NODE_RADIUS + 2}"/>`,
          stroke: `stroke="${SIGNAL.onSignal}"`,
        }
      : nodeArt(state, String(x), String(x), NODE_RADIUS, shareOf(label, ci), 2.6);
  return svg(size, size, css() + art.ring + icon(label, x, x, art.stroke));
}

export function meter(share: number | null, tone: MeterTone = 'ink'): string {
  const w = 2000;
  const track = `<rect class="faint" x="0" y="0" width="${w}" height="4" rx="2" style="fill-opacity:.18"/>`;
  if (share === null) {
    const run = w * 0.3;
    const sweep = `<linearGradient id="meterSheen" x1="0" x2="1"><stop offset="0" stop-color="${SIGNAL.accent}" stop-opacity="0"/><stop offset=".5" stop-color="${SIGNAL.accent}" stop-opacity="1"/><stop offset="1" stop-color="${SIGNAL.accent}" stop-opacity="0"/></linearGradient>`;
    return svg(
      w,
      4,
      `${css()}<defs>${sweep}</defs>${track}<rect x="${-run}" y="0" width="${run}" height="4" rx="2" fill="url(#meterSheen)"><animate attributeName="x" values="${-run};${w}" dur="2.2s" calcMode="spline" keyTimes="0;1" keySplines=".4 0 .2 1" repeatCount="indefinite"/></rect>`,
      ' preserveAspectRatio="none"',
    );
  }
  const fill = Math.max(0, Math.min(1, share)) * w;
  return svg(
    w,
    4,
    `${css()}${track}<rect class="${tone}" x="0" y="0" width="${fixed(fill)}" height="4" rx="2"/>`,
    ' preserveAspectRatio="none"',
  );
}
