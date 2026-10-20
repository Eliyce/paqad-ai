import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { HealthCheckResult } from '@/core/types/health.js';
import { buildNativeHookConfigFile } from '@/adapters/shared/native-hook-config.js';
import { buildHostHookChain } from '@/adapters/shared/paqad-hooks.js';
import { HealthChecker } from '@/health/checker.js';

const NAME = 'Edit gates fail closed';
const ENV = { PAQAD_FRAMEWORK_HOME: '/fake/home/.paqad-ai/current' } as NodeJS.ProcessEnv;

async function gateCheck(projectRoot: string): Promise<HealthCheckResult | undefined> {
  const report = await new HealthChecker().run(projectRoot);
  return report.checks.find((check) => check.name === NAME);
}

function writeClaudeSettings(root: string, opts: { stripOnFailure?: boolean } = {}): void {
  const chain = buildHostHookChain('claude-code', ENV);
  const { content } = buildNativeHookConfigFile({
    projectRoot: root,
    settingsPath: '.claude/settings.json',
    chain,
  });
  let out = content;
  if (opts.stripOnFailure) {
    const parsed = JSON.parse(content) as {
      hooks: { PreToolUse: Array<{ hooks: Array<Record<string, unknown>> }> };
    };
    for (const group of parsed.hooks.PreToolUse) {
      for (const hook of group.hooks) {
        if (typeof hook.command === 'string' && hook.command.includes('agent-entry-gate.mjs')) {
          delete hook.onFailure;
          delete hook.timeout;
        }
      }
    }
    out = JSON.stringify(parsed, null, 2);
  }
  mkdirSync(join(root, '.claude'), { recursive: true });
  writeFileSync(join(root, '.claude/settings.json'), out);
}

describe('doctor — edit gates fail closed', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-gate-doctor-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('passes on a non-Claude project (no .claude/settings.json)', async () => {
    const check = await gateCheck(root);
    expect(check?.status).toBe('pass');
    expect(check?.detail).toContain('not a Claude Code project');
  });

  it('passes when the gate entries carry onFailure', async () => {
    writeClaudeSettings(root);
    const check = await gateCheck(root);
    expect(check?.status).toBe('pass');
    expect(check?.detail).toContain('onFailure');
  });

  it('warns and names the gate when onFailure is missing (older install)', async () => {
    writeClaudeSettings(root, { stripOnFailure: true });
    const check = await gateCheck(root);
    expect(check?.status).toBe('warning');
    expect(check?.detail).toContain('agent-entry-gate');
    expect(check?.remediation).toContain('Re-run onboarding');
  });

  it('warns on unreadable settings.json', async () => {
    mkdirSync(join(root, '.claude'), { recursive: true });
    writeFileSync(join(root, '.claude/settings.json'), 'not json {{{');
    const check = await gateCheck(root);
    expect(check?.status).toBe('warning');
    expect(check?.detail).toContain('unreadable');
  });
});
