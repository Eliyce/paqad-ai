import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  normalizedRuleHash,
  OBSOLETE_WORKFLOW_RULES,
  removeObsoleteWorkflowRules,
} from '@/onboarding/obsolete-cleanup.js';

const REPO = resolve(__dirname, '../../..');
const RULES = 'docs/instructions/rules';
const FIXTURES = join(REPO, 'tests/fixtures/obsolete-workflow-rules');
const NO_BLOB = /^0+$/;

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 28 });
}

function historyAvailable(): boolean {
  try {
    return git('rev-parse', '--is-shallow-repository').trim() === 'false';
  } catch {
    return false;
  }
}

function everyGitVersion(path: string): string[] {
  const blobs = new Set<string>();
  const raw = git(
    'log',
    '--all',
    '--full-history',
    '-m',
    '--format=',
    '--raw',
    '--no-abbrev',
    '--',
    path,
  );
  for (const line of raw.split('\n')) {
    const match = /^:\d+ \d+ ([0-9a-f]{40}) ([0-9a-f]{40}) /.exec(line);
    if (match === null) continue;
    for (const blob of [match[1]!, match[2]!]) {
      if (!NO_BLOB.test(blob)) blobs.add(blob);
    }
  }
  return [...blobs].map((blob) => git('cat-file', '-p', blob));
}

function runtimePath(rulePath: string): string {
  return `runtime/capabilities/${rulePath.replace('/', '/rules/')}`;
}

describe('removeObsoleteWorkflowRules', () => {
  let projectRoot: string;

  function fixture(name: string): string {
    return readFileSync(join(FIXTURES, name), 'utf8');
  }

  function place(rulePath: string, content: string): string {
    const path = join(projectRoot, RULES, rulePath);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
    return path;
  }

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-obsolete-rules-'));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('AC-5: deletes an unchanged shipped copy and returns one Removed line', () => {
    const path = place('security/pentest.md', fixture('security/pentest.md'));
    expect(removeObsoleteWorkflowRules(projectRoot)).toEqual([
      `Removed ${RULES}/security/pentest.md; paqad now runs pentests from its own pentest skill.`,
    ]);
    expect(existsSync(path)).toBe(false);
  });

  it('AC-5: treats a shipped copy carrying @rule markers as unchanged', () => {
    const marked = fixture('security/pentest.marked.md');
    expect(marked).toContain('<!-- @rule RL-');
    const path = place('security/pentest.md', marked);
    expect(removeObsoleteWorkflowRules(projectRoot)).toHaveLength(1);
    expect(existsSync(path)).toBe(false);
  });

  it('treats a shipped copy with CRLF line endings as unchanged', () => {
    const path = place(
      'security/pentest.md',
      fixture('security/pentest.md').replaceAll('\n', '\r\n'),
    );
    expect(removeObsoleteWorkflowRules(projectRoot)).toHaveLength(1);
    expect(existsSync(path)).toBe(false);
  });

  it('AC-6: keeps an edited copy and says why', () => {
    const edited = `${fixture('coding/site-map.md')}My own step.\n`;
    const path = place('coding/site-map.md', edited);
    expect(removeObsoleteWorkflowRules(projectRoot)).toEqual([
      `Kept ${RULES}/coding/site-map.md because it was edited. paqad now runs site maps from its own skill, so you can delete this file.`,
    ]);
    expect(readFileSync(path, 'utf8')).toBe(edited);
  });

  it('AC-7: does nothing and says nothing when none of the files exist', () => {
    expect(removeObsoleteWorkflowRules(projectRoot)).toEqual([]);
    expect(existsSync(join(projectRoot, RULES))).toBe(false);
  });

  it('keeps a path it cannot read and names the reason', () => {
    const path = join(projectRoot, RULES, 'security/pentest.md');
    mkdirSync(path, { recursive: true });
    expect(removeObsoleteWorkflowRules(projectRoot)).toEqual([
      expect.stringContaining(`Couldn't remove ${RULES}/security/pentest.md (EISDIR)`),
    ]);
    expect(existsSync(path)).toBe(true);
  });

  it('touches no other file under the rules folder', () => {
    const shipped = fixture('security/pentest.md');
    place('security/pentest.md', shipped);
    const other = place('coding/feature-development.md', shipped);
    place('coding/my-own-rule.md', shipped);
    removeObsoleteWorkflowRules(projectRoot);
    expect(readFileSync(other, 'utf8')).toBe(shipped);
    expect(readdirSync(join(projectRoot, RULES, 'coding')).sort()).toEqual([
      'feature-development.md',
      'my-own-rule.md',
    ]);
  });
});

describe('the shipped hash list', () => {
  it('names the seven paths with the number of versions that shipped', () => {
    expect(
      OBSOLETE_WORKFLOW_RULES.map((rule) => [rule.path, new Set(rule.shippedHashes).size]),
    ).toEqual([
      ['security/pentest.md', 1],
      ['coding/site-map.md', 5],
      ['coding/site-map-retest.md', 2],
      ['coding/design-test.md', 2],
      ['coding/design-retest.md', 1],
      ['coding/codebase-health.md', 1],
      ['coding/health-retest.md', 1],
    ]);
  });

  it.skipIf(!historyAvailable())('AC-9: holds every git version of each source file', () => {
    for (const rule of OBSOLETE_WORKFLOW_RULES) {
      const versions = everyGitVersion(runtimePath(rule.path));
      expect(versions.length, rule.path).toBeGreaterThan(0);
      for (const version of versions) {
        expect(rule.shippedHashes, rule.path).toContain(normalizedRuleHash(version));
      }
    }
  });
});
