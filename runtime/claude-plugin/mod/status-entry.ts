import { formatStopwatch, formatTokens, formatUsd } from './cost';
import type { BandRow } from './shell';
import type { PaqadHudSnapshot, PaqadWorkflow } from './types';

export const WORKFLOW_WORDS: Readonly<Record<string, string>> = {
  'project-question': 'question',
  discovery: 'discovery',
  'codebase-health': 'codebase health',
  pentest: 'pentest',
  'design-test': 'design test',
  'site-map': 'site map',
  'documentation-update': 'docs',
  'module-documentation': 'module docs',
  'root-cause-analysis': 'root-cause analysis',
  'rules-analyze': 'rules analysis',
};

export const NO_WORKFLOW = 'no-workflow';
export const FEATURE_ROUTE = 'feature-development';

export function workflowWords(name: string): string {
  return WORKFLOW_WORDS[name] ?? name.replace(/-/g, ' ');
}

export function statusEntryRoute(snapshot: PaqadHudSnapshot | null): string | null {
  const route = snapshot?.route ?? null;
  if (route === null || route === NO_WORKFLOW || route === FEATURE_ROUTE) return null;
  return route;
}

export function workflowCost(workflow: PaqadWorkflow | null): string | null {
  if (!workflow || workflow.tokens === null) return null;
  const tokens = `${formatTokens(workflow.tokens)} tokens`;
  return workflow.usd === null ? tokens : `${tokens} · ~${formatUsd(workflow.usd)}`;
}

export function statusEntryLine(
  route: string,
  workflow: PaqadWorkflow | null,
  runningMs: number | null,
): string {
  const parts = ['paqad', workflowWords(route)];
  if (runningMs !== null) parts.push(`running ${formatStopwatch(runningMs)}`);
  parts.push(workflowCost(workflow) ?? 'counting');
  return parts.join(' · ');
}

export function statusEntryRow(
  snapshot: PaqadHudSnapshot,
  route: string,
  now: number,
  turnStartedAt: number | null,
): BandRow {
  const workflow = snapshot.workflow?.name === route ? snapshot.workflow : null;
  const runningMs = turnStartedAt === null ? null : Math.max(0, now - turnStartedAt);
  return [
    {
      text: statusEntryLine(route, workflow, runningMs),
      opens: 'cost',
      key: 'paqad-status-entry',
    },
  ];
}

export function workflowCostLines(snapshot: PaqadHudSnapshot, route: string): string[] {
  const workflow = snapshot.workflow?.name === route ? snapshot.workflow : null;
  const words = workflowWords(route);
  const heading = `${words[0]!.toUpperCase()}${words.slice(1)}`;
  if (!workflow || workflow.tokens === null) {
    return [heading, 'Cost: counting. paqad reads it from the transcript at the end of each turn.'];
  }
  const money =
    workflow.usd === null
      ? 'no money figure, since no model it used is in the price table'
      : `~${formatUsd(workflow.usd)} estimate at API prices`;
  const lines = [
    heading,
    `Cost: ${formatTokens(workflow.tokens)} tokens, ${money}.`,
    workflow.started_at
      ? `Counted from when this workflow started in this session, ${workflow.started_at}, this workflow only.`
      : 'Counted from when this workflow started in this session, this workflow only.',
  ];
  if (workflow.unpriced.length > 0) {
    lines.push(
      `No price for ${workflow.unpriced.join(', ')}: its tokens are in the total, its money is not.`,
    );
  }
  return lines;
}
