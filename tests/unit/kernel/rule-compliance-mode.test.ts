import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveRuleComplianceMode } from '@/kernel/capability.js';

// The two-truth strictness fix (issue #319): the workflow yaml's
// checks.rule_compliance.mode used to be read into the policy object and ignored
// by the runtime resolver (which looked only at .config), so a team that set
// `strict` in feature-development.yaml silently got the `warn` default. It is now
// a real, team-tracked FLOOR.
describe('resolveRuleComplianceMode — workflow yaml as a real floor (#319)', () => {
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
    // env asks for warn, but the tracked floor is strict — clamp wins.
    expect(resolveRuleComplianceMode(root, { PAQAD_RULE_COMPLIANCE: 'warn' })).toBe('strict');
  });
});
