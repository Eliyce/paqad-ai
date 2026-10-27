import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import { runRuleScripts, runRuleScriptsAsync } from '@/rule-scripts/runner.js';

import {
  GOLDEN_CHANGED_FILES,
  GOLDEN_NOW,
  buildGoldenProject,
} from '../../shared/rule-script-golden.js';

const FIXTURES = join(process.cwd(), 'tests/fixtures/rule-scripts');
const roots: string[] = [];

function golden(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8');
}

function project(): string {
  const root = buildGoldenProject();
  roots.push(root);
  return root;
}

function writtenReport(root: string): string {
  return readFileSync(join(root, PATHS.RULE_SCRIPTS_REPORT), 'utf8');
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(GOLDEN_NOW));
});

afterEach(() => {
  vi.useRealTimers();
  while (roots.length > 0) {
    rmSync(roots.pop()!, { recursive: true, force: true });
  }
});

describe('rule-script report against the golden captured from the serial runner', () => {
  it('AC-21: concurrency 1 with no filter writes a byte-identical report for changed files', async () => {
    const root = project();
    await runRuleScriptsAsync({
      projectRoot: root,
      mode: 'strict',
      changedFiles: [...GOLDEN_CHANGED_FILES],
      concurrency: 1,
    });
    expect(writtenReport(root)).toBe(golden('golden-report.json'));
  });

  it('AC-21: concurrency 1 with no filter writes a byte-identical report for the whole tree', async () => {
    const root = project();
    await runRuleScriptsAsync({ projectRoot: root, mode: 'strict', concurrency: 1 });
    expect(writtenReport(root)).toBe(golden('golden-report-whole-tree.json'));
  });

  it('AC-21: a full pool and the sync runner write the same bytes as the golden', async () => {
    const pooled = project();
    await runRuleScriptsAsync({
      projectRoot: pooled,
      mode: 'strict',
      changedFiles: [...GOLDEN_CHANGED_FILES],
      concurrency: 8,
    });
    expect(writtenReport(pooled)).toBe(golden('golden-report.json'));

    const serial = project();
    runRuleScripts({
      projectRoot: serial,
      mode: 'strict',
      changedFiles: [...GOLDEN_CHANGED_FILES],
    });
    expect(writtenReport(serial)).toBe(golden('golden-report.json'));
  });
});
