import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CodexCliAdapter } from '@/adapters';
import { HealthChecker } from '@/health/checker.js';
import type { HealthCheckResult } from '@/core/types/health.js';

const NAME = 'Codex hooks wired';

async function codexHooksCheck(projectRoot: string): Promise<HealthCheckResult | undefined> {
  const report = await new HealthChecker().run(projectRoot);
  return report.checks.find((check) => check.name === NAME);
}

async function writeRealCodexHooks(projectRoot: string): Promise<void> {
  const files = await new CodexCliAdapter().generateConfig({
    frameworkPath: '.paqad/framework-path.txt',
    rulesPath: 'docs/instructions/rules',
    projectRoot,
  });
  const file = files.find((f) => f.path === '.codex/hooks.json')!;
  const full = join(projectRoot, '.codex/hooks.json');
  mkdirSync(join(projectRoot, '.codex'), { recursive: true });
  writeFileSync(full, file.content);
}

describe('doctor — Codex hooks wired (issue #566, AC-11)', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-codex-doctor-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('passes on a non-Codex project (no .codex/)', async () => {
    const check = await codexHooksCheck(root);
    expect(check?.status).toBe('pass');
    expect(check?.detail).toContain('not a Codex project');
  });

  it('warns and names the /hooks trust step when .codex/ has no hooks.json', async () => {
    mkdirSync(join(root, '.codex'), { recursive: true });
    const check = await codexHooksCheck(root);
    expect(check?.status).toBe('warning');
    expect(check?.remediation).toContain('/hooks');
  });

  it('warns when hooks.json is missing an event', async () => {
    await writeRealCodexHooks(root);
    // Drop the Stop event to simulate a partial file.
    const path = join(root, '.codex/hooks.json');
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as {
      hooks: Record<string, unknown>;
    };
    delete parsed.hooks.Stop;
    writeFileSync(path, JSON.stringify(parsed, null, 2));
    const check = await codexHooksCheck(root);
    expect(check?.status).toBe('warning');
    expect(check?.detail).toContain('Stop');
  });

  it('warns on unreadable hooks.json', async () => {
    mkdirSync(join(root, '.codex'), { recursive: true });
    writeFileSync(join(root, '.codex/hooks.json'), 'not json {{{');
    const check = await codexHooksCheck(root);
    expect(check?.status).toBe('warning');
    expect(check?.detail).toContain('unreadable');
  });

  it('passes when all four events carry paqad hooks', async () => {
    await writeRealCodexHooks(root);
    const check = await codexHooksCheck(root);
    expect(check?.status).toBe('pass');
    expect(check?.detail).toContain('All four Codex events');
  });
});
