import { readAuthoringConfig } from '../config.js';
import {
  AuthoringRefusal,
  readMode,
  renderGateMarkdown,
  type AuthoringWorkspace,
} from '../workspace.js';
import { stageResult, type StageResult } from './result.js';

export const AGENT_REASONS = [
  'verbose-output',
  'restriction',
  'summarisable',
  'cheaper-model',
  'parallel',
  'recurring-role',
] as const;
export type AgentReason = (typeof AGENT_REASONS)[number];

export const AGENT_REFUSALS = [
  'quick-change',
  'back-and-forth',
  'shared-context',
  'latency',
  'one-off',
  'skill-or-hook',
] as const;
export type AgentRefusal = (typeof AGENT_REFUSALS)[number];

export const AGENT_BASELINE_RUNS = 3;
export const VERBOSE_SHARE_MIN = 0.25;
export const PARALLEL_PIECES_MIN = 3;
export const PARALLEL_FILES_MIN = 10;
export const ROUTINE_PASSES_MIN = 2;

const REFUSAL_LINES: Record<AgentRefusal, string> = {
  'quick-change':
    'This is a quick change. The main conversation does it faster than a fresh agent.',
  'back-and-forth':
    "This needs back-and-forth with you, and agents can't ask questions. It stays in the main conversation.",
  'shared-context':
    'These steps share context, so handing them to an agent loses detail at each hand-off. It stays in one conversation.',
  latency:
    'A fresh agent starts slower than the main conversation, and this step is time-sensitive.',
  'one-off': "This is a one-off, so it doesn't need an agent.",
  'skill-or-hook':
    "A skill (or a hook) does this inline at lower cost. I'll start the Skill Orchestrator instead.",
};

export function agentRefusalLine(kind: AgentRefusal): string {
  return REFUSAL_LINES[kind];
}

export function plannedFileLine(kind: AgentRefusal | 'unbacked', name: string): string {
  if (kind === 'skill-or-hook') {
    return (
      `The planned agent file for ${name} is handed to the Skill Orchestrator: do not write it; ` +
      'run paqad-ai skill justify for the skill instead. No agent folder or workspace was created.'
    );
  }
  return `The planned agent file for ${name} is dropped from the plan: do not write it. No agent folder or workspace was created.`;
}

export interface AgentBaselineRun {
  run: number;
  passed: boolean;
  note: string;
  tokens: number;
  duration_ms: number;
  verbose_tokens_in_main: number;
}

export interface AgentJustifyInput {
  reason?: string;
  refuse?: string;
  taskText?: string;
}

function producerHint(name: string): string {
  return (
    `Run the task ${AGENT_BASELINE_RUNS} times in the main conversation (a general-purpose agent ` +
    'where delegation is natural) in fresh contexts, save each transcript to baseline/run-<n>.md, ' +
    'write baseline/verdicts.json as [{run, passed, note, tokens, duration_ms, ' +
    `verbose_tokens_in_main}], then rerun paqad-ai agent justify ${name}.`
  );
}

const NUMBER_FIELDS = ['run', 'tokens', 'duration_ms', 'verbose_tokens_in_main'] as const;

function missingFields(row: unknown): string[] {
  if (row === null || typeof row !== 'object') return ['run', 'passed', 'note', ...NUMBER_FIELDS];
  const record = row as Record<string, unknown>;
  const missing: string[] = [];
  for (const field of NUMBER_FIELDS) {
    const value = record[field];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) missing.push(field);
  }
  if (typeof record.passed !== 'boolean') missing.push('passed');
  if (typeof record.note !== 'string') missing.push('note');
  return missing;
}

export function readAgentBaseline(workspace: AuthoringWorkspace): AgentBaselineRun[] {
  const rel = 'baseline/verdicts.json';
  const text = workspace.read(rel);
  const hint = producerHint(workspace.name);
  if (text === null) throw new AuthoringRefusal(`${workspace.relPath(rel)} is missing. ${hint}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AuthoringRefusal(`${workspace.relPath(rel)} is not valid JSON. ${hint}`);
  }
  if (!Array.isArray(parsed) || parsed.length !== AGENT_BASELINE_RUNS) {
    throw new AuthoringRefusal(
      `${workspace.relPath(rel)} needs exactly ${AGENT_BASELINE_RUNS} entries. ${hint}`,
    );
  }
  for (const [index, entry] of parsed.entries()) {
    const missing = missingFields(entry);
    if (missing.length > 0) {
      throw new AuthoringRefusal(
        `${workspace.relPath(rel)} entry ${index + 1} is missing ${missing.join(', ')}. ${hint}`,
      );
    }
  }
  for (let run = 1; run <= AGENT_BASELINE_RUNS; run += 1) {
    if (!workspace.exists(`baseline/run-${run}.md`)) {
      throw new AuthoringRefusal(
        `${workspace.relPath(`baseline/run-${run}.md`)} is missing. ${hint}`,
      );
    }
  }
  return parsed as AgentBaselineRun[];
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export function taskSection(taskText: string, heading: string): string[] {
  const lines = taskText.split(/\r?\n/u);
  const start = lines.findIndex(
    (line) => line.trim().toLowerCase() === `## ${heading.toLowerCase()}`,
  );
  if (start === -1) return [];
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,2}\s/u.test(line)) break;
    if (line.trim() !== '') body.push(line.trim());
  }
  return body;
}

function listItems(lines: readonly string[]): string[] {
  return lines.filter((line) => /^([-*]|\d+\.)\s+\S/u.test(line));
}

export interface ReasonBacking {
  backed: boolean;
  evidence: string;
}

function sectionBacking(taskText: string, heading: string, said: string, missing: string) {
  const lines = taskSection(taskText, heading);
  return {
    backed: lines.length > 0,
    evidence: lines.length > 0 ? `${said}: ${lines[0]}` : missing,
  };
}

export function reasonBacking(
  reason: AgentReason,
  runs: readonly AgentBaselineRun[],
  taskText: string,
  reportMaxTokens: number,
): ReasonBacking {
  const tokens = median(runs.map((run) => run.tokens));
  const verbose = median(runs.map((run) => run.verbose_tokens_in_main));
  switch (reason) {
    case 'verbose-output': {
      const share = tokens === 0 ? 0 : verbose / tokens;
      return {
        backed: verbose > 0 && share >= VERBOSE_SHARE_MIN,
        evidence: `median ${verbose} of ${tokens} baseline tokens were verbose output in the main context (${Math.round(share * 100)}%, needs ${VERBOSE_SHARE_MIN * 100}%)`,
      };
    }
    case 'restriction':
      return sectionBacking(
        taskText,
        'Restriction',
        'the task names the restriction',
        'the task file has no ## Restriction section naming the tool or permission restriction',
      );
    case 'summarisable':
      return {
        backed: tokens > reportMaxTokens,
        evidence: `median baseline ${tokens} tokens against a report of at most ${reportMaxTokens} tokens`,
      };
    case 'cheaper-model': {
      const passed = runs.filter((run) => run.passed).length;
      return {
        backed: passed >= ROUTINE_PASSES_MIN,
        evidence: `the main conversation passed ${passed} of ${runs.length} runs (routine needs ${ROUTINE_PASSES_MIN}); S5 proves the cheaper tier`,
      };
    }
    case 'parallel': {
      const pieces = listItems(taskSection(taskText, 'Pieces')).length;
      const files = listItems(taskSection(taskText, 'Files')).length;
      return {
        backed: pieces >= PARALLEL_PIECES_MIN || files >= PARALLEL_FILES_MIN,
        evidence: `the task lists ${pieces} independent pieces and ${files} files (needs ${PARALLEL_PIECES_MIN} pieces or ${PARALLEL_FILES_MIN} files)`,
      };
    }
    case 'recurring-role':
      return sectionBacking(
        taskText,
        'Recurs',
        'the task says how the role recurs',
        'the task file has no ## Recurs section saying how often the role comes back',
      );
  }
}

function asReason(value: string): AgentReason {
  if ((AGENT_REASONS as readonly string[]).includes(value)) return value as AgentReason;
  throw new AuthoringRefusal(
    `--reason must be one of ${AGENT_REASONS.join(', ')} (got "${value}").`,
    2,
  );
}

function asRefusal(value: string): AgentRefusal {
  if ((AGENT_REFUSALS as readonly string[]).includes(value)) return value as AgentRefusal;
  throw new AuthoringRefusal(
    `--refuse must be one of ${AGENT_REFUSALS.join(', ')} (got "${value}").`,
    2,
  );
}

function refused(lines: string[]): StageResult {
  return { ...stageResult(false, lines), stopped: true };
}

function baselineSummary(runs: readonly AgentBaselineRun[]) {
  const passed = runs.filter((run) => run.passed).length;
  return {
    runs: runs.length,
    passed,
    pass_rate: passed / runs.length,
    tokens_median: median(runs.map((run) => run.tokens)),
    duration_ms_median: median(runs.map((run) => run.duration_ms)),
    verbose_tokens_in_main_median: median(runs.map((run) => run.verbose_tokens_in_main)),
  };
}

function baselineTable(runs: readonly AgentBaselineRun[]): string {
  const rows = runs
    .map(
      (run) =>
        `| ${run.run} | ${run.passed ? 'passed' : 'failed'} | ${run.tokens} | ${run.duration_ms} | ${run.verbose_tokens_in_main} | ${run.note} |`,
    )
    .join('\n');
  return (
    '| Run | Result | Tokens | Duration (ms) | Verbose tokens in main | Note |\n' +
    `| --- | --- | --- | --- | --- | --- |\n${rows}\n`
  );
}

export function runAgentJustify(
  workspace: AuthoringWorkspace,
  input: AgentJustifyInput = {},
): StageResult {
  if (readMode(workspace).entry === 'improve') {
    return stageResult(true, [
      `${workspace.name} is in improve mode: the installed agent is the baseline, so S0 is skipped.`,
    ]);
  }
  if (input.refuse !== undefined) {
    const kind = asRefusal(input.refuse);
    return refused([agentRefusalLine(kind), plannedFileLine(kind, workspace.name)]);
  }
  if (input.reason === undefined) {
    return refused([
      `No reason names why ${workspace.name} should be an agent, so the main conversation is the better home. ` +
        `Name one with --reason (${AGENT_REASONS.join(', ')}) or the case with --refuse.`,
      plannedFileLine('unbacked', workspace.name),
    ]);
  }
  const reason = asReason(input.reason);
  if (input.taskText === undefined || input.taskText.trim() === '') {
    throw new AuthoringRefusal('justify needs --task-file <task.md> describing the task.', 2);
  }
  const runs = readAgentBaseline(workspace);
  const config = readAuthoringConfig(workspace.projectRoot);
  const backing = reasonBacking(reason, runs, input.taskText, config.agent_report_max_tokens);
  if (!backing.backed) {
    return refused([
      `The baseline does not back the reason ${reason}: ${backing.evidence}. The main conversation stays the better home.`,
      plannedFileLine('unbacked', workspace.name),
    ]);
  }
  const task = workspace.write('task.md', input.taskText);
  const line = `An agent is justified (${reason}): ${backing.evidence}.`;
  const artifact = workspace.write(
    'justification.md',
    renderGateMarkdown(
      { gate: 'passed', stage: 'S0', reason_key: reason, baseline: baselineSummary(runs) },
      `# Justification: ${workspace.name}\n\n${line}\n\n${baselineTable(runs)}`,
    ),
  );
  return stageResult(
    true,
    [line, `Next: paqad-ai agent intake ${workspace.name} <intake.yaml>`],
    [artifact, task],
  );
}
