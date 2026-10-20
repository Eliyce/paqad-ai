import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AdapterFactory } from '@/adapters';
import type { AdapterType } from '@/core/types/adapter.js';

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
