import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { FeatureDevelopmentStageName } from '@/core/types/feature-development-policy.js';
import { readChangeConstants, readFeatureRecord } from '@/feature-evidence/feature-record.js';
import { featureFilePath, type FeatureBundleFile } from '@/feature-evidence/paths.js';
import { currentFeature, readFeatureStageUnit } from '@/feature-evidence/stage-ledger.js';
import { loadFeatureDevelopmentPolicy } from '@/pipeline/feature-development-policy.js';
import type { SessionLedgerRow } from '@/session-ledger/ledger.js';

import { stageCommandLines } from './stage-brief.js';
import { stageReportOptions, stageStartRefusal } from './stage-handback.js';

export const STAGE_CONTENT_MAX_CHARS = 27_000;

export const STAGE_CONTENT_TRUNCATED_LINE = `truncated at ${STAGE_CONTENT_MAX_CHARS.toLocaleString('en-US')} characters; read the file for the rest`;

const CONTENT_PILLARS: Readonly<Record<string, readonly FeatureBundleFile[]>> = {
  planning: [],
  specification: ['plan'],
  development: ['plan', 'specification'],
  review: ['specification'],
  checks: ['review'],
  documentation_sync: ['review'],
};

const MIN_CUT_STEP = 1024;

export interface CommandRun {
  ok: boolean;
  stdout: string;
  stderr: string;
}

export type CommandRunner = (args: readonly string[]) => CommandRun;

export function cliCommandRunner(projectRoot: string): CommandRunner {
  const entry = process.argv[1] ?? '';
  return (args) => {
    const run = spawnSync(process.execPath, [entry, ...args], {
      cwd: projectRoot,
      env: process.env,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    return { ok: run.status === 0, stdout: run.stdout ?? '', stderr: run.stderr ?? '' };
  };
}

export interface StageContent {
  request: string;
  pillars: Record<string, string>;
  review_digest?: string;
}

export interface StageBeginOutput {
  stage: string;
  started: boolean;
  rules_loaded: boolean;
  pillars: string[];
  paths: Record<string, string>;
  instructions: string[];
  commands: string[];
  content: StageContent;
  truncated: string[];
  checks_plan?: unknown;
  failed_step?: string;
  error?: string;
}

export interface StageBeginResult {
  exitCode: 0 | 1;
  output: StageBeginOutput;
}

export interface StageBeginInput {
  projectRoot: string;
  sessionId: string;
  stage: string;
  agent?: string;
  agentId?: string | null;
  run?: CommandRunner;
}

function readIfPresent(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function lastJsonLine(text: string): Record<string, unknown> | null {
  const line = text.trim().split('\n').at(-1)!;
  try {
    return JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function hasOpenStart(rows: readonly SessionLedgerRow[], stage: string): boolean {
  let open = false;
  for (const row of rows) {
    if (row.stage !== stage) continue;
    if (row.kind === 'stage_start') open = true;
    if (row.kind === 'stage_end') open = false;
  }
  return open;
}

interface ContentSlot {
  name: string;
  full: string;
  kept: number;
}

function renderSlot(slot: ContentSlot): string {
  return slot.kept >= slot.full.length
    ? slot.full
    : `${slot.full.slice(0, slot.kept)}\n${STAGE_CONTENT_TRUNCATED_LINE}`;
}

function contentFrom(slots: readonly ContentSlot[]): StageContent {
  const pillars: Record<string, string> = {};
  let request = '';
  let digest: string | undefined;
  for (const slot of slots) {
    if (slot.name === 'request') request = renderSlot(slot);
    else if (slot.name === 'review_digest') digest = renderSlot(slot);
    else pillars[slot.name] = renderSlot(slot);
  }
  return { request, pillars, ...(digest === undefined ? {} : { review_digest: digest }) };
}

export function fitToCeiling(
  slots: ContentSlot[],
  sizeOf: (content: StageContent) => number,
  ceiling: number,
): StageContent {
  let content = contentFrom(slots);
  while (sizeOf(content) > ceiling) {
    const ordered = [...slots].sort((a, b) => b.kept - a.kept);
    const longest = ordered[0];
    if (longest === undefined || longest.kept === 0) break;
    const gap = longest.kept - (ordered[1]?.kept ?? 0);
    const excess = sizeOf(content) - ceiling;
    longest.kept = Math.max(0, longest.kept - Math.max(Math.min(excess, gap), MIN_CUT_STEP));
    content = contentFrom(slots);
  }
  return content;
}

function contentSlots(
  projectRoot: string,
  dirName: string,
  stage: string,
  digestPath: string | null,
): { slots: ContentSlot[]; pillarPaths: string[] } {
  const slots: ContentSlot[] = [];
  const add = (name: string, full: string) => slots.push({ name, full, kept: full.length });
  const title = readFeatureRecord(projectRoot, dirName)?.title ?? '';
  const body = readIfPresent(join(projectRoot, featureFilePath(dirName, 'request'))) ?? '';
  add('request', [title, body].filter((part) => part !== '').join('\n\n'));
  const pillarPaths: string[] = [];
  for (const pillar of CONTENT_PILLARS[stage] ?? []) {
    const path = featureFilePath(dirName, pillar);
    const text = readIfPresent(join(projectRoot, path));
    if (text === null) continue;
    pillarPaths.push(path);
    add(pillar, text);
  }
  if (digestPath !== null) {
    const digest = readIfPresent(join(projectRoot, digestPath)) ?? readIfPresent(digestPath);
    if (digest !== null) add('review_digest', digest);
  }
  return { slots, pillarPaths };
}

export function stageContentMarkdown(
  projectRoot: string,
  dirName: string,
  stage: string,
  ceiling: number,
): string {
  const { slots } = contentSlots(projectRoot, dirName, stage, null);
  const render = (content: StageContent): string =>
    [
      '## Request',
      '',
      content.request,
      ...Object.entries(content.pillars).flatMap(([name, text]) => [
        '',
        `## Previous pillar: ${name}`,
        '',
        text,
      ]),
    ].join('\n');
  return render(fitToCeiling(slots, (content) => render(content).length, ceiling));
}

function emptyOutput(input: StageBeginInput): StageBeginOutput {
  return {
    stage: input.stage,
    started: false,
    rules_loaded: false,
    pillars: [],
    paths: {},
    instructions: [],
    commands: [],
    content: { request: '', pillars: {} },
    truncated: [],
  };
}

function failed(input: StageBeginInput, step: string, error: string): StageBeginResult {
  return { exitCode: 1, output: { ...emptyOutput(input), failed_step: step, error } };
}

function sessionArgs(input: StageBeginInput): string[] {
  return ['--project-root', input.projectRoot, '--session', input.sessionId];
}

export function runStageBegin(input: StageBeginInput): StageBeginResult {
  const { projectRoot, sessionId, stage } = input;
  const run = input.run ?? cliCommandRunner(projectRoot);
  const before = currentFeature(projectRoot, sessionId);
  const beforeRows = before === null ? [] : readFeatureStageUnit(projectRoot, before);
  if (before !== null) {
    const lane = readChangeConstants(projectRoot, before, beforeRows).lane;
    const refusal = stageStartRefusal(
      beforeRows,
      stage,
      lane,
      stageReportOptions(projectRoot, before),
    );
    if (refusal) return failed(input, 'stage start', refusal.message);
  }
  const started = !hasOpenStart(beforeRows, stage);
  if (started) {
    const agent = input.agent ? ['--agent', input.agent] : [];
    const start = run(['stage', 'start', stage, ...agent, ...sessionArgs(input)]);
    if (!start.ok) return failed(input, 'stage start', start.stderr.trim());
  }
  const dirName = currentFeature(projectRoot, sessionId);
  if (dirName === null) {
    return failed(input, 'stage start', `no active change for session ${sessionId}`);
  }
  const rulesPath = featureFilePath(dirName, 'rulesLoaded');
  let rulesLoaded = false;
  if (stage === 'development') {
    const rules = run(['rules', 'load', '--silent', ...sessionArgs(input)]);
    if (!rules.ok) return failed(input, 'rules load', rules.stderr.trim());
    rulesLoaded = existsSync(join(projectRoot, rulesPath));
  }
  let digestPath: string | null = null;
  if (stage === 'review') {
    const digest = run(['review', 'digest', ...sessionArgs(input)]);
    if (!digest.ok) return failed(input, 'review digest', digest.stderr.trim());
    const path = lastJsonLine(digest.stdout)?.path;
    digestPath = typeof path === 'string' ? path : null;
  }
  let checksPlan: unknown;
  if (stage === 'checks') {
    const plan = run(['checks', 'plan', '--json', '--project-root', projectRoot]);
    if (!plan.ok) return failed(input, 'checks plan', plan.stderr.trim());
    checksPlan = lastJsonLine(plan.stdout) ?? plan.stdout.trim();
  }
  const policy = loadFeatureDevelopmentPolicy(projectRoot).policy;
  const { slots, pillarPaths } = contentSlots(projectRoot, dirName, stage, digestPath);
  const base = {
    stage,
    started,
    rules_loaded: rulesLoaded,
    pillars: pillarPaths,
    paths: {
      bundle: featureFilePath(dirName, 'stageEvidence').replace(/\/[^/]+$/u, ''),
      request: featureFilePath(dirName, 'request'),
      ...(digestPath === null ? {} : { review_digest: digestPath }),
      ...(rulesLoaded ? { rules_loaded: rulesPath } : {}),
    },
    instructions: policy.stages[stage as FeatureDevelopmentStageName].instructions,
    commands: stageCommandLines(stage, sessionId, input.agentId ?? null),
    ...(checksPlan === undefined ? {} : { checks_plan: checksPlan }),
  };
  const sizeOf = (content: StageContent): number =>
    JSON.stringify({
      ...base,
      content,
      truncated: slots.map((slot) => slot.name),
    }).length;
  const content = fitToCeiling(slots, sizeOf, STAGE_CONTENT_MAX_CHARS);
  return {
    exitCode: 0,
    output: {
      ...base,
      content,
      truncated: slots.filter((slot) => slot.kept < slot.full.length).map((slot) => slot.name),
    },
  };
}
