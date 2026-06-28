import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AdapterFactory } from '@/adapters';
import { ADAPTER_TYPES } from '@/core/types/adapter.js';

/**
 * Issue #240 — no onboarded host config may wire a Windows-broken hook command.
 * The inverse of the old `toContain('...sh')` assertions: every generated hook
 * command must run on Windows as well as POSIX, which means:
 *   - no `.sh` target (Windows ships no bash; the file is not executable),
 *   - no bare `~` (cmd.exe / PowerShell do not expand it),
 *   - no reliance on a shebang / exec-bit — every paqad hook launches through an
 *     explicit `node` interpreter with an absolute path.
 * This runs for EVERY adapter so a future host that starts wiring hooks cannot
 * silently reintroduce the POSIX-only invocation.
 */
describe('generated hook commands are cross-platform (#240)', () => {
  for (const type of ADAPTER_TYPES) {
    it(`${type}: wires no .sh hook command and no bare ~ path`, async () => {
      const projectRoot = mkdtempSync(join(tmpdir(), `paqad-xplat-${type}-`));
      try {
        const adapter = AdapterFactory.create(type);
        const files = await adapter.generateConfig({
          frameworkPath: '.paqad/framework-path.txt',
          rulesPath: 'docs/instructions/rules',
          projectRoot,
        });
        const commands = files.flatMap((file) => extractHookCommands(file.content));

        for (const command of commands) {
          expect(command, `${type}: hook command must not target a .sh script`).not.toMatch(
            /\.sh(["'\s]|$)/,
          );
          expect(command, `${type}: hook command must not rely on ~ expansion`).not.toMatch(
            /(^|[\s"'])~\//,
          );
          // Any command that points at a paqad hook must launch via `node`.
          if (command.includes('.paqad-ai') || command.includes('/hooks/')) {
            expect(command, `${type}: paqad hook must launch via the node interpreter`).toMatch(
              /^node\s/,
            );
          }
        }
      } finally {
        rmSync(projectRoot, { recursive: true, force: true });
      }
    });
  }
});

/**
 * Issue #240 (per-machine decision) — the hook-wiring adapters mark their
 * machine-specific generated hook config git-ignored via a nested `.gitignore`
 * in the host dir, so an absolute home path never lands in a committed file.
 */
describe('hook-wiring adapters gitignore their per-machine hook config (#240)', () => {
  const hostByAdapter: Record<string, { dir: string; ignored: string[] }> = {
    'claude-code': { dir: '.claude', ignored: ['settings.json', 'settings.hooks.json'] },
    'codex-cli': { dir: '.codex', ignored: ['hooks.json', 'settings.hooks.json'] },
    'gemini-cli': { dir: '.gemini', ignored: ['settings.json', 'settings.hooks.json'] },
  };

  for (const [type, { dir, ignored }] of Object.entries(hostByAdapter)) {
    it(`${type}: emits ${dir}/.gitignore covering its executed hook config + sidecar`, async () => {
      const projectRoot = mkdtempSync(join(tmpdir(), `paqad-ignore-${type}-`));
      try {
        const files = await AdapterFactory.create(type).generateConfig({
          frameworkPath: '.paqad/framework-path.txt',
          rulesPath: 'docs/instructions/rules',
          projectRoot,
        });
        const gitignore = files.find((file) => file.path === `${dir}/.gitignore`);
        expect(gitignore, `${type} must emit ${dir}/.gitignore`).toBeDefined();
        for (const name of ignored) {
          expect(gitignore!.content).toContain(name);
        }
      } finally {
        rmSync(projectRoot, { recursive: true, force: true });
      }
    });
  }

  it('a non-hook adapter (aider) emits no host-config .gitignore', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'paqad-ignore-aider-'));
    try {
      const files = await AdapterFactory.create('aider').generateConfig({
        frameworkPath: '.paqad/framework-path.txt',
        rulesPath: 'docs/instructions/rules',
        projectRoot,
      });
      expect(files.some((file) => file.path.endsWith('.gitignore'))).toBe(false);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});

/** Pull every `"command": "<value>"` out of a generated JSON host config,
 *  unescaping JSON string escapes so the raw shell command is asserted. Files
 *  that carry no hook commands (markdown entry files, etc.) yield none. */
function extractHookCommands(content: string): string[] {
  const out: string[] = [];
  const re = /"command"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    out.push(match[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\'));
  }
  return out;
}
