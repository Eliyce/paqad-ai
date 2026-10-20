import { describe, expect, it } from 'vitest';

import { parseSnapshot } from '../../../../runtime/claude-plugin/mod/model.ts';
import { buildPaneView } from '../../../../runtime/claude-plugin/mod/pane.ts';
import {
  WORKFLOW_WORDS,
  statusEntryLine,
  statusEntryRoute,
  statusEntryRow,
  workflowCost,
  workflowCostLines,
  workflowWords,
} from '../../../../runtime/claude-plugin/mod/status-entry.ts';
import {
  FULL_ORD_501,
  OTHER_WORKFLOW,
  fileText,
  snapshot,
} from '../../../../runtime/claude-plugin/mod/test/fixtures.ts';

const workflow = (over: Record<string, unknown> = {}) => ({
  name: 'project-question',
  started_at: '2026-10-18T08:50:00.000Z',
  tokens: 84000,
  usd: 0.05,
  unpriced: [],
  ...over,
});
const parse = (raw: Record<string, unknown>) => parseSnapshot(fileText(raw))!;

describe('the status entry for other workflows (FR-44, AC-40)', () => {
  it('reads the workflow in words with its tokens and cost', () => {
    expect(statusEntryLine('project-question', workflow(), null)).toBe(
      'paqad · question · 84K tokens · ~$0.05',
    );
    expect(
      statusEntryLine('codebase-health', workflow({ tokens: 1_240_000, usd: 0.71 }), 42_000),
    ).toBe('paqad · codebase health · running 0:42 · 1.2M tokens · ~$0.71');
    expect(statusEntryLine('pentest', null, null)).toBe('paqad · pentest · counting');
    expect(statusEntryLine('pentest', workflow({ tokens: null }), null)).toBe(
      'paqad · pentest · counting',
    );
    expect(workflowCost(workflow({ usd: null }))).toBe('84K tokens');
    expect(workflowWords('made-up-flow')).toBe('made up flow');
    expect(Object.keys(WORKFLOW_WORDS)).toHaveLength(10);
  });

  it('shows only on another route, never on feature development or no workflow', () => {
    expect(statusEntryRoute(parse(OTHER_WORKFLOW))).toBe('project-question');
    expect(statusEntryRoute(parse(FULL_ORD_501))).toBeNull();
    expect(statusEntryRoute(parse({ ...snapshot(), route: 'no-workflow' }))).toBeNull();
    expect(statusEntryRoute(parse(snapshot()))).toBeNull();
    expect(statusEntryRoute(null)).toBeNull();
  });

  it('is one clickable row that opens the Ledger, ignoring tokens of another workflow', () => {
    const snap = parse({ ...OTHER_WORKFLOW, workflow: workflow({ name: 'pentest' }) });
    expect(statusEntryRow(snap, 'project-question', 10_000, 4_000)).toEqual([
      {
        text: 'paqad · question · running 0:06 · counting',
        opens: 'cost',
        key: 'paqad-status-entry',
      },
    ]);
    expect(statusEntryRow(snap, 'project-question', 1, 5)[0]!.text).toBe(
      'paqad · question · running 0:00 · counting',
    );
  });

  it('opens the Ledger in workflow mode with only the cost block', () => {
    const view = buildPaneView(parse({ ...OTHER_WORKFLOW, workflow: workflow() }), null);
    expect(view.tabs).toEqual([]);
    expect(view.lines).toEqual([
      'Question',
      'Cost: 84K tokens, ~$0.05 estimate at API prices.',
      'Counted from when this workflow started in this session, 2026-10-18T08:50:00.000Z, this workflow only.',
    ]);
    expect(workflowCostLines(parse(OTHER_WORKFLOW), 'project-question')).toEqual([
      'Question',
      'Cost: counting. paqad reads it from the transcript at the end of each turn.',
    ]);
    const odd = parse({
      ...OTHER_WORKFLOW,
      workflow: workflow({ usd: null, started_at: null, unpriced: ['claude-future-9'] }),
    });
    expect(workflowCostLines(odd, 'project-question')).toEqual([
      'Question',
      'Cost: 84K tokens, no money figure, since no model it used is in the price table.',
      'Counted from when this workflow started in this session, this workflow only.',
      'No price for claude-future-9: its tokens are in the total, its money is not.',
    ]);
  });
});
