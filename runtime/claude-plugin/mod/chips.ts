import { fixProofClaims, stageLabel } from './model';
import type { TableLine, TableSegment } from './table';
import type { PaqadHudSnapshot, PaqadTone } from './types';

export const CHIP_VERBS = [
  'stage',
  'plan',
  'spec',
  'review',
  'checks',
  'fix',
  'rules',
  'debt',
  'decision',
] as const;

export type ChipVerb = (typeof CHIP_VERBS)[number];

export interface PaqadCall {
  verb: ChipVerb;
  sub: string | null;
  arg: string | null;
}

export type ChipState = 'recorded' | 'running' | 'failed' | 'blocked';

export interface Chip {
  label: string;
  state: ChipState;
}

export interface ChipRow {
  isRunning?: boolean;
  isErrored?: boolean;
  output?: unknown;
}

const CALL = new RegExp(
  `(?:^|[\\s;&|(])(?:\\S*/)?paqad-ai\\s+(${CHIP_VERBS.join('|')})\\b(?:\\s+([a-z][\\w-]*))?(?:\\s+([a-z][\\w-]*))?`,
);

export function paqadCall(tool: unknown, input: unknown): PaqadCall | null {
  if (tool !== 'Bash') return null;
  const command = (input as { command?: unknown } | null)?.command;
  if (typeof command !== 'string') return null;
  const match = command.match(CALL);
  if (!match) return null;
  return { verb: match[1] as ChipVerb, sub: match[2] ?? null, arg: match[3] ?? null };
}

const SUB_LABELS: Record<string, string> = {
  'plan compile': 'Plan compiled',
  'spec freeze': 'Spec frozen',
  'review record': 'Review recorded',
  'checks run': 'Checks run',
  'rules load': 'Rules loaded',
  'rules override': 'Rule override',
  'debt add': 'Tech debt added',
  'debt close': 'Tech debt closed',
  'debt promote': 'Tech debt promoted',
  'decision create': 'Decision opened',
  'decision resolve': 'Decision resolved',
};

export function chipLabel(call: PaqadCall): string {
  if (call.verb === 'stage' && call.arg && (call.sub === 'start' || call.sub === 'end')) {
    return `${stageLabel(call.arg)} ${call.sub === 'start' ? 'started' : 'ended'}`;
  }
  if (call.verb === 'fix' && call.sub === 'prove') {
    return `Fix proof${call.arg ? ` ${call.arg}` : ''}`;
  }
  const key = `${call.verb}${call.sub ? ` ${call.sub}` : ''}`;
  return SUB_LABELS[key] ?? `paqad ${key}`;
}

function present(snapshot: PaqadHudSnapshot, ...files: string[]): boolean {
  return files.some((file) => snapshot.bundle_files.includes(file));
}

export function inBundle(call: PaqadCall, snapshot: PaqadHudSnapshot): boolean {
  switch (call.verb) {
    case 'stage':
      return snapshot.stages.some((stage) => stage.stage === call.arg && stage.state !== 'missing');
    case 'plan':
      return present(snapshot, 'plan.json');
    case 'spec':
      return present(snapshot, 'spec.md', 'specification.json');
    case 'review':
      return present(snapshot, 'review.json');
    case 'checks':
      return present(snapshot, 'checks.json');
    case 'fix':
      return present(snapshot, 'fix-proof.json') || fixProofClaims(snapshot).length > 0;
    case 'rules':
      return call.sub === 'override'
        ? present(snapshot, 'rule-overrides.jsonl')
        : snapshot.rules.recorded;
    case 'debt':
      return present(snapshot, 'tech-debt.json');
    case 'decision':
      return snapshot.decisions.pending.length > 0 || snapshot.decisions.resolved > 0;
  }
}

function outputText(output: unknown): string {
  if (typeof output === 'string') return output;
  const record = output as { stdout?: unknown; stderr?: unknown } | null;
  return [record?.stdout, record?.stderr].filter((part) => typeof part === 'string').join('\n');
}

export function chipFor(
  call: PaqadCall,
  row: ChipRow,
  snapshot: PaqadHudSnapshot | null,
): Chip | null {
  if (!snapshot?.active) return null;
  const label = chipLabel(call);
  if (row.isRunning) return { label, state: 'running' };
  if (row.isErrored) {
    return {
      label,
      state: /\bblock(ed|s)?\b/i.test(outputText(row.output)) ? 'blocked' : 'failed',
    };
  }
  return inBundle(call, snapshot) ? { label, state: 'recorded' } : null;
}

const CHIP_LOOK: Record<ChipState, { mark: string; tone: PaqadTone }> = {
  recorded: { mark: '✓', tone: 'good' },
  running: { mark: '▸', tone: 'working' },
  failed: { mark: '✗', tone: 'bad' },
  blocked: { mark: '!', tone: 'warn' },
};

export function chipSegments(chip: Chip): TableSegment[] {
  const look = CHIP_LOOK[chip.state];
  return [
    { text: `${look.mark} ${chip.label} `, tone: look.tone },
    { text: chip.state, tone: look.tone },
  ];
}

export function chipLine(chips: readonly Chip[]): TableLine {
  const line: TableLine = [{ text: 'paqad ', dim: true }];
  chips.forEach((chip, index) => {
    if (index > 0) line.push({ text: '  ' });
    line.push(...chipSegments(chip));
  });
  return line;
}
