import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import YAML from 'yaml';

import { redactSecrets } from '@/rag/secrets.js';

import { SKILL_NAME_MAX, SKILL_NAME_PATTERN } from './lint/skill-lint.js';

export const WORKSPACE_ROOT = '.paqad/tmp/authoring/skills';
export const TRACKED_ROOT = '.paqad/authoring/skills';
export const AGENT_WORKSPACE_ROOT = '.paqad/tmp/authoring/agents';
export const AGENT_TRACKED_ROOT = '.paqad/authoring/agents';
export const AGENT_NAME_MAX = 256;
export const BUILTIN_OVERRIDE_AGENT_NAMES: readonly string[] = ['Explore'];

export type AuthoringKind = 'skill' | 'agent';

export class AuthoringRefusal extends Error {
  constructor(
    message: string,
    readonly exitCode: 1 | 2 = 1,
  ) {
    super(message);
  }
}

export function validateSkillName(name: string): string {
  if (typeof name !== 'string' || name.length === 0 || name.length > SKILL_NAME_MAX) {
    throw new AuthoringRefusal(
      `"${String(name)}" is not a skill name: use 1 to ${SKILL_NAME_MAX} characters.`,
      2,
    );
  }
  if (!SKILL_NAME_PATTERN.test(name)) {
    throw new AuthoringRefusal(
      `"${name}" is not a skill name: use a-z, 0-9 and single hyphens, with no hyphen at either end.`,
      2,
    );
  }
  return name;
}

export function validateAgentName(name: string): string {
  if (typeof name === 'string' && BUILTIN_OVERRIDE_AGENT_NAMES.includes(name)) return name;
  if (typeof name !== 'string' || name.length === 0 || name.length > AGENT_NAME_MAX) {
    throw new AuthoringRefusal(
      `"${String(name)}" is not an agent name: use 1 to ${AGENT_NAME_MAX} characters.`,
      2,
    );
  }
  if (!SKILL_NAME_PATTERN.test(name)) {
    throw new AuthoringRefusal(
      `"${name}" is not an agent name: use a-z, 0-9 and single hyphens, with no hyphen at either end, naming the role (code-reviewer, test-runner).`,
      2,
    );
  }
  return name;
}

export type GateState =
  'passed' | 'failed' | 'stopped' | 'waiting' | 'skipped' | 'overridden' | 'not-run';

export interface StageDefinition {
  id: string;
  name: string;
  artifact: string;
  command: (name: string) => string;
}

export const SKILL_STAGES: readonly StageDefinition[] = [
  {
    id: 'S0',
    name: 'justify',
    artifact: 'justification.md',
    command: (name) => `paqad-ai skill justify ${name}`,
  },
  {
    id: 'S1',
    name: 'intake',
    artifact: 'intake.yaml',
    command: (name) => `paqad-ai skill intake ${name} <intake.yaml>`,
  },
  {
    id: 'S2',
    name: 'evidence',
    artifact: 'overlap.md',
    command: (name) => `paqad-ai skill evidence ${name} <sources.md>`,
  },
  {
    id: 'S3',
    name: 'draft',
    artifact: 'trace.md',
    command: (name) => `paqad-ai skill draft ${name} --dir <folder> --trace <trace.md>`,
  },
  {
    id: 'S4',
    name: 'lint and tests',
    artifact: 'script-tests.json',
    command: (name) => `paqad-ai skill test ${name}`,
  },
  {
    id: 'S5',
    name: 'evals',
    artifact: 'benchmark.json',
    command: (name) => `paqad-ai skill eval plan ${name}`,
  },
  {
    id: 'S6',
    name: 'trigger',
    artifact: 'trigger-results.json',
    command: (name) => `paqad-ai skill trigger plan ${name}`,
  },
  {
    id: 'S7',
    name: 'release',
    artifact: 'release.json',
    command: (name) => `paqad-ai skill release ${name}`,
  },
];

export const AGENT_STAGES: readonly StageDefinition[] = [
  {
    id: 'S0',
    name: 'justify',
    artifact: 'justification.md',
    command: (name) => `paqad-ai agent justify ${name} --task-file <task.md> --reason <key>`,
  },
  {
    id: 'S1',
    name: 'intake',
    artifact: 'intake.yaml',
    command: (name) => `paqad-ai agent intake ${name} <intake.yaml>`,
  },
  {
    id: 'S2',
    name: 'evidence',
    artifact: 'overlap.md',
    command: (name) => `paqad-ai agent evidence ${name} <sources.md>`,
  },
  {
    id: 'S3',
    name: 'draft',
    artifact: 'trace.md',
    command: (name) => `paqad-ai agent draft ${name} --file <agent.md> --trace <trace.md>`,
  },
  {
    id: 'S4',
    name: 'lint and tests',
    artifact: 'script-tests.json',
    command: (name) => `paqad-ai agent test ${name}`,
  },
  {
    id: 'S5',
    name: 'evals',
    artifact: 'benchmark.json',
    command: (name) => `paqad-ai agent eval plan ${name}`,
  },
  {
    id: 'S6',
    name: 'delegation',
    artifact: 'delegation-results.json',
    command: (name) => `paqad-ai agent delegation plan ${name}`,
  },
  {
    id: 'S7',
    name: 'release',
    artifact: 'release.json',
    command: (name) => `paqad-ai agent release ${name}`,
  },
];

export function stageById(
  id: string,
  stages: readonly StageDefinition[] = SKILL_STAGES,
): StageDefinition {
  const stage = stages.find((entry) => entry.id === id);
  if (!stage) throw new Error(`unknown ${stages === AGENT_STAGES ? 'agent' : 'skill'} stage ${id}`);
  return stage;
}

export class AuthoringWorkspace {
  readonly rel: string;
  readonly dir: string;

  constructor(
    readonly projectRoot: string,
    readonly name: string,
    readonly kind: AuthoringKind,
    readonly root: string,
    readonly trackedRoot: string,
    readonly stages: readonly StageDefinition[],
  ) {
    this.rel = `${root}/${name}`;
    this.dir = join(projectRoot, root, name);
  }

  path(rel: string): string {
    return join(this.dir, rel);
  }

  relPath(rel: string): string {
    return `${this.rel}/${rel}`;
  }

  exists(rel: string): boolean {
    return existsSync(this.path(rel));
  }

  read(rel: string): string | null {
    try {
      return readFileSync(this.path(rel), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  readJson<T>(rel: string): T | null {
    const text = this.read(rel);
    if (text === null) return null;
    try {
      return JSON.parse(text) as T;
    } catch {
      return null;
    }
  }

  write(rel: string, content: string): string {
    const target = this.path(rel);
    mkdirSync(dirname(target), { recursive: true });
    const tmp = `${target}.tmp`;
    writeFileSync(tmp, redactSecrets(content, this.projectRoot), 'utf8');
    renameSync(tmp, target);
    return this.relPath(rel);
  }

  writeJson(rel: string, value: unknown): string {
    return this.write(rel, `${JSON.stringify(value, null, 2)}\n`);
  }

  remove(rel: string): void {
    rmSync(this.path(rel), { recursive: true, force: true });
  }

  clear(): void {
    rmSync(this.dir, { recursive: true, force: true });
  }
}

export class SkillWorkspace extends AuthoringWorkspace {
  constructor(projectRoot: string, name: string) {
    super(
      projectRoot,
      validateSkillName(name),
      'skill',
      WORKSPACE_ROOT,
      TRACKED_ROOT,
      SKILL_STAGES,
    );
  }
}

export class AgentWorkspace extends AuthoringWorkspace {
  constructor(projectRoot: string, name: string) {
    super(
      projectRoot,
      validateAgentName(name),
      'agent',
      AGENT_WORKSPACE_ROOT,
      AGENT_TRACKED_ROOT,
      AGENT_STAGES,
    );
  }
}

export interface GateMeta {
  gate: GateState;
  [key: string]: unknown;
}

export function renderGateMarkdown(meta: GateMeta, body: string): string {
  return `---\n${YAML.stringify(meta).trimEnd()}\n---\n${body.endsWith('\n') ? body : `${body}\n`}`;
}

export function readGateMeta(
  text: string | null,
  kind: 'markdown' | 'json' | 'yaml',
): GateMeta | null {
  if (text === null) return null;
  try {
    if (kind === 'json') {
      const parsed = JSON.parse(text) as Partial<GateMeta>;
      return typeof parsed.gate === 'string' ? (parsed as GateMeta) : null;
    }
    if (kind === 'yaml') return { gate: 'passed' };
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/u.exec(text);
    if (!match) return null;
    const parsed = YAML.parse(match[1]!) as Partial<GateMeta> | null;
    return parsed && typeof parsed.gate === 'string' ? (parsed as GateMeta) : null;
  } catch {
    return null;
  }
}

function artifactKind(artifact: string): 'markdown' | 'json' | 'yaml' {
  if (artifact.endsWith('.json')) return 'json';
  if (artifact.endsWith('.yaml')) return 'yaml';
  return 'markdown';
}

export interface WorkspaceMode {
  entry: 'new' | 'improve';
  source?: string;
}

export const MODE_FILE = 'mode.json';
export const OVERRIDES_FILE = 'overrides.json';

export interface OverrideRecord {
  gate: string;
  reason: string;
  by: string;
  at: string;
  decision: string;
}

export function readOverrides(workspace: AuthoringWorkspace): OverrideRecord[] {
  return workspace.readJson<OverrideRecord[]>(OVERRIDES_FILE) ?? [];
}
export const WAITING_FILE = 'waiting.json';

export interface WaitingOn {
  stage: string;
  decision: string;
  resume: string;
}

export function readMode(workspace: AuthoringWorkspace): WorkspaceMode {
  return workspace.readJson<WorkspaceMode>(MODE_FILE) ?? { entry: 'new' };
}

export function readWaiting(workspace: AuthoringWorkspace): WaitingOn[] {
  return workspace.readJson<WaitingOn[]>(WAITING_FILE) ?? [];
}

export function setWaiting(workspace: AuthoringWorkspace, entry: WaitingOn): void {
  const rest = readWaiting(workspace).filter((item) => item.stage !== entry.stage);
  workspace.writeJson(WAITING_FILE, [...rest, entry]);
}

export function clearWaiting(workspace: AuthoringWorkspace, stage: string): void {
  const rest = readWaiting(workspace).filter((item) => item.stage !== stage);
  if (rest.length === 0) workspace.remove(WAITING_FILE);
  else workspace.writeJson(WAITING_FILE, rest);
}

export interface StageState {
  stage: StageDefinition;
  state: GateState;
  artifact: string;
  detail: string | null;
  decision: string | null;
}

function skipsJustify(workspace: AuthoringWorkspace, stage: StageDefinition): boolean {
  return stage.id === 'S0' && readMode(workspace).entry === 'improve';
}

export function stageState(workspace: AuthoringWorkspace, stage: StageDefinition): StageState {
  const artifact = workspace.relPath(stage.artifact);
  const waiting = readWaiting(workspace).find((entry) => entry.stage === stage.id);
  if (waiting) {
    return {
      stage,
      state: 'waiting',
      artifact,
      detail: waiting.resume,
      decision: waiting.decision,
    };
  }
  const override = readOverrides(workspace).find((entry) => entry.gate === stage.id);
  if (override) {
    return {
      stage,
      state: 'overridden',
      artifact,
      detail: `override ${override.decision} by ${override.by}`,
      decision: override.decision,
    };
  }
  if (skipsJustify(workspace, stage)) {
    return {
      stage,
      state: 'skipped',
      artifact,
      detail: 'improve mode: the snapshot is the baseline',
      decision: null,
    };
  }
  const meta = readGateMeta(workspace.read(stage.artifact), artifactKind(stage.artifact));
  if (meta === null) {
    return { stage, state: 'not-run', artifact, detail: null, decision: null };
  }
  const detail = typeof meta.reason === 'string' ? meta.reason : null;
  return { stage, state: meta.gate, artifact, detail, decision: null };
}

export function allStageStates(workspace: AuthoringWorkspace): StageState[] {
  return workspace.stages.map((stage) => stageState(workspace, stage));
}

export function gateSatisfied(state: GateState): boolean {
  return state === 'passed' || state === 'skipped' || state === 'overridden';
}

export function requireEarlierGates(workspace: AuthoringWorkspace, stageId: string): void {
  for (const stage of workspace.stages) {
    if (stage.id === stageId) return;
    const state = stageState(workspace, stage);
    if (gateSatisfied(state.state)) continue;
    const current = stageById(stageId, workspace.stages);
    const why =
      state.state === 'waiting'
        ? `it is waiting on decision ${state.decision}`
        : state.state === 'not-run'
          ? 'it has not run'
          : `its gate is ${state.state}`;
    throw new AuthoringRefusal(
      `${current.id} ${current.name} can't start: ${stage.id} ${stage.name} has not passed (${why}). ` +
        `The missing artifact is ${state.artifact}. Run ${stage.command(workspace.name)} first.`,
    );
  }
}
