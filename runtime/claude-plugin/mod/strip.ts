import { fitLine } from './shell';
import {
  BREATH,
  INK,
  PX_PER_COLUMN,
  SIGNAL,
  STATUS_B,
  SVG_FONT,
  signalColor,
  type Signal,
} from './palette';

export type StageState = 'done' | 'run' | 'paused' | 'marked' | 'fail' | 'skip' | 'todo';
export type SeatState = 'done' | 'writing' | 'seated' | 'late';
export type ChiefState = 'waiting' | 'ruling' | 'needs' | 'done';
export type ShipState = 'done' | 'run' | 'todo' | 'fail';
export type MeterTone = 'ink' | 'acc' | 'pass';

export interface Mark<S> {
  label: string;
  state: S;
}

export interface TableSeat extends Mark<SeatState> {
  findings: number | null;
}

export type DeliveryTone = 'ink' | 'acc' | 'fail' | 'mut';

export interface DeliveryFigures {
  commits: number;
  additions: number;
  deletions: number;
  partial?: boolean;
}

export type SignoffTone = 'acct' | 'caut' | 'passt' | 'fail' | 'mutt';

export interface StripSignoff {
  words: string;
  tone: SignoffTone;
  button: string | null;
  ref?: string | null;
  name?: string | null;
}

export interface StripInput {
  columns: number;
  stages: ReadonlyArray<Mark<StageState>>;
  stageValue: string;
  stageValueShort?: string;
  seats: ReadonlyArray<Mark<SeatState>> | null;
  hiddenSeats?: number;
  chief: ChiefState;
  tableValue: string;
  deliveryValue: string;
  deliveryTone: DeliveryTone;
  deliveryFigures: DeliveryFigures | null;
  signoff?: StripSignoff | null;
  clockMs?: number;
  settledAtMs?: number | null;
}

export const STRIP_HEIGHT = 52;

const PULSE_MS = 1600;
const SPIN_MS = 4000;
const SHEEN_MS = 2200;
const SETTLE_MS = 2000;
const TITLE_SHEEN_MS = 3600;
const BREATH_MS = 2400;
const TAG_BREATH_MS = 2400;

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
const NODE_RADIUS = 8.5;
const SEAT_SPACING = 22;
export const TABLE_PX = 150;
export const DELIVERY_PX = 190;
export const STAGE_MIN_PX = 340;
export const LABEL_MIN_PX = 40;
export const STAGE_NAME_X = 44;
const NEEDS_ANSWERS = 'Needs answers';
const NEEDS_ANSWERS_MIN_PX = 75;
const VALUE_CHAR_PX = 6;
const STATUS_CHAR_PX = 6.8;
const FIGURE_CHAR_PX = 6;
const Y_STATUS = 29.3;
const CHIEF_REACH = 31;
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

function svg(width: number, height: number, body: string, extra = '', x = 0): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} 0 ${width} ${height}" width="${width}" height="${height}"${extra}>${body}</svg>`;
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
    `.passt{fill:${SIGNAL.passText}}`,
    `.fail{fill:${STATUS_B.failed}}.fails{stroke:${STATUS_B.failed}}`,
    `.acct{fill:${SIGNAL.accentText}}.caut{fill:${SIGNAL.cautionText}}.mutt{fill:${INK.mutedText}}`,
    '.cap{font-size:8.5px;font-weight:600;letter-spacing:1.1px}',
    '.val{font-size:10.5px;font-weight:500}',
    '.lbl{font-size:9px}.cur{font-weight:650}',
    '@media (prefers-color-scheme: dark){',
    `.ink{fill:${INK.inkDark}}.inks{stroke:${INK.inkDark}}.mut{fill:${INK.mutedDark}}`,
    `.pass{fill:${STATUS_B.doneDark}}.passs{stroke:${STATUS_B.doneDark}}`,
    `.passt{fill:${SIGNAL.passDark}}`,
    `.fail{fill:${STATUS_B.failedDark}}.fails{stroke:${STATUS_B.failedDark}}`,
    `.cau{fill:${SIGNAL.cautionDark}}.caus{stroke:${SIGNAL.cautionDark}}`,
    `.acct{fill:${SIGNAL.accentTextDark}}.caut{fill:${SIGNAL.cautionDark}}.mutt{fill:${INK.mutedDark}}`,
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
};

const DOT_ICON = '<circle cx="8" cy="8" r="2.4"/>';

interface Section {
  x0: number;
  x1: number;
  inner: number;
  last: boolean;
}

function section({ x0, x1, last }: Section, cap: string, cut = false): string {
  let out = cap ? `<text class="cap mut" x="${fixed(x0)}" y="${Y_CAP}">${cap}</text>` : '';
  if (!last) {
    const at = fixed(cut ? x1 - 0.5 : x1);
    out += `<line class="hair" x1="${at}" y1="1" x2="${at}" y2="${STRIP_HEIGHT - 2}" stroke-width="1"/>`;
  }
  return out;
}

const STAGE_BAR: Readonly<Record<StageState, string>> = {
  done: 'pass',
  run: 'acc pulse',
  paused: 'att',
  marked: 'cau',
  fail: 'fail',
  skip: 'faints',
  todo: 'faint',
};

const STAGE_LABEL: Readonly<Record<StageState, string>> = {
  done: 'passt',
  run: 'acc cur',
  paused: 'att cur',
  marked: 'ink',
  fail: 'fail cur',
  skip: 'mut',
  todo: 'mut',
};

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

export function settlePhase(
  clockMs: number | undefined,
  settledAtMs: number | null | undefined,
): string | null {
  if (clockMs === undefined || settledAtMs === null || settledAtMs === undefined) return null;
  const into = clockMs - settledAtMs;
  if (!Number.isFinite(into) || into < 0 || into >= SETTLE_MS) return null;
  return `-${(into / 1000).toFixed(3)}s`;
}

function stageLabel(label: string, state: StageState): string {
  const text = escapeXml(label);
  return state === 'done' ? `<tspan class="pass">✓</tspan> ${text}` : text;
}

function settleGlow(bars: ReadonlyArray<{ x: number; w: number }>, y: number, at: string): string {
  const rects = bars
    .map(
      ({ x, w }) =>
        `<rect class="pass" x="${fixed(x)}" y="${y - 1}" width="${fixed(w)}" height="5" rx="2.5" filter="url(#glow)" opacity="0"><animate attributeName="opacity" values=".5;0" dur="2s" repeatCount="1" fill="freeze" begin="${at}"/></rect>`,
    )
    .join('');
  return `<g class="motion settle">${rects}</g>`;
}

const STAGE_GAP = 4;

export function stageBarPx(room: number, bars: number): number {
  const n = Math.max(1, bars);
  return (room - STAGE_GAP * (n - 1)) / n;
}

function stageMarks(
  x0: number,
  x1: number,
  stages: ReadonlyArray<Mark<StageState>>,
  clockMs?: number,
  settle: string | null = null,
): string {
  const gap = STAGE_GAP;
  const n = Math.max(1, stages.length);
  const w = stageBarPx(x1 - x0, n);
  const labels = w >= LABEL_MIN_PX;
  const y = Y_MARK - 1.5;
  const done = stages.flatMap(({ state }, i) =>
    state === 'done' ? [{ x: x0 + i * (w + gap), w }] : [],
  );
  const glow = settle === null || done.length === 0 ? '' : settleGlow(done, y, settle);
  return (
    glow +
    stages
      .map(({ label, state }, i) => {
        const x = x0 + i * (w + gap);
        const bar =
          state === 'skip'
            ? `<line class="faints" x1="${fixed(x + 1)}" y1="${Y_MARK}" x2="${fixed(x + w - 1)}" y2="${Y_MARK}" stroke-width="1" stroke-dasharray="2 3"/>`
            : LIVE_BAR_STATES.has(state)
              ? liveBar(x, w, y, i, state, clockMs)
              : `<rect class="${STAGE_BAR[state]}" x="${fixed(x)}" y="${y}" width="${fixed(w)}" height="3" rx="1.5"/>`;
        if (!labels) return bar;
        return `${bar}<text class="lbl ${STAGE_LABEL[state]}" x="${fixed(x + w / 2)}" y="${Y_LBL}" text-anchor="middle">${stageLabel(label, state)}</text>`;
      })
      .join('')
  );
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
  hidden: number,
): string {
  const slots = seats.length + (hidden > 0 ? 1 : 0);
  const step = Math.min(SEAT_SPACING, (x1 - x0 - CHIEF_REACH) / (Math.max(1, slots) - 0.5));
  let out = '';
  seats.forEach(({ label, state }, i) => {
    const cx = fixed(x0 + 5 + i * step);
    out += seatMark(state, cx);
    out += `<text class="lbl mut" x="${cx}" y="${Y_LBL}" text-anchor="middle">${escapeXml(label)}</text>`;
  });
  if (hidden > 0) {
    out += `<text class="lbl mut" x="${fixed(x0 + 5 + seats.length * step)}" y="${Y_MARK + 3}" text-anchor="middle" style="font-weight:500">+${hidden}</text>`;
  }
  const sx = x0 + 5 + slots * step - step / 2 + 6;
  const ccx = fixed(sx + 14);
  out +=
    seats.length === 1 && hidden === 0
      ? `<line class="faints" x1="${fixed(x0 + 10)}" y1="${Y_MARK}" x2="${fixed(sx + 14 - 6)}" y2="${Y_MARK}" stroke-width="1.2" stroke-linecap="round"/>`
      : `<line class="hair" x1="${fixed(sx)}" y1="${Y_MARK - 6}" x2="${fixed(sx)}" y2="${Y_MARK + 6}" stroke-width="1"/>`;
  out += chiefMark(chief, ccx);
  out += `<text class="lbl mut" x="${ccx}" y="${Y_LBL}" text-anchor="middle">CA</text>`;
  return out;
}

const STILL_SHARE = 0.3;

function shareOf(label: string, ci: number | null): number | null {
  if (label !== 'CI') return null;
  return ci === null ? STILL_SHARE : Math.max(0.05, Math.min(1, ci));
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
    const arcLength = len * (share ?? STILL_SHARE);
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
  return {
    ring: `<circle class="faints" cx="${x}" cy="${y}" r="${r}" fill="none" stroke-width="1.2"/>`,
    stroke: 'class="faints"',
  };
}

function icon(label: string, x: number, y: number, stroke: string): string {
  return `<g transform="translate(${fixed(x - 5)} ${fixed(y - 5)}) scale(.625)" fill="none" ${stroke} stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${GIT[label] ?? DOT_ICON}</g>`;
}

export function stripWidth(columns: number): number {
  return Math.max(STRIP_MIN_WIDTH, Math.round(columns * PX_PER_COLUMN));
}

export type StripSectionId = 'stage' | 'table' | 'delivery';

export interface StripSection {
  id: StripSectionId;
  px: number;
  grow: boolean;
  source: string;
}

export interface StripLayout {
  ids: StripSectionId[];
  px: number[];
}

export function stripLayout(width: number, table: boolean): StripLayout {
  if (width < STAGE_MIN_PX + DELIVERY_PX) return { ids: ['stage'], px: [width] };
  if (table && width >= STAGE_MIN_PX + DELIVERY_PX + TABLE_PX) {
    return {
      ids: ['stage', 'table', 'delivery'],
      px: [width - TABLE_PX - DELIVERY_PX, TABLE_PX, DELIVERY_PX],
    };
  }
  return { ids: ['stage', 'delivery'], px: [width - DELIVERY_PX, DELIVERY_PX] };
}

const WORDS_GAP_PX = 10;
const BUTTON_PAD_COLUMNS = 3;

export function buttonPx(label: string): number {
  return ([...label].length + BUTTON_PAD_COLUMNS) * PX_PER_COLUMN + WORDS_GAP_PX;
}

function fitPx(text: string, px: number, charPx: number): string {
  if (px < charPx) return '';
  return fitLine(text, px / charPx);
}

function thousands(n: number): string {
  return n.toLocaleString('en-US');
}

export function figureWords(figures: DeliveryFigures | null): {
  commits: string;
  additions: string;
  deletions: string;
} | null {
  if (!figures || figures.additions + figures.deletions <= 0) return null;
  const more = figures.partial ? '+' : '';
  return {
    commits:
      figures.commits > 0
        ? `${figures.commits} ${figures.commits === 1 ? 'commit' : 'commits'}`
        : '',
    additions: `+${thousands(figures.additions)}${more}`,
    deletions: `−${thousands(figures.deletions)}`,
  };
}

function deliveryLines(x0: number, inner: number, input: StripInput): string {
  const room = inner - x0;
  const status = fitPx(input.deliveryValue, room, STATUS_CHAR_PX);
  let out = status
    ? `<text class="${input.deliveryTone}" x="${fixed(x0)}" y="${Y_STATUS}" style="font-size:12px;font-weight:500">${escapeXml(status)}</text>`
    : '';
  const words = figureWords(input.deliveryFigures);
  if (!words) return out;
  const figures = `${words.additions} ${words.deletions}`;
  const commits =
    words.commits && (words.commits.length + 2 + figures.length) * FIGURE_CHAR_PX <= room
      ? words.commits
      : '';
  const at = `x="${fixed(x0)}" y="${Y_LBL}" style="font-size:10.5px"`;
  if (figures.length * FIGURE_CHAR_PX > room) {
    const cut = fitPx(figures, room, FIGURE_CHAR_PX);
    return `${out}<text class="mut" ${at}>${escapeXml(cut)}</text>`;
  }
  const lead = commits ? `<tspan class="mut">${escapeXml(commits)}</tspan><tspan>  </tspan>` : '';
  out += `<text ${at} xml:space="preserve">${lead}<tspan class="passt">${escapeXml(words.additions)}</tspan><tspan> </tspan><tspan class="fail">${escapeXml(words.deletions)}</tspan></text>`;
  return out;
}

function stripBody(
  input: StripInput,
  ids: readonly StripSectionId[],
  sections: readonly Section[],
  cut: boolean,
): Record<StripSectionId, string> {
  const stage = sections[0]!;
  const settle = settlePhase(input.clockMs, input.settledAtMs);
  const body = { stage: '', table: '', delivery: '' };
  body.stage = section(stage, 'STAGE', cut);
  const signoff = input.signoff ?? null;
  const wordsEnd = stage.inner - (signoff?.button ? buttonPx(signoff.button) : 0);
  const wordsPx = signoff ? [...signoff.words].length * VALUE_CHAR_PX : 0;
  if (signoff) {
    body.stage += `<text class="val ${signoff.tone}" x="${fixed(wordsEnd)}" y="${Y_CAP}" text-anchor="end">${escapeXml(signoff.words)}</text>`;
  }
  const nameRoom =
    (signoff ? wordsEnd - wordsPx - WORDS_GAP_PX : stage.inner) - (stage.x0 + STAGE_NAME_X);
  const value =
    input.stageValueShort && [...input.stageValue].length * VALUE_CHAR_PX > nameRoom
      ? input.stageValueShort
      : input.stageValue;
  const name = value ? fitPx(value, nameRoom, VALUE_CHAR_PX) : '';
  if (name) {
    body.stage += `<text class="val ink" x="${fixed(stage.x0 + STAGE_NAME_X)}" y="${Y_CAP}">${escapeXml(name)}</text>`;
  }
  body.stage += stageMarks(stage.x0, stage.inner, input.stages, input.clockMs, settle);
  const tableAt = ids.indexOf('table');
  if (input.seats && tableAt > 0) {
    const table = sections[tableAt]!;
    const needs =
      input.tableValue === NEEDS_ANSWERS && table.inner - table.x0 >= NEEDS_ANSWERS_MIN_PX;
    body.table = section(table, needs ? '' : 'HIGH TABLE', cut);
    if (needs) {
      body.table += `<text class="val att" x="${fixed(table.x0)}" y="${Y_CAP}">${NEEDS_ANSWERS}</text>`;
    }
    body.table += tableMarks(
      table.x0,
      table.inner,
      input.seats,
      input.chief,
      input.hiddenSeats ?? 0,
    );
  }
  const deliveryAt = ids.indexOf('delivery');
  if (deliveryAt > 0) {
    const delivery = sections[deliveryAt]!;
    body.delivery = section(delivery, 'DELIVERY', cut);
    body.delivery += deliveryLines(delivery.x0, delivery.inner, input);
  }
  return body;
}

function trim(n: number): number {
  return Number(n.toFixed(2));
}

function layout(px: readonly number[]): { edges: number[]; sections: Section[] } {
  const edges = [0];
  px.forEach((width, i) => edges.push(edges[i]! + width));
  const sections: Section[] = px.map((_, i) => {
    const last = i === px.length - 1;
    const x1 = edges[i + 1]!;
    return {
      x0: edges[i]! + (i === 0 ? 0 : SECTION_PAD),
      x1,
      inner: last ? x1 - RIGHT_INSET : x1 - SECTION_PAD,
      last,
    };
  });
  return { edges, sections };
}

export function seatsThatFit(seats: number, cap: number): number {
  const room = TABLE_PX - 2 * SECTION_PAD - CHIEF_REACH;
  for (let shown = Math.min(cap, seats); shown > 1; shown -= 1) {
    const slots = shown + (seats > shown ? 1 : 0);
    if ((slots - 0.5) * SEAT_SPACING <= room) return shown;
  }
  return Math.min(1, seats);
}

export function strip(input: StripInput): {
  source: string;
  width: number;
  height: number;
  sections: StripSection[];
} {
  const width = stripWidth(input.columns);
  const { ids, px } = stripLayout(width, input.seats !== null);
  const { edges, sections } = layout(px);
  const settle = settlePhase(input.clockMs, input.settledAtMs);
  const live = input.stages.some((mark) => LIVE_BAR_STATES.has(mark.state));
  const style = css(input.clockMs);
  const art = defs(live || settle !== null, live);
  const whole = stripBody(input, ids, sections, false);
  const cuts = stripBody(input, ids, sections, true);
  return {
    source: svg(width, STRIP_HEIGHT, style + art + whole.stage + whole.table + whole.delivery),
    width,
    height: STRIP_HEIGHT,
    sections: ids.map((id, i) => ({
      id,
      px: trim(px[i]!),
      grow: id === 'stage',
      source: svg(
        trim(edges[i + 1]! - edges[i]!),
        STRIP_HEIGHT,
        style + (id === 'stage' ? art : '') + cuts[id],
        '',
        trim(edges[i]!),
      ),
    })),
  };
}

export interface LiveHeadlineInput {
  columns: number;
  signal: Signal;
  text: string;
  note: string | null;
  clock: string | null;
  clockMs?: number;
  tag?: string | null;
}

export const HEADLINE_HEIGHT = 24;

function headlineCss(): string {
  const title = INK.headline;
  const titleDark = INK.headlineDark;
  return [
    '<style>',
    `text{font-family:${SVG_FONT};font-variant-numeric:tabular-nums}`,
    '.ttl{fill:url(#title-sheen);font-size:17px;font-weight:600}',
    '.aside{font-size:12px;font-weight:400}',
    `.hs{stop-color:${title}}.mut{fill:${INK.muted}}`,
    '.still{display:none}',
    '@media (prefers-color-scheme: dark){',
    `.hs{stop-color:${titleDark}}.mut{fill:${INK.mutedDark}}`,
    '}',
    `@media (prefers-reduced-motion: reduce){.ttl{fill:${title}}.motion{display:none}.still{display:inline}}`,
    `@media (prefers-color-scheme: dark) and (prefers-reduced-motion: reduce){.ttl{fill:${titleDark}}}`,
    '</style>',
  ].join('');
}

function breathValues(): string {
  return BREATH.map((alpha) => String(Math.round((parseInt(alpha, 16) / 255) * 100) / 100)).join(
    ';',
  );
}

function tagPill(tag: string, clockMs: number | undefined): string {
  const shape = `x=".6" y="3.6" width="70" height="14.8" rx="7.4" fill="none" stroke="${SIGNAL.accent}" stroke-width="1.1"`;
  return [
    `<rect class="motion" ${shape}><animate attributeName="stroke-opacity" values=".25;1;.25" dur="2.4s" repeatCount="indefinite" calcMode="spline" keySplines=".4 0 .6 1;.4 0 .6 1"${begin(clockMs, TAG_BREATH_MS)}/></rect>`,
    `<rect class="still" ${shape} stroke-opacity=".55"/>`,
    `<text x="35.6" y="14" text-anchor="middle" style="font-size:8.5px;font-weight:600;letter-spacing:1px" fill="${SIGNAL.accent}">${escapeXml(tag)}</text>`,
  ].join('');
}

export function liveHeadline(input: LiveHeadlineInput): {
  source: string;
  width: number;
  height: number;
} {
  const width = stripWidth(input.columns);
  const colour = signalColor(input.signal);
  const sheen = [
    '<defs><linearGradient id="title-sheen" gradientUnits="objectBoundingBox" x1="0" x2=".18">',
    '<stop class="hs" offset="0"/>',
    `<stop offset=".5" stop-color="${SIGNAL.accent}" stop-opacity=".9"/>`,
    '<stop class="hs" offset="1"/>',
    `<animateTransform attributeName="gradientTransform" type="translate" values="-.3 0;1.3 0;1.3 0" keyTimes="0;.61;1" calcMode="spline" keySplines=".4 0 .2 1;0 0 1 1" dur="3.6s" repeatCount="indefinite"${begin(input.clockMs, TITLE_SHEEN_MS)}/>`,
    '</linearGradient></defs>',
  ].join('');
  const dot = `cx="6" cy="11" r="5.5" fill="${colour}"`;
  const dots = [
    `<circle class="motion" ${dot}><animate attributeName="opacity" values="${breathValues()}" dur="2.4s" calcMode="discrete" repeatCount="indefinite"${begin(input.clockMs, BREATH_MS)}/></circle>`,
    `<circle class="still" ${dot}/>`,
  ].join('');
  const aside = (words: string | null) =>
    words ? `<tspan class="aside mut" dx="16">${escapeXml(words)}</tspan>` : '';
  const tag = input.tag ? tagPill(input.tag, input.clockMs) : '';
  const line = `<text x="${tag ? 81 : 20}" y="17"><tspan class="ttl">${escapeXml(input.text)}</tspan>${aside(input.note)}${aside(input.clock)}</text>`;
  return {
    source: svg(width, HEADLINE_HEIGHT, headlineCss() + sheen + (tag || dots) + line),
    width,
    height: HEADLINE_HEIGHT,
  };
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
  const art = nodeArt(state, String(x), String(x), NODE_RADIUS, shareOf(label, ci), 2.6);
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
