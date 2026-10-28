import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createRulesCommand } from '@/cli/commands/rules.js';
import { featureFilePath } from '@/feature-evidence/paths.js';
import { readRuleOverrides } from '@/feature-evidence/rule-overrides.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import { writeWorkflowState } from '@/pipeline/workflow-state.js';
import { buildHudSnapshot } from '@/hud/snapshot.js';
import { readRuleStopRecord, writeRuleStopRecord } from '@/hud/last-block.js';
import {
  applyRuleOverride,
  managedSettingsEnforcePaqad,
  MANAGED_HOOK_MARKER,
} from '@/rule-scripts/override.js';

const SES = 'ses-override';
const NOW = () => new Date('2026-10-20T10:00:00.000Z');

describe('paqad-ai rules override', () => {
  let root: string;
  let dir: string;
  let noManaged: string[];

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-rules-override-'));
    mkdirSync(join(root, '.paqad'), { recursive: true });
    dir = openFeatureChange(root, SES, { adapter: 'claude-code', lane: 'fast' });
    writeWorkflowState(root, SES, { active: { workflow: 'feature-development' }, paused: [] });
    noManaged = [join(root, 'no-managed.json')];
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
    rmSync(root, { recursive: true, force: true });
  });

  function stop(overrides: { managed?: boolean; toolUseId?: string; sole?: boolean } = {}): string {
    return writeRuleStopRecord({
      projectRoot: root,
      sessionId: SES,
      rule: 'RL-1',
      title: 'No comments',
      file: 'src/x.ts',
      toolUseId: overrides.toolUseId ?? 'tu_1',
      managed: overrides.managed ?? false,
      sole: overrides.sole ?? true,
      now: NOW,
    }).token;
  }

  function override(
    token: string,
    extra: Partial<Parameters<typeof applyRuleOverride>[0]> = {},
  ): ReturnType<typeof applyRuleOverride> {
    return applyRuleOverride({
      projectRoot: root,
      sessionHint: SES,
      rule: 'RL-1',
      file: 'src/x.ts',
      token,
      toolUseId: 'tu_1',
      managedSettingsPaths: noManaged,
      now: NOW,
      ...extra,
    });
  }

  function rows(): number {
    return existsSync(join(root, featureFilePath(dir, 'ruleOverrides')))
      ? readRuleOverrides(root, dir).length
      : 0;
  }

  it('AC-18, AC-19: writes one row naming rule, file, who and time and marks the token used for the matching unused token', () => {
    const token = stop();
    const outcome = override(token);
    expect(outcome).toEqual({
      ok: true,
      dirName: dir,
      row: {
        kind: 'rule-override',
        rule: 'RL-1',
        file: 'src/x.ts',
        tool_use_id: 'tu_1',
        by: 'human',
        at: '2026-10-20T10:00:00.000Z',
        session: SES,
      },
    });
    expect(readRuleOverrides(root, dir)).toHaveLength(1);
    expect(readRuleStopRecord(root, SES)).toMatchObject({ used: true, allowed_once: true });
    expect(buildHudSnapshot(root, SES, { now: NOW }).rule_overrides).toEqual([
      { rule: 'RL-1', file: 'src/x.ts', by: 'human', at: '2026-10-20T10:00:00.000Z' },
    ]);
  });

  it('AC-12: a successful override marks the stop allowed once, and the old token-only mark is gone', async () => {
    override(stop());
    expect(readRuleStopRecord(root, SES)).toMatchObject({ used: true, allowed_once: true });
    expect('markRuleStopTokenUsed' in (await import('@/hud/last-block.js'))).toBe(false);
  });

  it('AC-19: refuses no token, a wrong token, another tool call and a used token, writing nothing', () => {
    const token = stop();
    for (const bad of [
      override(''),
      override('0'.repeat(32)),
      override(token, { toolUseId: 'tu_other' }),
    ]) {
      expect(bad.ok).toBe(false);
    }
    expect(rows()).toBe(0);
    expect(readRuleStopRecord(root, SES)?.used).toBe(false);
    expect(override(token).ok).toBe(true);
    expect(override(token)).toEqual({
      ok: false,
      reason: 'the override token is missing, wrong or already used',
    });
    expect(rows()).toBe(1);
  });

  it('refuses another rule, another file, a path outside the project and a missing stop', () => {
    expect(override('t')).toEqual({
      ok: false,
      reason: 'no rule stop is recorded for this session',
    });
    const token = stop();
    expect(override(token, { rule: 'RL-2' }).ok).toBe(false);
    expect(override(token, { file: 'src/y.ts' }).ok).toBe(false);
    expect(override(token, { file: '../outside.ts' })).toEqual({
      ok: false,
      reason: '../outside.ts is outside this project',
    });
    expect(override(token, { sessionHint: '  ' }).ok).toBe(false);
    expect(override(token, { sessionHint: 'ses-other' }).ok).toBe(false);
    expect(rows()).toBe(0);
  });

  it('accepts an absolute path to the stopped file', () => {
    const token = stop();
    expect(override(token, { file: join(root, 'src/x.ts') }).ok).toBe(true);
  });

  it('AC-25: records a reason only when one was given, and allows both', () => {
    expect(override(stop(), { reason: '  needed for the hotfix ' }).ok).toBe(true);
    expect(override(stop(), { reason: '   ' }).ok).toBe(true);
    const [withReason, without] = readRuleOverrides(root, dir);
    expect(withReason?.reason).toBe('needed for the hotfix');
    expect(without).not.toHaveProperty('reason');
  });

  it('AC-20: refuses a managed stop, even when the record managed flag was edited to false', () => {
    expect(override(stop({ managed: true }))).toEqual({
      ok: false,
      reason: "this rule is enforced by your organization's settings",
    });
    const policy = join(root, 'paqad.json');
    writeFileSync(
      policy,
      JSON.stringify({
        hooks: {
          PreToolUse: [
            { hooks: [{ type: 'command', command: `${MANAGED_HOOK_MARKER} capability-gate` }] },
          ],
        },
      }),
    );
    const token = stop({ managed: false });
    expect(override(token, { managedSettingsPaths: [policy] }).ok).toBe(false);
    expect(rows()).toBe(0);
  });

  it('AC-23: a second stop on the same file and rule takes a second answer and writes a second row', () => {
    expect(override(stop()).ok).toBe(true);
    expect(override(stop({ toolUseId: 'tu_2' }), { toolUseId: 'tu_2' }).ok).toBe(true);
    expect(
      readRuleOverrides(root, dir).map((row) => [row.rule, row.file, row.tool_use_id]),
    ).toEqual([
      ['RL-1', 'src/x.ts', 'tu_1'],
      ['RL-1', 'src/x.ts', 'tu_2'],
    ]);
  });

  it('AC-24: Allow once pressed twice for one tool use writes one row for that session and tool use', () => {
    const token = stop();
    const first = override(token);
    const second = override(token);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(
      readRuleOverrides(root, dir).filter(
        (row) => row.session === SES && row.tool_use_id === 'tu_1',
      ),
    ).toHaveLength(1);
  });

  it('refuses a stop that another paqad gate also blocked, writing nothing', () => {
    const token = stop({ sole: false });
    expect(override(token)).toEqual({
      ok: false,
      reason: 'another paqad gate also stopped this edit, so it cannot be allowed once',
    });
    expect(rows()).toBe(0);
  });

  it('refuses when no change is active', () => {
    const bare = mkdtempSync(join(tmpdir(), 'paqad-rules-override-bare-'));
    const token = writeRuleStopRecord({
      projectRoot: bare,
      sessionId: SES,
      rule: 'RL-1',
      file: 'src/x.ts',
      managed: false,
      sole: true,
    }).token;
    const outcome = override(token, { projectRoot: bare, toolUseId: undefined });
    rmSync(bare, { recursive: true, force: true });
    expect(outcome).toEqual({
      ok: false,
      reason: 'no active change to record the override in',
    });
  });

  it('reads managed settings files defensively', () => {
    const odd = join(root, 'odd.json');
    writeFileSync(
      odd,
      JSON.stringify({ hooks: { PreToolUse: [null, { hooks: [null, {}] }], X: 3 } }),
    );
    const broken = join(root, 'broken.json');
    writeFileSync(broken, '{');
    const other = join(root, 'other.json');
    writeFileSync(other, JSON.stringify({ hooks: 'x' }));
    expect(managedSettingsEnforcePaqad([odd, broken, other, join(root, 'missing.json')])).toBe(
      false,
    );
  });

  describe('command', () => {
    let lines: string[];
    let errors: string[];

    beforeEach(() => {
      lines = [];
      errors = [];
      vi.spyOn(console, 'log').mockImplementation((line: string) => {
        lines.push(String(line));
      });
      vi.spyOn(console, 'error').mockImplementation((line: string) => {
        errors.push(String(line));
      });
    });

    async function run(...args: string[]): Promise<void> {
      await createRulesCommand().parseAsync(
        ['override', ...args, '--project-root', root, '--session', SES],
        { from: 'user' },
      );
    }

    it('records the override and prints the row', async () => {
      const token = stop();
      await run('--rule', 'RL-1', '--file', 'src/x.ts', '--token', token, '--reason', 'ok');
      expect(process.exitCode).toBeUndefined();
      const json = JSON.parse(lines.at(-1)!) as Record<string, unknown>;
      expect(json).toMatchObject({ overridden: true, rule: 'RL-1', reason: 'ok', bundle: dir });
      expect(readFileSync(join(root, featureFilePath(dir, 'ruleOverrides')), 'utf8')).toContain(
        '"kind":"rule-override"',
      );
    });

    it('AC-19: exits 1 and writes nothing for no token, a wrong token, another tool use or a used token', async () => {
      const token = stop();
      const base = ['--rule', 'RL-1', '--file', 'src/x.ts'];
      for (const args of [
        ['--token', ''],
        ['--token', '0'.repeat(32)],
        ['--token', token, '--tool-use-id', 'tu_other'],
      ]) {
        process.exitCode = undefined;
        await run(...base, ...args);
        expect(process.exitCode).toBe(1);
        expect(rows()).toBe(0);
        expect(readRuleStopRecord(root, SES)?.used).toBe(false);
      }
      process.exitCode = undefined;
      await run(...base, '--token', token, '--tool-use-id', 'tu_1');
      expect(process.exitCode).toBeUndefined();
      expect(rows()).toBe(1);
      expect(readRuleStopRecord(root, SES)?.used).toBe(true);
      await run(...base, '--token', token, '--tool-use-id', 'tu_1');
      expect(process.exitCode).toBe(1);
      expect(rows()).toBe(1);
    });

    it('exits 1 with the reason when refused', async () => {
      stop();
      await run('--rule', 'RL-1', '--file', 'src/x.ts', '--token', 'wrong');
      expect(process.exitCode).toBe(1);
      expect(errors.join('\n')).toContain('override refused');
      expect(rows()).toBe(0);
    });
  });
});
