import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AdapterFactory } from '@/adapters';
import type { AdapterType } from '@/core/types/adapter.js';
import {
  appendFeatureStageRow,
  openFeatureChange,
  readFeatureStageUnit,
} from '@/feature-evidence/stage-ledger.js';
import { startStage } from '@/stage-evidence/recorder.js';

const WIRED_HOSTS: ReadonlyArray<{
  type: AdapterType;
  hookFile: string;
  event: string;
  script: string;
  entryFile: string;
}> = [
  {
    type: 'claude-code',
    hookFile: '.claude/settings.json',
    event: '"Stop"',
    script: 'verification-completion.mjs',
    entryFile: 'CLAUDE.md',
  },
  {
    type: 'codex-cli',
    hookFile: '.codex/hooks.json',
    event: '"Stop"',
    script: 'verification-completion.mjs',
    entryFile: 'AGENTS.md',
  },
  {
    type: 'gemini-cli',
    hookFile: '.gemini/settings.json',
    event: '"AfterAgent"',
    script: 'verification-record.mjs',
    entryFile: 'GEMINI.md',
  },
];

describe('cross-provider completion-hook parity', () => {
  for (const host of WIRED_HOSTS) {
    it(`${host.type} wires the completion hook in ${host.hookFile}, not its entry file`, async () => {
      const projectRoot = mkdtempSync(join(tmpdir(), `paqad-parity-${host.type}-`));
      const files = await AdapterFactory.create(host.type).generateConfig({
        frameworkPath: '.paqad/framework-path.txt',
        rulesPath: 'docs/instructions/rules',
        projectRoot,
      });

      const hookFile = files.find((file) => file.path === host.hookFile);
      expect(hookFile, `${host.type} must emit ${host.hookFile}`).toBeDefined();
      expect(hookFile!.content).toContain(host.event);
      expect(hookFile!.content).toContain(host.script);

      const entry = files.find((file) => file.path === host.entryFile);
      expect(entry, `${host.type} must still emit ${host.entryFile}`).toBeDefined();
      expect(entry!.content).not.toContain('verification-record');
      expect(entry!.content).not.toContain('verification-completion');
    });
  }
});

describe('pre-mutation block is limited to the pre-and-completion hosts', () => {
  const PRE_MUTATION_MARKERS = ['stage-writer.mjs', 'capability-gate.mjs'];

  async function generate(type: AdapterType): Promise<string> {
    const projectRoot = mkdtempSync(join(tmpdir(), `paqad-block-${type}-`));
    const files = await AdapterFactory.create(type).generateConfig({
      frameworkPath: '.paqad/framework-path.txt',
      rulesPath: 'docs/instructions/rules',
      projectRoot,
    });
    return files.map((file) => file.content).join('\n');
  }

  const PRE_AND_COMPLETION: AdapterType[] = ['claude-code', 'codex-cli'];

  for (const type of PRE_AND_COMPLETION) {
    it(`${type} wires the stage-writer AND the pre-mutation deny`, async () => {
      const all = await generate(type);
      for (const marker of PRE_MUTATION_MARKERS) {
        expect(all, `${type} must wire ${marker}`).toContain(marker);
      }
    });
  }

  const NON_BLOCKING: AdapterType[] = [
    'gemini-cli',
    'cursor',
    'windsurf',
    'continue',
    'github-copilot',
    'junie',
    'aider',
    'antigravity',
    'aiassistant',
  ];

  for (const type of NON_BLOCKING) {
    it(`${type} wires no pre-mutation block (writer/deny absent)`, async () => {
      const all = await generate(type);
      for (const marker of PRE_MUTATION_MARKERS) {
        expect(all, `${type} must NOT wire ${marker}`).not.toContain(marker);
      }
    });
  }
});

describe('RULE-19: every completion hook defers while a stage agent of the change runs', () => {
  const SES = 'ses_parity_defer';
  const HOOKS = [
    { adapter: 'codex-cli', script: 'verification-completion.mjs' },
    { adapter: 'gemini-cli', script: 'verification-record.mjs' },
  ];

  for (const hook of HOOKS) {
    it(`${hook.adapter} (${hook.script}) writes no verify row and nothing on stdout`, () => {
      const root = mkdtempSync(join(tmpdir(), `paqad-parity-defer-${hook.adapter}-`));
      try {
        mkdirSync(join(root, '.paqad'), { recursive: true });
        writeFileSync(join(root, '.paqad/framework-path.txt'), '~/.paqad-ai/current\n');
        const dirName = openFeatureChange(root, SES, {
          adapter: hook.adapter,
          title: 'parity under test',
          issue: null,
          lane: 'full',
        });
        startStage(root, 'planning', { sessionId: SES, dirName, adapter: hook.adapter });
        appendFeatureStageRow(root, SES, dirName, {
          kind: 'stage-agent',
          stage: 'planning',
          agent: 'paqad-planning',
          agent_id: 'a1',
          event_status: 'started',
          tokens_used: 0,
          tokens_not_recarried: 0,
          estimate: true,
        });
        const stdout = execFileSync(
          'node',
          [resolve(process.cwd(), 'runtime/hooks', hook.script), hook.adapter],
          {
            input: JSON.stringify({ session_id: SES, cwd: root }),
            env: { ...process.env, PAQAD_PROJECT_ROOT: root, CLAUDE_PROJECT_DIR: root },
          },
        );
        expect(stdout.toString('utf8')).toBe('');
        const kinds = readFeatureStageUnit(root, dirName).map((row) => row.kind);
        expect(kinds).not.toContain('verify');
        expect(kinds).toContain('completion-deferred');
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  }
});
