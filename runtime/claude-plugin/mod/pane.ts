// The paqad pane (issue #639, Part 23): one pane, a row of tabs, and the selected tab's text.
//
// Pure: no Claude Code import, so vitest tests it without the host. `register.tsx` draws the tabs
// as Buttons and the lines as Text on the terminal and on Desktop alike. A tab is one entry in
// PANE_TABS plus one case in `tabLines`, so a later part adds its tab without touching the rest.

import { costLines } from './cost';
import { stageLabel } from './model';
import type { PaqadHudSnapshot, PaqadPaneTab } from './types';

/** The pane's id for `$.ui.open` and its `ui.render` matcher. */
export const PANE_ID = 'paqad';
export const PANE_TITLE = 'paqad';

/** The tabs, in the order the tab row draws them. */
export const PANE_TABS: ReadonlyArray<{ id: PaqadPaneTab; label: string }> = [
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

export interface PaneTabView {
  id: PaqadPaneTab;
  key: string;
  label: string;
  selected: boolean;
}

export interface PaneView {
  tabs: PaneTabView[];
  lines: string[];
}

const NO_RECORD = 'Not yet. paqad has no record for this session.';

function tabLines(snapshot: PaqadHudSnapshot | null, tab: PaqadPaneTab): string[] {
  switch (tab) {
    case 'cost':
      if (!snapshot) return [NO_RECORD];
      if (!snapshot.active) return ['No change is in progress, so there is no cost to show.'];
      if (!snapshot.cost) {
        return ['Cost: not yet. paqad counts it from the transcripts at the end of each turn.'];
      }
      return costLines(snapshot.cost, { lane: snapshot.lane, stageLabel });
  }
}

/** What the pane draws: the tab row (the selected tab marked) and the tab's lines. */
export function buildPaneView(snapshot: PaqadHudSnapshot | null, tab: PaqadPaneTab): PaneView {
  const selected = isPaneTab(tab) ? tab : DEFAULT_PANE_TAB;
  return {
    tabs: PANE_TABS.map((entry) => ({
      id: entry.id,
      key: tabKey(entry.id),
      label: entry.label,
      selected: entry.id === selected,
    })),
    lines: tabLines(snapshot, selected),
  };
}
