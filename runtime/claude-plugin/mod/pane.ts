// The paqad pane (issue #639, Parts 23 and 14): one pane, a row of tabs, and the selected tab.
//
// Pure: no Claude Code import, so vitest tests it without the host. `register.tsx` draws the tabs
// as Buttons and the lines as Text on the terminal and on Desktop alike; the High Table tab adds
// the round table (an SVG on Desktop, text on the terminal) and a Button per seat. A tab is one
// entry in PANE_TABS plus one case in `tabLines`, so a later part adds its tab without touching
// the rest.

import { costLines } from './cost';
import { stageLabel } from './model';
import { noTableText, showsTable, SKIPPED_TEXT, tablePaneView } from './table';
import type { TablePaneView } from './table';
import type { PaqadHudSnapshot, PaqadPaneTab } from './types';

/** The pane's id for `$.ui.open` and its `ui.render` matcher. */
export const PANE_ID = 'paqad';
export const PANE_TITLE = 'paqad';

/** The tabs, in the order the tab row draws them. */
export const PANE_TABS: ReadonlyArray<{ id: PaqadPaneTab; label: string }> = [
  { id: 'table', label: 'High Table' },
  { id: 'cost', label: 'Cost' },
];

export const DEFAULT_PANE_TAB: PaqadPaneTab = 'cost';

/** A tab's Button key, stable whatever its label says. */
export function tabKey(tab: PaqadPaneTab): string {
  return `paqad-tab-${tab}`;
}

/** True when `value` names a tab the pane has. */
export function isPaneTab(value: unknown): value is PaqadPaneTab {
  return PANE_TABS.some((tab) => tab.id === value);
}

/**
 * The tab the pane shows. The tab the person picked always wins. Until they pick one, the pane
 * opens on the High Table whenever the change has one (so while seats are writing it is always
 * there), and on Cost otherwise.
 */
export function shownTab(snapshot: PaqadHudSnapshot | null, picked: unknown): PaqadPaneTab {
  if (isPaneTab(picked)) return picked;
  return showsTable(snapshot) ? 'table' : DEFAULT_PANE_TAB;
}

export interface PaneTabView {
  id: PaqadPaneTab;
  key: string;
  label: string;
  selected: boolean;
}

export interface PaneView {
  tabs: PaneTabView[];
  lines: string[];
  /** The High Table tab's drawing, when that tab is shown and the change has a table to draw. */
  table: TablePaneView | null;
}

const NO_RECORD = 'Not yet. paqad has no record for this session.';

function tabLines(snapshot: PaqadHudSnapshot | null, tab: PaqadPaneTab): string[] {
  switch (tab) {
    case 'table':
      if (!showsTable(snapshot)) return [noTableText(snapshot)];
      return snapshot.table.skipped ? [SKIPPED_TEXT] : [];
    case 'cost':
      if (!snapshot) return [NO_RECORD];
      if (!snapshot.active) return ['No change is in progress, so there is no cost to show.'];
      if (!snapshot.cost) {
        return ['Cost: not yet. paqad counts it from the transcripts at the end of each turn.'];
      }
      return costLines(snapshot.cost, { lane: snapshot.lane, stageLabel });
  }
}

export interface PaneOptions {
  /** The High Table seat picked in the pane, by role; `null` shows the first seat. */
  seat?: string | null;
  /** Milliseconds now, for the seats' times. */
  now?: number;
}

/** What the pane draws: the tab row (the shown tab marked) and that tab's content. */
export function buildPaneView(
  snapshot: PaqadHudSnapshot | null,
  picked: PaqadPaneTab | null,
  options: PaneOptions = {},
): PaneView {
  const selected = shownTab(snapshot, picked);
  const table =
    selected === 'table' && showsTable(snapshot) && !snapshot.table.skipped
      ? tablePaneView(snapshot, options.seat ?? null, options.now ?? 0)
      : null;
  return {
    tabs: PANE_TABS.map((entry) => ({
      id: entry.id,
      key: tabKey(entry.id),
      label: entry.label,
      selected: entry.id === selected,
    })),
    lines: tabLines(snapshot, selected),
    table,
  };
}
