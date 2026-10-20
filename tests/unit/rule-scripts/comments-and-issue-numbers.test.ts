import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { executeRuleScript, type FindingsReport } from '@/rule-scripts/execute.js';
import { runFixtures } from '@/rule-scripts/fixture-runner.js';
import { parseScriptHeader } from '@/rule-scripts/header.js';

import { ticketRef } from '../../shared/ticket-ref.js';

const REPO_ROOT = resolve(__dirname, '../../..');
const DIR = join(REPO_ROOT, '.paqad/scripts/rules/coding/comments-and-issue-numbers');
const NO_COMMENTS = join(DIR, '001-no-comments.mjs');
const NO_NUMBERS = join(DIR, '002-no-issue-numbers.mjs');
const COMMENT_MSG = 'Comment in code. Move the reason into docs/ and delete the comment.';
const NUMBER_MSG = 'Issue number in code or docs. Git keeps this history; remove it.';
const FALLBACK_ENV = 'PAQAD_RULE_SCRIPT_NO_TYPESCRIPT';

const roots: string[] = [];

function createRoot(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-comments-rule-'));
  roots.push(root);
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body, 'utf8');
  }
  return root;
}

function run(script: string, root: string, files: string[]): FindingsReport {
  const result = executeRuleScript(script, { projectRoot: root, files });
  expect(result.ok, result.error).toBe(true);
  return result.report!;
}

function withFallback<T>(fn: () => T): T {
  const before = process.env[FALLBACK_ENV];
  process.env[FALLBACK_ENV] = '1';
  try {
    return fn();
  } finally {
    if (before === undefined) delete process.env[FALLBACK_ENV];
    else process.env[FALLBACK_ENV] = before;
  }
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('comments and issue numbers rule scripts', { timeout: 60_000 }, () => {
  it('both carry a valid deterministic changed-files header', () => {
    for (const script of [NO_COMMENTS, NO_NUMBERS]) {
      const parsed = parseScriptHeader(readFileSync(script, 'utf8'));
      expect(parsed.ok, parsed.errors.join('; ')).toBe(true);
      expect(parsed.header?.kind).toBe('deterministic');
      expect(parsed.header?.scope).toBe('changed-files');
      expect(parsed.header?.source).toBe(
        'docs/instructions/rules/coding/comments-and-issue-numbers.md',
      );
    }
  });

  it('the no-comments script classifies every fixture with the TypeScript scanner', () => {
    const result = runFixtures(NO_COMMENTS);
    expect(result.failures).toEqual([]);
    expect(result.passed).toBe(true);
    expect(result.pass_fixtures).toBeGreaterThanOrEqual(10);
    expect(result.fail_fixtures).toBeGreaterThanOrEqual(16);
  });

  it('the no-comments script classifies every fixture with the fallback scanner', () => {
    const result = withFallback(() => runFixtures(NO_COMMENTS));
    expect(result.failures).toEqual([]);
    expect(result.passed).toBe(true);
  });

  it('the no-issue-numbers script classifies every fixture', () => {
    const result = runFixtures(NO_NUMBERS);
    expect(result.failures).toEqual([]);
    expect(result.passed).toBe(true);
    expect(result.pass_fixtures).toBeGreaterThanOrEqual(10);
    expect(result.fail_fixtures).toBeGreaterThanOrEqual(14);
  });

  it('names the file and line of each comment, with the verbatim message and high severity', () => {
    const root = createRoot({
      'src/a.ts': [
        'const s = "//";',
        'const t = 1; // trailing',
        '// eslint-disable-next-line no-console -- kept',
        'console.log(s, t);',
        '/**',
        ' * doc',
        ' */',
        'export const u = 2;',
        '',
      ].join('\n'),
    });
    for (const report of [
      run(NO_COMMENTS, root, ['src/a.ts']),
      withFallback(() => run(NO_COMMENTS, root, ['src/a.ts'])),
    ]) {
      expect(report.rule_id).toBe('RL-3a9a');
      expect(report.kind).toBe('deterministic');
      expect(report.findings).toEqual([
        { file: 'src/a.ts', line: 2, message: COMMENT_MSG, severity: 'high' },
        { file: 'src/a.ts', line: 5, message: COMMENT_MSG, severity: 'high' },
      ]);
    }
  });

  it('skips files it does not cover and fixture data', () => {
    const root = createRoot({
      'docs/a.md': '<!-- note -->\n',
      'config.json': '{}\n',
      'pkg/__fixtures__/fail/a.ts': '// sample\n',
      'node_modules/x/index.js': '// vendored\n',
    });
    const report = run(NO_COMMENTS, root, [
      'docs/a.md',
      'config.json',
      'pkg/__fixtures__/fail/a.ts',
      'node_modules/x/index.js',
      'src/missing.ts',
    ]);
    expect(report.findings).toEqual([]);
  });

  it('names the file and line of each issue number, with the verbatim message and high severity', () => {
    const root = createRoot({
      'src/a.ts': `export const a = 'ok';\nexport const b = 'fixed in ${ticketRef(123)}';\n`,
      'docs/b.md': `Intro.\n\nSee issue ${123}.\n`,
      'src/c.css': `.a { color: ${ticketRef(333)}; }\n`,
    });
    const report = run(NO_NUMBERS, root, ['src/a.ts', 'docs/b.md', 'src/c.css']);
    expect(report.rule_id).toBe('RL-145a');
    expect(report.findings).toEqual([
      { file: 'src/a.ts', line: 2, message: NUMBER_MSG, severity: 'high' },
      { file: 'docs/b.md', line: 3, message: NUMBER_MSG, severity: 'high' },
    ]);
  });

  it('never scans the history paths', () => {
    const body = `Fixed in ${ticketRef(123)}.\n`;
    const files = {
      'CHANGELOG.md': body,
      'packages/x/CHANGELOG.md': body,
      '.changeset/brave-cats.md': body,
      '.paqad/decisions/D-1.md': body,
      '.paqad/ledger/feature-evidence/x/notes.md': body,
      '.paqad/ledger/x.ts': `export const a = '${ticketRef(123)}';\n`,
      'research/notes.md': body,
      'research/tool.ts': `export const a = '${ticketRef(123)}';\n`,
      'README.md': body,
    };
    const root = createRoot(files);
    expect(run(NO_NUMBERS, root, Object.keys(files)).findings).toEqual([]);
  });

  it('scans markdown and yaml only under docs, runtime and the rule scripts', () => {
    const body = `Fixed in ${ticketRef(123)}.\n`;
    const files = {
      'docs/a.md': body,
      'runtime/b.yaml': body,
      '.paqad/scripts/rules/c.yml': body,
      'docs/d.hbs': body,
      'website/e.md': body,
    };
    const root = createRoot(files);
    const flagged = run(NO_NUMBERS, root, Object.keys(files)).findings.map((f) => f.file);
    expect(flagged).toEqual([
      'docs/a.md',
      'runtime/b.yaml',
      '.paqad/scripts/rules/c.yml',
      'docs/d.hbs',
    ]);
  });

  it('scans the whole tree when run by hand', () => {
    const root = createRoot({
      'src/a.ts': `// note\nexport const a = '${ticketRef(42)}';\n`,
      'src/b.ts': 'export const b = 1;\n',
    });
    for (const [script, rule] of [
      [NO_COMMENTS, 'RL-3a9a'],
      [NO_NUMBERS, 'RL-145a'],
    ] as const) {
      const proc = spawnSync('node', [script, '--whole-tree', root], { encoding: 'utf8' });
      expect(proc.status).toBe(0);
      const report = JSON.parse(proc.stdout) as FindingsReport;
      expect(report.rule_id).toBe(rule);
      expect(report.findings.map((f) => `${f.file}:${f.line}`)).toEqual([
        rule === 'RL-3a9a' ? 'src/a.ts:1' : 'src/a.ts:2',
      ]);
    }
  });
});
