import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CAPABILITY_IMPLS, resolveRuleComplianceMode } from '@/kernel/capability.js';
import type { EnforceOptions } from '@/rule-scripts/enforce.js';
import { writePendingPreMutation } from '@/rule-scripts/pending-marker.js';

const enforced = vi.hoisted(() => ({ calls: [] as unknown[] }));

vi.mock('@/rule-scripts/enforce.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/rule-scripts/enforce.js')>()),
  enforceRuleScripts: async (options: unknown) => {
    enforced.calls.push(options);
    return { ran: false, mode: 'strict', blocking: false, violations: [], armed: 1, summary: '' };
  },
}));

describe('resolveRuleComplianceMode — workflow yaml as a real floor', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-rc-mode-'));
    mkdirSync(join(root, '.paqad'), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function writeWorkflow(mode: string): void {
    const dir = join(root, 'docs/instructions/workflows');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'feature-development.yaml'),
      [
        'schema_version: "1"',
        'merge_mode: append',
        'stages:',
        '  checks:',
        '    rule_compliance:',
        `      mode: ${mode}`,
      ].join('\n'),
    );
  }

  function writeConfig(mode: string): void {
    const dir = join(root, '.paqad/configs');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '.config.policy'), `rule_compliance=${mode}\n`);
  }

  it('defaults to warn when nothing sets it', () => {
    expect(resolveRuleComplianceMode(root, {})).toBe('warn');
  });

  it('binds strict from the workflow yaml even when .config is unset (the fixed placebo)', () => {
    writeWorkflow('strict');
    expect(resolveRuleComplianceMode(root, {})).toBe('strict');
  });

  it('takes the stricter of the yaml and .config team surfaces', () => {
    writeWorkflow('strict');
    writeConfig('warn');
    expect(resolveRuleComplianceMode(root, {})).toBe('strict');
  });

  it('lets the env escape hatch raise above the floor', () => {
    writeWorkflow('warn');
    expect(resolveRuleComplianceMode(root, { PAQAD_RULE_COMPLIANCE: 'strict' })).toBe('strict');
  });

  it('does not let a local/env value lower below the tracked yaml floor', () => {
    writeWorkflow('strict');
    expect(resolveRuleComplianceMode(root, { PAQAD_RULE_COMPLIANCE: 'warn' })).toBe('strict');
  });
});

describe('rule-scripts capability: the options each seam passes', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-rc-seams-'));
    mkdirSync(join(root, '.paqad'), { recursive: true });
    enforced.calls = [];
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  async function evaluate(
    seam: 'pre-mutation' | 'completion',
    env: Record<string, string> = {},
  ): Promise<EnforceOptions> {
    const capability = CAPABILITY_IMPLS.get('rule-scripts')!;
    await capability.evaluate({
      projectRoot: root,
      seam,
      env: { PAQAD_RULE_COMPLIANCE: 'strict', ...env },
      payload: { sessionId: 'sess-seams', targetPath: join(root, 'src/app.ts') },
    });
    return enforced.calls.at(-1) as EnforceOptions;
  }

  it('AC-25: the pre-mutation seam passes kinds deterministic and scopes changed-files', async () => {
    expect(await evaluate('pre-mutation')).toMatchObject({
      kinds: ['deterministic'],
      scopes: ['changed-files'],
      useFileCache: true,
    });
  });

  it('AC-25: the completion seam passes no filter and never the file cache', async () => {
    writePendingPreMutation(root, {
      session_id: 'sess-seams',
      change: null,
      written_at: '2026-10-27T00:00:00.000Z',
      files: 1,
    });
    const options = await evaluate('completion');
    expect(options).toMatchObject({ scope: 'changed-files' });
    expect(options.kinds).toBeUndefined();
    expect(options.scopes).toBeUndefined();
    expect(options.useFileCache).toBeUndefined();
  });

  it('passes no filter and no file cache before an edit under rule_gate_pre_edit=all', async () => {
    const options = await evaluate('pre-mutation', {
      PAQAD_RULE_GATE_PRE_EDIT: 'all',
      PAQAD_RULE_GATE_CONCURRENCY: '1',
    });
    expect(options).toMatchObject({ scope: 'whole-tree', concurrency: 1 });
    expect(options.kinds).toBeUndefined();
    expect(options.useFileCache).toBeUndefined();
  });
});
