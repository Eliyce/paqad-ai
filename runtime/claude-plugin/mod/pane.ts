import { costLines } from './cost';
import { stageLabel } from './model';
import { noTableText, showsTable, SKIPPED_TEXT, tablePaneView } from './table';
import type { TableLine, TablePaneView } from './table';
import { statusEntryRoute, workflowCostLines } from './status-entry';
import { gateRingSvg, recordLines, shipsLines, trustLines } from './tabs';
import type { PaqadHudSnapshot, PaqadPaneTab } from './types';

export const PANE_ID = 'paqad';
export const PANE_TITLE = 'paqad Ledger';
export const PANE_SUBTITLE = 'what happened, with proof';

export const PANE_TABS: ReadonlyArray<{ id: PaqadPaneTab; label: string; short: string }> = [
  { id: 'trust', label: 'Trust', short: 'Trust' },
  { id: 'table', label: 'High Table', short: 'Table' },
  { id: 'ships', label: 'Ships', short: 'Ships' },
  { id: 'record', label: 'Record', short: 'Rec' },
  { id: 'cost', label: 'Cost', short: 'Cost' },
];

export const DEFAULT_PANE_TAB: PaqadPaneTab = 'trust';

export const SHORT_TAB_COLUMNS = 80;

export function tabKey(tab: PaqadPaneTab): string {
  return `paqad-tab-${tab}`;
}

export function isPaneTab(value: unknown): value is PaqadPaneTab {
  return PANE_TABS.some((tab) => tab.id === value);
}

export function shownTab(picked: unknown): PaqadPaneTab {
  return isPaneTab(picked) ? picked : DEFAULT_PANE_TAB;
}

export interface PaneTabView {
  id: PaqadPaneTab;
  key: string;
  label: string;
  selected: boolean;
}

export interface PaneView {
  subtitle: string;
  tabs: PaneTabView[];
  lines: string[];
  rows: TableLine[];
  table: TablePaneView | null;
  svg: { source: string; alt: string } | null;
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
    default:
      return [];
  }
}

function tabRows(snapshot: PaqadHudSnapshot | null, tab: PaqadPaneTab, now: number): TableLine[] {
  switch (tab) {
    case 'trust':
      return trustLines(snapshot);
    case 'ships':
      return shipsLines(snapshot, now);
    case 'record':
      return recordLines(snapshot);
    default:
      return [];
  }
}

export interface PaneOptions {
  seat?: string | null;
  now?: number;
  columns?: number;
}

export function buildPaneView(
  snapshot: PaqadHudSnapshot | null,
  picked: PaqadPaneTab | null,
  options: PaneOptions = {},
): PaneView {
  const entryRoute = statusEntryRoute(snapshot);
  if (snapshot && entryRoute) {
    return {
      subtitle: PANE_SUBTITLE,
      tabs: [],
      lines: workflowCostLines(snapshot, entryRoute),
      rows: [],
      table: null,
      svg: null,
    };
  }
  const selected = shownTab(picked);
  const table =
    selected === 'table' && showsTable(snapshot) && !snapshot.table.skipped
      ? tablePaneView(snapshot, options.seat ?? null, options.now ?? 0)
      : null;
  const short = (options.columns ?? SHORT_TAB_COLUMNS) < SHORT_TAB_COLUMNS;
  const gated = selected === 'trust' && snapshot?.active === true && snapshot.gates.length > 0;
  return {
    subtitle: PANE_SUBTITLE,
    svg: gated ? gateRingSvg(snapshot.gates) : null,
    tabs: PANE_TABS.map((entry) => ({
      id: entry.id,
      key: tabKey(entry.id),
      label: short ? entry.short : entry.label,
      selected: entry.id === selected,
    })),
    lines: tabLines(snapshot, selected),
    rows: tabRows(snapshot, selected, options.now ?? 0),
    table,
  };
}

export const AUTO_OPENED_KEY = 'ledger.autoOpened';
export const AUTO_OPENED_CAP = 50;

export function ledgerKey(snapshot: PaqadHudSnapshot | null): string | null {
  if (!snapshot?.active || !snapshot.scope.qualified) return null;
  return snapshot.change?.dir ?? snapshot.change?.id ?? null;
}

export function readOpenedKeys(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((key): key is string => typeof key === 'string') : [];
}

export function shouldAutoOpenLedger(key: string | null, opened: readonly string[]): boolean {
  return key !== null && !opened.includes(key);
}

export function rememberOpened(key: string, opened: readonly string[]): string[] {
  return [...opened.filter((entry) => entry !== key), key].slice(-AUTO_OPENED_CAP);
}
