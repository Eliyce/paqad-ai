import type { PaqadHudSnapshot, PaqadPaneTab, PaqadTone } from './types';

export type BandAction = 'minimise' | 'restore' | 'close' | 'show' | 'reopen';

export interface BandSegment {
  text: string;
  tone?: PaqadTone;
  dim?: boolean;
  opens?: PaqadPaneTab;
  action?: BandAction;
  hotkey?: string;
  key?: string;
}

export type BandRow = BandSegment[];

export interface BandCell {
  key: string;
  top: BandSegment;
  bottom: BandSegment;
}

export interface BandSvg {
  source: string;
  alt: string;
  width: number;
  height: number;
}

export interface BandBlock {
  key: string;
  title: BandRow;
  cells: BandCell[];
  svg: BandSvg | null;
  note: BandRow | null;
}

export interface BandSplitRow {
  left: BandRow;
  right: BandRow;
}

export interface BandBody {
  blocks: BandBlock[];
  footer: BandSplitRow | null;
}

export interface BodyContext {
  now: number;
  surface: 'terminal' | 'desktop';
  turnStartedAt?: number | null;
}

export type BodyRenderer = (snapshot: PaqadHudSnapshot, context: BodyContext) => BandBody;

export const BAND_BODIES: Record<string, BodyRenderer> = {};

export function registerBandBody(workflow: string, renderer: BodyRenderer): void {
  BAND_BODIES[workflow] = renderer;
}

export interface ShellHeader {
  tone: PaqadTone;
  chip: string | null;
  headline: string;
  verdict: { word: string; tone: PaqadTone } | null;
  flags: number;
  lane: string | null;
  tokens: string | null;
}

export type BandLayout =
  | { kind: 'none' }
  | { kind: 'line'; row: BandRow }
  | {
      kind: 'card';
      tone: PaqadTone;
      header: BandSplitRow;
      direction: 'row' | 'column';
      blocks: BandBlock[];
      footer: BandSplitRow | null;
    };

export const ROW_LAYOUT_COLUMNS = 110;
export const CARD_BORDER_ROWS = 2;
export const SVG_ROWS = 2;

export const BRAND = 'paqad';
export const PROOF = 'Proof';
export const MINIMISE = '– Minimise';
export const RESTORE = '+ Restore';
export const CLOSE = '× Close';

export const CONTROL_HOTKEYS: Readonly<Record<BandAction, string>> = {
  minimise: 'm',
  restore: 'r',
  close: 'x',
  show: 's',
  reopen: 'o',
};

export function brandSegment(tone: PaqadTone): BandSegment {
  return { text: BRAND, tone, opens: 'trust', key: 'paqad-brand' };
}

export function controlSegment(action: 'minimise' | 'restore' | 'close'): BandSegment {
  const text = action === 'minimise' ? MINIMISE : action === 'restore' ? RESTORE : CLOSE;
  return { text, action, hotkey: CONTROL_HOTKEYS[action], key: `paqad-${action}`, dim: true };
}

export function flagChip(flags: number): BandSegment | null {
  if (flags <= 0) return null;
  return {
    text: `${flags} flag${flags === 1 ? '' : 's'}`,
    tone: 'warn',
    opens: 'trust',
    key: 'paqad-flags',
  };
}

export function headerRow(header: ShellHeader, idle: boolean): BandSplitRow {
  const left: BandRow = [brandSegment(header.tone)];
  if (header.chip) left.push({ text: ` ${header.chip}`, dim: true });
  left.push({ text: `  ${header.headline}`, tone: header.tone });
  const right: BandRow = [];
  if (!idle) {
    if (header.verdict) right.push({ text: header.verdict.word, tone: header.verdict.tone }, gap());
    const flags = flagChip(header.flags);
    if (flags) right.push(flags, gap());
    if (header.lane) right.push({ text: `${header.lane} lane`, dim: true }, gap());
    if (header.tokens) {
      right.push({ text: header.tokens, dim: true, opens: 'cost', key: 'paqad-tokens' }, gap());
    }
    right.push({ text: PROOF, opens: 'trust', key: 'paqad-proof' }, gap());
  }
  right.push(controlSegment('minimise'), gap(), controlSegment('close'));
  return { left, right };
}

function gap(): BandSegment {
  return { text: '  ' };
}

export function blockRows(block: BandBlock): number {
  return 1 + (block.svg ? SVG_ROWS : block.cells.length > 0 ? 2 : 0) + (block.note ? 1 : 0);
}

export function cardRows(
  blocks: readonly BandBlock[],
  direction: 'row' | 'column',
  footer: boolean,
): number {
  const body =
    direction === 'row'
      ? Math.max(0, ...blocks.map(blockRows))
      : blocks.reduce((sum, block) => sum + blockRows(block), 0);
  return CARD_BORDER_ROWS + 1 + body + (footer ? 1 : 0);
}

export interface ShellSize {
  columns: number;
  maxRows: number;
}

export function layoutShell(
  header: ShellHeader,
  body: BandBody | null,
  size: ShellSize,
  minimisedLine: BandRow,
): BandLayout {
  const maxRows = Math.max(1, Math.floor(size.maxRows));
  if (body === null) {
    if (maxRows < CARD_BORDER_ROWS + 1) return { kind: 'line', row: minimisedLine };
    return {
      kind: 'card',
      tone: header.tone,
      header: headerRow(header, true),
      direction: 'column',
      blocks: [],
      footer: null,
    };
  }
  const direction = size.columns >= ROW_LAYOUT_COLUMNS ? 'row' : 'column';
  let footer = direction === 'row' ? body.footer : null;
  if (footer && cardRows(body.blocks, direction, true) > maxRows) footer = null;
  if (cardRows(body.blocks, direction, footer !== null) > maxRows) {
    return { kind: 'line', row: minimisedLine };
  }
  return {
    kind: 'card',
    tone: header.tone,
    header: headerRow(header, false),
    direction,
    blocks: body.blocks,
    footer,
  };
}
