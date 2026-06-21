import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AdapterFactory } from '@/adapters';
import type { AdapterType } from '@/core/types/adapter.js';

/**
 * Regression guard for the ledger bug: the verification-completion hook (the
 * only thing that writes the evidence ledger on a host without Claude's Stop
 * hook) must be wired into EVERY hook-capable host's native config — not Claude
 * Code alone — and it must live in the hook layer, never in the host's prose
 * entry file. A new host wired for one provider only fails here.
 */
const WIRED_HOSTS: ReadonlyArray<{
  type: AdapterType;
  /** The file the host actually executes hooks from. */
  hookFile: string;
  /** The host's native "agent finished" event, verified against its own docs. */
  event: string;
  /** The runtime hook script the host invokes on completion. */
  script: string;
  /** The host's prose entry file — must NOT carry the hook (no entry-file change). */
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
    script: 'verification-record.mjs',
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

      // The fix is in the hook layer: the prose entry file is untouched by it.
      const entry = files.find((file) => file.path === host.entryFile);
      expect(entry, `${host.type} must still emit ${host.entryFile}`).toBeDefined();
      expect(entry!.content).not.toContain('verification-record');
      expect(entry!.content).not.toContain('verification-completion');
    });
  }
});
