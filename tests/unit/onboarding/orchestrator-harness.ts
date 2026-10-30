import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { posix } from 'node:path';

const { join } = posix;

export const ORCHESTRATOR_GROUP_FILES = [
  'orchestrator.g1.test.ts',
  'orchestrator.g2.test.ts',
  'orchestrator.g3.test.ts',
  'orchestrator.g4.test.ts',
] as const;

export const PROJECT_SKILL_DIRS = [
  '.claude/skills',
  '.codex/skills',
  '.antigravity/skills',
  '.gemini/skills',
  '.junie/skills',
  '.cursor/skills',
  '.windsurf/skills',
  '.continue/prompts',
  '.github/skills',
  '.aider/skills',
];

export const PROJECT_AGENT_DIRS = [
  '.claude/agents',
  '.codex/agents',
  '.antigravity/agents',
  '.gemini/agents',
  '.junie/agents',
  '.cursor/agents',
  '.windsurf/agents',
  '.continue/agents',
  '.github/agents',
  '.aider/agents',
];

export interface OrchestratorSandbox {
  projectRoot: string;
  frameworkHome: string;
}

export function useOrchestratorSandbox(onReady: (sandbox: OrchestratorSandbox) => void): void {
  let sandbox: OrchestratorSandbox;
  let originalEnv: string | undefined;

  beforeEach(() => {
    sandbox = {
      projectRoot: mkdtempSync(join(tmpdir(), 'paqad-ai-onboard-')),
      frameworkHome: join(tmpdir(), `paqad-ai-home-${process.pid}-${randomUUID()}`),
    };
    originalEnv = process.env.PAQAD_FRAMEWORK_HOME;
    process.env.PAQAD_FRAMEWORK_HOME = sandbox.frameworkHome;
    onReady(sandbox);
  });

  afterEach(() => {
    setInteractive(false);
    vi.restoreAllMocks();
    rmSync(sandbox.projectRoot, { recursive: true, force: true });
    if (existsSync(sandbox.frameworkHome)) {
      rmSync(sandbox.frameworkHome, { recursive: true, force: true });
    }
    if (originalEnv === undefined) {
      delete process.env.PAQAD_FRAMEWORK_HOME;
    } else {
      process.env.PAQAD_FRAMEWORK_HOME = originalEnv;
    }
  });
}

export function assertNoProjectLocalSkillsOrAgents(projectRoot: string): void {
  for (const relativePath of [...PROJECT_SKILL_DIRS, ...PROJECT_AGENT_DIRS]) {
    expect(existsSync(join(projectRoot, relativePath))).toBe(false);
  }
}

export function findEmptyDirectories(root: string, current = root): string[] {
  const entries = readdirSync(current, { withFileTypes: true });
  const emptyDirectories: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const absolute = join(current, entry.name);
    const childEntries = readdirSync(absolute, { withFileTypes: true });

    if (childEntries.length === 0) {
      emptyDirectories.push(absolute.replace(`${root}/`, ''));
      continue;
    }

    emptyDirectories.push(...findEmptyDirectories(root, absolute));
  }

  return emptyDirectories.sort();
}

export function setInteractive(value: boolean): void {
  Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value });
  Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value });
}
