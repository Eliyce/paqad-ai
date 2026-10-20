import { costLines } from './cost';
import {
  buildBandView,
  flagPill,
  headlineAfterState,
  stageLabel,
  stageSegments,
  type BandView,
} from './model';
import { linesText, recordLines, shipsLines, trustLines } from './tabs';
import type { PaqadFindingsScan, PaqadHudSnapshot, PaqadStandDown } from './types';

export const COMMAND_NAME = 'paqad';
export const SUBCOMMANDS = [
  'status',
  'decisions',
  'rules',
  'receipt',
  'cost',
  'trust',
  'ships',
  'record',
] as const;

export interface CommandInput {
  args: string;
  standDown: PaqadStandDown | null;
  snapshot: PaqadHudSnapshot | null;
  receipt: string | null;
  now: number;
}

const HELP =
  'Try /paqad status, /paqad decisions, /paqad rules, /paqad receipt, /paqad cost, /paqad trust, /paqad ships or /paqad record.';

const STAND_DOWN_WORDS: Record<PaqadStandDown, string> = {
  'view-off': 'the paqad HUD is turned off in the plugin settings',
  'not-onboarded': 'this project was never onboarded',
  remote: 'this session runs in the cloud',
  disabled: 'paqad is turned off for this project',
  'old-engine': 'this Claude Code is older than 2.1.301',
};

export function notActiveText(reason: PaqadStandDown): string {
  return `paqad is not active here: ${STAND_DOWN_WORDS[reason]}.`;
}

const NO_RECORD = `Not yet. paqad has no record for this session.`;

function stageLine(view: BandView): string {
  return `Stage: ${view.stages
    .map((segment) =>
      segment.state === 'running' && view.clock
        ? `${segment.label} running ${view.clock}`
        : `${segment.label} ${segment.state}`,
    )
    .join(', ')}.`;
}

function shipLine(view: BandView): string {
  return `Ship: ${view.ship.map((step) => `${step.label} ${step.word}`).join(', ')}.`;
}

function stateLine(view: BandView): string {
  const pill = flagPill(view.flags);
  const rest = headlineAfterState(view);
  return `${view.state}${pill ? ` (${pill})` : ''}.${rest ? ` ${rest}` : ''}`;
}

function overview(snapshot: PaqadHudSnapshot, now: number): string {
  const view = buildBandView(snapshot, now);
  return [stateLine(view), stageLine(view), shipLine(view), view.cost, HELP].join('\n');
}

function status(snapshot: PaqadHudSnapshot, now: number): string {
  const view = buildBandView(snapshot, now);
  const lines = [stateLine(view)];
  const change = snapshot.change;
  if (snapshot.active && change) {
    const name = [change.issue ? `#${change.issue}` : null, change.title].filter(Boolean).join(' ');
    lines.push(`Change: ${name || change.id || 'untitled'}.`);
    if (change.branch) lines.push(`Branch: ${change.branch}.`);
  }
  if (snapshot.lane) {
    lines.push(`Lane: ${snapshot.lane}${snapshot.lane_reason ? `, ${snapshot.lane_reason}` : ''}.`);
  }
  if (snapshot.paused.length > 0) {
    lines.push(
      `Paused: ${snapshot.paused.length} change${snapshot.paused.length === 1 ? '' : 's'}.`,
    );
  }
  for (const segment of stageSegments(snapshot)) {
    const clock = segment.state === 'running' && view.clock ? ` ${view.clock}` : '';
    lines.push(`  ${segment.label}: ${segment.state}${clock}`);
  }
  for (const flag of snapshot.flags) lines.push(`Flag: ${flag.text}`);
  if (snapshot.verdict) {
    lines.push(`Verdict: ${snapshot.verdict.word}.`);
    for (const reason of snapshot.verdict.reasons) lines.push(`  ${reason}`);
  }
  return lines.join('\n');
}

function decisions(snapshot: PaqadHudSnapshot): string {
  const { pending, resolved } = snapshot.decisions;
  const done = `${resolved} resolved.`;
  if (pending.length === 0) return `No decision is waiting. ${done}`;
  return [
    `${pending.length} decision${pending.length === 1 ? '' : 's'} waiting. ${done}`,
    ...pending.map((d) => `  ${d.id} (${d.category}): ${d.question || 'no question recorded'}`),
  ].join('\n');
}

function scanLine(label: string, scan: PaqadFindingsScan | undefined): string {
  if (!scan || scan.status === 'did not run') return `${label}: did not run.`;
  if (scan.status === 'clean') return `${label}: none open.`;
  return `${label}: ${scan.total ?? 0} open${scan.blocking ? ', blocking' : ''}.`;
}

function rules(snapshot: PaqadHudSnapshot): string {
  if (!snapshot.active) return 'No change is in progress, so no rules are loaded for one.';
  const lines = [
    snapshot.rules.recorded
      ? `Rules loaded for this change: ${snapshot.rules.applicable ?? 0} apply${
          snapshot.rules.loaded_at ? `, loaded ${snapshot.rules.loaded_at}` : ''
        }.`
      : 'The rules for this change are not loaded yet.',
    scanLine('Rule findings', snapshot.findings?.rules),
    scanLine('Near-copies', snapshot.findings?.near_copies),
  ];
  return lines.join('\n');
}

function cost(snapshot: PaqadHudSnapshot): string {
  if (!snapshot.active) return 'No change is in progress, so there is no cost to show.';
  if (!snapshot.cost) {
    return 'Cost: not yet. paqad counts it from the transcripts at the end of each turn.';
  }
  return costLines(snapshot.cost, { lane: snapshot.lane, stageLabel }).join('\n');
}

function receipt(text: string | null): string {
  const body = text?.trim();
  return body ? body : 'No receipt yet. paqad writes one at the end of each turn.';
}

export function runPaqadCommand(input: CommandInput): { text: string } {
  if (input.standDown) return { text: notActiveText(input.standDown) };
  const sub = input.args.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  if (sub === 'receipt') return { text: receipt(input.receipt) };
  if (sub !== '' && !(SUBCOMMANDS as readonly string[]).includes(sub)) {
    return { text: `There is no /paqad ${sub}. ${HELP}` };
  }
  const snapshot = input.snapshot;
  if (!snapshot) return { text: `${NO_RECORD} ${HELP}` };
  if (sub === 'status') return { text: status(snapshot, input.now) };
  if (sub === 'decisions') return { text: decisions(snapshot) };
  if (sub === 'rules') return { text: rules(snapshot) };
  if (sub === 'cost') return { text: cost(snapshot) };
  if (sub === 'trust') return { text: linesText(trustLines(snapshot)) };
  if (sub === 'ships') return { text: linesText(shipsLines(snapshot)) };
  if (sub === 'record') return { text: linesText(recordLines(snapshot)) };
  return { text: overview(snapshot, input.now) };
}
