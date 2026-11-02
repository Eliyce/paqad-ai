import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

import {
  STAGE_AGENT_MISSING_MESSAGE,
  claudeStageAgentSource,
  stageDispatchStopHookOutput,
  stageDispatchStopMessage,
} from '@/stage-isolation/agent-availability.js';
import { MANDATORY_STAGE_AGENTS } from '@/stage-isolation/stage-agents.js';

const HOOK = join(process.cwd(), 'runtime/hooks/agent-entry-session-start.mjs');

const roots: string[] = [];
function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-agent-availability-'));
  roots.push(root);
  return root;
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function writeHomeCopies(home: string, skip?: string): void {
  const dir = join(home, '.claude', 'agents');
  mkdirSync(dir, { recursive: true });
  for (const def of MANDATORY_STAGE_AGENTS) {
    if (def.agentName === skip) continue;
    writeFileSync(join(dir, `${def.agentName}.md`), '---\nname: x\n---\n', 'utf8');
  }
}

function writePluginInstall(home: string): void {
  const dir = join(home, '.claude', 'plugins');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'installed_plugins.json'),
    JSON.stringify({ plugins: { 'paqad@eliyce': [{}] } }),
    'utf8',
  );
}

function onboard(root: string, adapter = 'claude-code'): void {
  mkdirSync(join(root, '.paqad'), { recursive: true });
  writeFileSync(join(root, '.paqad', 'framework-path.txt'), '~/.paqad-ai/current\n', 'utf8');
  writeFileSync(
    join(root, '.paqad', 'onboarding-manifest.json'),
    JSON.stringify({ adapter }),
    'utf8',
  );
}

describe('Claude Code stage agent source', () => {
  it('reads the plugin first, then the home copy, then nothing', () => {
    const home = tempRoot();
    expect(claudeStageAgentSource({ homeDir: home })).toBeNull();
    writeHomeCopies(home);
    expect(claudeStageAgentSource({ homeDir: home })).toBe('home');
    writePluginInstall(home);
    expect(claudeStageAgentSource({ homeDir: home })).toBe('plugin');
  });

  it('treats a home copy missing one stage agent as no home copy', () => {
    const home = tempRoot();
    writeHomeCopies(home, 'paqad-review');
    expect(claudeStageAgentSource({ homeDir: home, pluginInstalled: false })).toBeNull();
  });
});

describe('stop when a dispatch finds no stage agent', () => {
  it('names the plugin install and refuses a main-session fallback', () => {
    const home = tempRoot();
    expect(stageDispatchStopMessage({ homeDir: home, pluginInstalled: false })).toBe(
      STAGE_AGENT_MISSING_MESSAGE,
    );
    expect(STAGE_AGENT_MISSING_MESSAGE).toContain('Install the paqad plugin');
    expect(STAGE_AGENT_MISSING_MESSAGE).toContain(
      'instead of running the stage in the main session',
    );
    expect(stageDispatchStopMessage({ homeDir: home, pluginInstalled: true })).toBeNull();
  });

  it('stays silent for a project not onboarded for Claude Code', () => {
    const home = tempRoot();
    expect(stageDispatchStopHookOutput(home, { homeDir: home, pluginInstalled: false })).toBeNull();
    onboard(home, 'codex-cli');
    expect(stageDispatchStopHookOutput(home, { homeDir: home, pluginInstalled: false })).toBeNull();
  });

  it('renders a visible system message and the stop instruction for the session', () => {
    const home = tempRoot();
    onboard(home);
    const parsed = JSON.parse(
      stageDispatchStopHookOutput(home, { homeDir: home, pluginInstalled: false })!,
    ) as { systemMessage: string; hookSpecificOutput: { additionalContext: string } };
    expect(parsed.systemMessage).toBe(STAGE_AGENT_MISSING_MESSAGE);
    expect(parsed.hookSpecificOutput.additionalContext).toContain('stop and show the Developer');
    writeHomeCopies(home);
    expect(stageDispatchStopHookOutput(home, { homeDir: home, pluginInstalled: false })).toBeNull();
  });

  it('the session-start hook prints the stop message on Claude Code with no agent source', async () => {
    const root = tempRoot();
    onboard(root);
    const env = {
      PATH: process.env.PATH ?? '',
      HOME: root,
      USERPROFILE: root,
      CLAUDE_PROJECT_DIR: root,
    };
    const missing = await execa('node', [HOOK], {
      input: JSON.stringify({ session_id: 's-1', source: 'startup' }),
      env,
      extendEnv: false,
      reject: false,
    });
    expect(missing.stdout).toContain('stage agents are missing');

    writeHomeCopies(root);
    const present = await execa('node', [HOOK], {
      input: JSON.stringify({ session_id: 's-1', source: 'startup' }),
      env,
      extendEnv: false,
      reject: false,
    });
    expect(present.stdout).not.toContain('stage agents are missing');
  });

  it('the session-start hook stays silent off Claude Code', async () => {
    const root = tempRoot();
    onboard(root);
    const result = await execa('node', [HOOK], {
      input: JSON.stringify({ session_id: 's-1', source: 'startup' }),
      env: {
        PATH: process.env.PATH ?? '',
        HOME: root,
        USERPROFILE: root,
        PAQAD_PROJECT_ROOT: root,
      },
      extendEnv: false,
      reject: false,
    });
    expect(result.stdout).toBe('');
  });
});
