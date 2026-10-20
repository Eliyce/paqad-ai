import { costLines } from './cost';
import { stageLabel } from './model';
import { noTableText, showsTable, SKIPPED_TEXT, tablePaneView } from './table';
import type { TablePaneView } from './table';
import type { PaqadHudSnapshot, PaqadPaneTab } from './types';

export const PANE_ID = 'paqad';
export const PANE_TITLE = 'paqad';

export const PANE_TABS: ReadonlyArray<{ id: PaqadPaneTab; label: string }> = [
  { id: 'table', label: 'High Table' },
  { id: 'cost', label: 'Cost' },
];

export const DEFAULT_PANE_TAB: PaqadPaneTab = 'cost';

export function tabKey(tab: PaqadPaneTab): string {
  return `paqad-tab-${tab}`;
}

export function isPaneTab(value: unknown): value is PaqadPaneTab {
  return PANE_TABS.some((tab) => tab.id === value);
}

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
  seat?: string | null;
  now?: number;
}

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
