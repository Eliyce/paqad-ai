import { slash } from './command-name';
import { formatTokens } from './cost';
import { stageStatus, STAGE_MARK, tableStatus } from './instruments';
import { stageSegments, type BandView } from './model';
import { shipRail } from './ship';
import { BRAND, CONTROL_HOTKEYS, controlSegment, flagChip, type BandRow } from './shell';
import { showsTable } from './table';
import type { PaqadHudSnapshot, PaqadTone } from './types';

export const MINIMISED_KEY = 'band.minimised';
export const HIDDEN_KEY_PREFIX = 'band.hidden:';
export const STORE_KEY_LIMIT = 256;

export const CLOSE_HEADER = 'Close band?';
export const CLOSE_FOR_NOW = 'Close for now';
export const CLOSE_FOR_NOW_MEANS = 'Comes back in your next session';
export const HIDE_ALWAYS = 'Hide always';
export const NEEDS_YOU = 'Needs you';
export const SHOWN_AGAIN = 'The paqad band is back.';

export function hideAlwaysMeans(surface: 'terminal' | 'desktop' = 'terminal'): string {
  return surface === 'desktop'
    ? `Stays hidden until you press Show or run ${slash('show')}`
    : `Stays hidden until you click paqad under the prompt or run ${slash('show')}`;
}

export function closeQuestion(): string {
  return `Close the paqad band? ${CLOSE_FOR_NOW}: ${CLOSE_FOR_NOW_MEANS}. ${HIDE_ALWAYS}: ${hideAlwaysMeans()}.`;
}

export function closedHint(): string {
  return `Closed for this session · ${slash('show')}`;
}

export function hiddenHint(): string {
  return `Hidden always · ${slash('show')}`;
}

export function hiddenReply(): string {
  return `The paqad band is hidden. Run ${slash('show')} to bring it back.`;
}

export function hiddenKey(root: string): string {
  const key = `${HIDDEN_KEY_PREFIX}${root}`;
  return key.length <= STORE_KEY_LIMIT
    ? key
    : `${HIDDEN_KEY_PREFIX}…${root.slice(root.length - (STORE_KEY_LIMIT - HIDDEN_KEY_PREFIX.length - 1))}`;
}

export interface BandVisibility {
  minimised: boolean;
  closed: boolean;
  hidden: boolean;
}

export type VisibilityMode = 'band' | 'minimised' | 'closed' | 'hidden';

export function readBandVisibility(
  stored: { minimised: unknown; hidden: unknown },
  closed: boolean | null | undefined,
): BandVisibility {
  return {
    minimised: stored.minimised === true,
    closed: closed === true,
    hidden: stored.hidden === true,
  };
}

export function visibilityMode(visibility: BandVisibility): VisibilityMode {
  if (visibility.hidden) return 'hidden';
  if (visibility.closed) return 'closed';
  return visibility.minimised ? 'minimised' : 'band';
}

export function needsYouLine(): BandRow {
  return [
    {
      text: `${BRAND} · ${NEEDS_YOU} ▸`,
      tone: 'needs-you',
      action: 'show',
      hotkey: CONTROL_HOTKEYS.show,
      key: 'paqad-needs-you',
    },
  ];
}

export function closedLine(mode: 'closed' | 'hidden', view: BandView): BandRow {
  return [
    {
      text: `${BRAND} · ${view.state} ▸`,
      action: 'reopen',
      hotkey: CONTROL_HOTKEYS.reopen,
      key: 'paqad-reopen',
    },
    { text: `  ${mode === 'closed' ? closedHint() : hiddenHint()}`, dim: true },
  ];
}

function stageBar(snapshot: PaqadHudSnapshot): string {
  return stageSegments(snapshot)
    .map((segment) => STAGE_MARK[segment.state].mark)
    .join('');
}

type Field = { key: 'tokens' | 'ship' | 'table' | 'bar' | 'flags'; segments: BandRow };

export const IDLE_WORDS = 'Getting ready';

export function minimisedLine(
  snapshot: PaqadHudSnapshot | null,
  view: BandView,
  columns: number,
  now: number,
): BandRow {
  const tone: PaqadTone = view.tone;
  const head: BandRow = [{ text: BRAND, tone, opens: 'trust', key: 'paqad-brand' }];
  const change = snapshot?.active ? snapshot.change : null;
  const chip = change?.issue
    ? /^\d+$/.test(change.issue)
      ? `#${change.issue}`
      : change.issue
    : (change?.id?.slice(-6) ?? null);
  if (chip) head.push({ text: ` ${chip}`, dim: true });
  head.push({ text: snapshot?.active ? ` ${view.state}` : ` · ${IDLE_WORDS}`, tone });
  const fields: Field[] = [];
  if (snapshot?.active) {
    fields.push({
      key: 'bar',
      segments: [{ text: ` ${stageBar(snapshot)} ${stageStatus(snapshot, now)}` }],
    });
    if (showsTable(snapshot) && !snapshot.table.skipped) {
      fields.push({
        key: 'table',
        segments: [{ text: ` High Table ${tableStatus(snapshot, snapshot.table)}`, dim: true }],
      });
    }
    const status = shipRail(snapshot).status;
    if (status) fields.push({ key: 'ship', segments: [{ text: ` ${status}`, dim: true }] });
  }
  const flags = flagChip(view.flags);
  if (flags) fields.push({ key: 'flags', segments: [{ text: ' ' }, flags] });
  if (snapshot?.active && snapshot.cost) {
    fields.push({
      key: 'tokens',
      segments: [{ text: ` ${formatTokens(snapshot.cost.tokens.total)} tokens`, dim: true }],
    });
  }
  const tail: BandRow = [
    { text: ' ' },
    controlSegment('restore'),
    { text: ' ' },
    controlSegment('close'),
  ];
  const width = (row: BandRow) => row.reduce((sum, segment) => sum + [...segment.text].length, 0);
  const lineOf = (kept: Field[]) => [...head, ...kept.flatMap((field) => field.segments), ...tail];
  let kept = fields;
  for (const drop of ['tokens', 'ship', 'table', 'bar'] as const) {
    if (width(lineOf(kept)) <= columns) break;
    kept = kept.filter((field) => field.key !== drop);
  }
  return lineOf(kept);
}
