import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { readAuthoringConfig } from './config.js';
import { option, raiseAuthoringDecision } from './decisions.js';
import { AUTHORING_LEDGER_DIR } from './evidence.js';
import { readTextIfPresent, writeFileAtomic } from './fs-io.js';
import { AGENT_MEMORY_MAX_BYTES } from './lint/agent-lint.js';
import type { StageResult } from './stages/result.js';
import { AuthoringRefusal, type AuthoringWorkspace } from './workspace.js';

export const MEMORY_CURATION_FILE = 'memory-curation.json';
export const MEMORY_LEDGER = `${AUTHORING_LEDGER_DIR}/memory-curation.jsonl`;
export const DRAFT_MEMORY_FILE = 'draft/MEMORY.md';
export const MEMORY_IMPROVE_OPTION = 'improve';
export const MEMORY_LEAVE_OPTION = 'leave';

export function agentMemoryPath(name: string): string {
  return `.claude/agent-memory/${name}/MEMORY.md`;
}

export interface MemorySize {
  lines: number;
  bytes: number;
}

export function memorySize(text: string): MemorySize {
  const lines = text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
  return { lines, bytes: Buffer.byteLength(text) };
}

export function withinMemoryLimits(size: MemorySize, maxLines: number): boolean {
  return size.lines <= maxLines && size.bytes <= AGENT_MEMORY_MAX_BYTES;
}

function contentLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

export function appendOnlyProblem(before: string, after: string): string | null {
  const old = contentLines(before);
  const next = contentLines(after);
  if (old.length === 0) return null;
  if (next.length > old.length && old.every((line, index) => next[index] === line)) {
    return 'it is the old text with lines appended';
  }
  const remaining = new Set(next);
  if (next.length > old.length && old.every((line) => remaining.has(line))) {
    return 'it keeps every old line and adds more';
  }
  return null;
}

export interface MemoryCurationEntry {
  agent: string;
  at: string;
  before_lines: number;
  after_lines: number;
  before_bytes: number;
  after_bytes: number;
  alters_behaviour: boolean;
  decision: string | null;
}

function record(workspace: AuthoringWorkspace, entry: MemoryCurationEntry): string {
  const existing = workspace.readJson<MemoryCurationEntry[]>(MEMORY_CURATION_FILE) ?? [];
  const artifact = workspace.writeJson(MEMORY_CURATION_FILE, [...existing, entry]);
  const ledger = join(workspace.projectRoot, MEMORY_LEDGER);
  mkdirSync(dirname(ledger), { recursive: true });
  appendFileSync(ledger, `${JSON.stringify(entry)}\n`, 'utf8');
  return artifact;
}

export function producerHint(name: string, size: MemorySize, maxLines: number): string {
  return (
    `MEMORY.md of ${name} is ${size.lines} lines and ${size.bytes} bytes, over ${maxLines} lines or 25 KB. ` +
    'Consolidate it yourself: merge duplicate entries, drop stale ones and rewrite it shorter, never by appending. ' +
    `Then run paqad-ai agent memory-consolidate ${name} --file <consolidated MEMORY.md>.`
  );
}

export function runMemoryConsolidate(
  workspace: AuthoringWorkspace,
  input: {
    text?: string;
    altersBehaviour?: boolean;
    change?: string | null;
    now?: () => Date;
  } = {},
): StageResult {
  const projectRoot = workspace.projectRoot;
  const maxLines = readAuthoringConfig(projectRoot).agent_memory_max_lines;
  const path = agentMemoryPath(workspace.name);
  const before = readTextIfPresent(join(projectRoot, path)) ?? '';
  const beforeSize = memorySize(before);
  if (input.text === undefined) {
    return {
      ok: true,
      artifacts: [],
      lines: [
        withinMemoryLimits(beforeSize, maxLines)
          ? `MEMORY.md of ${workspace.name} is ${beforeSize.lines} lines, within ${maxLines}; nothing to consolidate.`
          : producerHint(workspace.name, beforeSize, maxLines),
      ],
    };
  }
  const afterSize = memorySize(input.text);
  if (!withinMemoryLimits(afterSize, maxLines)) {
    throw new AuthoringRefusal(
      `The consolidated MEMORY.md is ${afterSize.lines} lines and ${afterSize.bytes} bytes, still over ${maxLines} lines or 25 KB.`,
    );
  }
  const problem = appendOnlyProblem(before, input.text);
  if (problem !== null) {
    throw new AuthoringRefusal(
      `That is not a consolidation: ${problem}. Merge and shorten the entries instead.`,
    );
  }
  const at = (input.now ?? (() => new Date()))().toISOString();
  const base = {
    agent: workspace.name,
    at,
    before_lines: beforeSize.lines,
    after_lines: afterSize.lines,
    before_bytes: beforeSize.bytes,
    after_bytes: afterSize.bytes,
  };
  if (input.altersBehaviour === true) {
    const decision = raiseAuthoringDecision(projectRoot, {
      category: 'authoring.improvement',
      title: `Change what ${workspace.name} remembers? (${beforeSize.lines} to ${afterSize.lines} lines)`,
      context: `The consolidated memory changes how ${workspace.name} behaves, so its evals run again before it is kept.`,
      options: [
        option(
          MEMORY_IMPROVE_OPTION,
          'Keep it and rerun the evals',
          `If you pick this, the consolidated memory goes into the ${workspace.name} draft and its evals run again.`,
          'You give up: the current memory as it is.',
        ),
        option(
          MEMORY_LEAVE_OPTION,
          'Leave the memory',
          `If you pick this, the memory of ${workspace.name} does not change.`,
          'You give up: the shorter memory.',
        ),
      ],
      recommendation: MEMORY_IMPROVE_OPTION,
      change: input.change,
    });
    workspace.write(DRAFT_MEMORY_FILE, input.text);
    const artifact = record(workspace, { ...base, alters_behaviour: true, decision });
    return {
      ok: false,
      decision,
      artifacts: [artifact, workspace.relPath(DRAFT_MEMORY_FILE)],
      lines: [
        `The consolidation changes behaviour, so it waits in ${workspace.relPath(DRAFT_MEMORY_FILE)} on decision ${decision}. Once it is answered, rerun paqad-ai agent eval plan ${workspace.name}.`,
      ],
    };
  }
  mkdirSync(dirname(join(projectRoot, path)), { recursive: true });
  writeFileAtomic(join(projectRoot, path), input.text);
  const artifact = record(workspace, { ...base, alters_behaviour: false, decision: null });
  return {
    ok: true,
    artifacts: [artifact, path],
    lines: [
      `Consolidated MEMORY.md of ${workspace.name} from ${beforeSize.lines} to ${afterSize.lines} lines.`,
    ],
  };
}
