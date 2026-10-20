import { describe, expect, it } from 'vitest';

import {
  CHIP_VERBS,
  chipFor,
  chipLabel,
  chipLine,
  chipSegments,
  inBundle,
  paqadCall,
} from '../../../../runtime/claude-plugin/mod/chips.ts';
import { parseSnapshot } from '../../../../runtime/claude-plugin/mod/model.ts';
import {
  FAST_ORD_490,
  FULL_ORD_501,
  PAUSED,
  fileText,
} from '../../../../runtime/claude-plugin/mod/test/fixtures.ts';

const parse = (raw: Record<string, unknown>) => parseSnapshot(fileText(raw))!;
const bash = (command: string) => paqadCall('Bash', { command });
const files = (...names: string[]) =>
  names.map((file) => ({ file, expectation: 'always', present: true }));

describe('which calls are paqad calls', () => {
  it('reads the verb, sub-verb and argument wherever paqad-ai is spelled', () => {
    expect(bash('paqad-ai stage start development')).toEqual({
      verb: 'stage',
      sub: 'start',
      arg: 'development',
    });
    expect(bash('SE_SESSION=abc pnpm exec paqad-ai plan compile --file x')).toEqual({
      verb: 'plan',
      sub: 'compile',
      arg: null,
    });
    expect(bash('cd /repo && ./node_modules/.bin/paqad-ai checks run')?.verb).toBe('checks');
    expect(bash('paqad-ai fix prove red -- pnpm test')).toEqual({
      verb: 'fix',
      sub: 'prove',
      arg: 'red',
    });
    for (const verb of CHIP_VERBS) expect(bash(`paqad-ai ${verb}`)?.verb).toBe(verb);
  });

  it('leaves other commands, other verbs and other tools alone', () => {
    expect(bash('paqad-ai status')).toBeNull();
    expect(bash('echo paqad-ai-stage')).toBeNull();
    expect(bash('mypaqad-ai stage start x')).toBeNull();
    expect(paqadCall('Read', { command: 'paqad-ai stage start x' })).toBeNull();
    expect(paqadCall('Bash', { command: 7 })).toBeNull();
    expect(paqadCall('Bash', null)).toBeNull();
  });
});

describe('the chip words', () => {
  it('names each call in plain words', () => {
    expect(chipLabel(bash('paqad-ai stage start development')!)).toBe('Build started');
    expect(chipLabel(bash('paqad-ai stage end review')!)).toBe('Review ended');
    expect(chipLabel(bash('paqad-ai stage status')!)).toBe('paqad stage status');
    expect(chipLabel(bash('paqad-ai plan compile')!)).toBe('Plan compiled');
    expect(chipLabel(bash('paqad-ai spec freeze')!)).toBe('Spec frozen');
    expect(chipLabel(bash('paqad-ai fix prove green')!)).toBe('Fix proof green');
    expect(chipLabel(bash('paqad-ai fix prove')!)).toBe('Fix proof');
    expect(chipLabel(bash('paqad-ai debt add')!)).toBe('Tech debt added');
    expect(chipLabel(bash('paqad-ai decision resolve')!)).toBe('Decision resolved');
    expect(chipLabel(bash('paqad-ai review')!)).toBe('paqad review');
  });

  it('draws each state with its own mark, colour and word', () => {
    expect(chipSegments({ label: 'Spec frozen', state: 'recorded' })).toEqual([
      { text: '✓ Spec frozen ', tone: 'good' },
      { text: 'recorded', tone: 'good' },
    ]);
    expect(chipSegments({ label: 'x', state: 'running' })[1]).toEqual({
      text: 'running',
      tone: 'working',
    });
    expect(chipSegments({ label: 'x', state: 'failed' })[0]!.text).toBe('✗ x ');
    expect(chipSegments({ label: 'x', state: 'blocked' })[1]).toEqual({
      text: 'blocked',
      tone: 'warn',
    });
    const line = chipLine([
      { label: 'A', state: 'recorded' },
      { label: 'B', state: 'failed' },
    ]);
    expect(line.map((segment) => segment.text).join('')).toBe('paqad ✓ A recorded  ✗ B failed');
  });
});

describe('the chip state from the bundle', () => {
  const full = parse({
    ...FULL_ORD_501,
    evidence_expected: files(
      'plan.json',
      'spec.md',
      'review.json',
      'checks.json',
      'tech-debt.json',
      'rule-overrides.jsonl',
    ),
  });

  it('reads recorded only when the bundle holds the call', () => {
    for (const command of [
      'paqad-ai stage end review',
      'paqad-ai plan compile',
      'paqad-ai spec freeze',
      'paqad-ai review record',
      'paqad-ai checks run',
      'paqad-ai rules load',
      'paqad-ai rules override',
      'paqad-ai debt add',
      'paqad-ai decision resolve',
    ]) {
      expect(inBundle(bash(command)!, full), command).toBe(true);
    }
    const fast = parse(FAST_ORD_490);
    for (const command of [
      'paqad-ai stage start review',
      'paqad-ai plan compile',
      'paqad-ai spec freeze',
      'paqad-ai review record',
      'paqad-ai checks run',
      'paqad-ai fix prove red',
      'paqad-ai rules override',
      'paqad-ai debt add',
      'paqad-ai decision create',
    ]) {
      expect(inBundle(bash(command)!, fast), command).toBe(false);
    }
    expect(inBundle(bash('paqad-ai rules load')!, fast)).toBe(true);
    const fixed = parse({ ...FAST_ORD_490, evidence_expected: files('fix-proof.json') });
    expect(inBundle(bash('paqad-ai fix prove red')!, fixed)).toBe(true);
  });

  it('reads running, failed and blocked from the row, and nothing with no change', () => {
    const call = bash('paqad-ai plan compile')!;
    expect(chipFor(call, {}, full)).toEqual({ label: 'Plan compiled', state: 'recorded' });
    expect(chipFor(call, { isRunning: true }, full)?.state).toBe('running');
    expect(chipFor(call, { isErrored: true, output: 'exit 1' }, full)?.state).toBe('failed');
    expect(
      chipFor(call, { isErrored: true, output: { stdout: '', stderr: 'Blocked: no plan' } }, full)
        ?.state,
    ).toBe('blocked');
    expect(chipFor(call, {}, parse(FAST_ORD_490))).toBeNull();
    expect(chipFor(call, {}, parse(PAUSED))).toBeNull();
    expect(chipFor(call, { isErrored: true }, null)).toBeNull();
  });
});
