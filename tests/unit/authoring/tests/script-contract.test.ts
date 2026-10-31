import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  CONTRACT_CHECKS,
  contractTestName,
  planScriptContractTests,
  readScriptTestResults,
  scanRiskyScripts,
  scanRiskyText,
  scriptReportsPass,
  skillTestLocation,
} from '@/authoring/tests/script-contract.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function project(files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-contract-'));
  roots.push(root);
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
}

function testFile(stem: string, skip: string[] = []): string {
  return CONTRACT_CHECKS.map((check) =>
    skip.includes(check)
      ? `it.skip('${stem} ${check}', () => {});`
      : `it('${stem} ${check}', () => {});`,
  ).join('\n');
}

describe('where the skill tests live', () => {
  it('uses tests/skills/<name>/ by default and tests/Feature/Skills/<Name>/ for Laravel', () => {
    expect(skillTestLocation(project(), 'processing-invoices')).toEqual({
      dir: 'tests/skills/processing-invoices',
      framework: 'default',
    });
    const laravel = project({
      'composer.json': JSON.stringify({ require: { 'laravel/framework': '^12.0' } }),
    });
    expect(skillTestLocation(laravel, 'processing-invoices').dir).toBe(
      'tests/Feature/Skills/ProcessingInvoices',
    );
  });

  it('plans the seven named contract tests per script', () => {
    const plan = planScriptContractTests(project(), 'processing-invoices', ['scripts/extract.ts']);
    expect(plan.scripts[0]!.tests).toEqual([
      'extract help',
      'extract invalid input',
      'extract fixture output',
      'extract idempotency',
      'extract dry run',
      'extract output size',
      'extract secrets',
    ]);
  });
});

describe('the risky script scan', () => {
  it('finds network, package-install and file-delete calls with their line', () => {
    expect(
      scanRiskyText(
        'scripts/a.ts',
        'const r = await fetch(url);\nexecSync("npm install x");\nfs.rmSync(dir);\n',
      ).map((finding) => [finding.kind, finding.line]),
    ).toEqual([
      ['network', 1],
      ['package-install', 2],
      ['file-delete', 3],
    ]);
    expect(scanRiskyText('scripts/a.py', 'print("hello")\nform = 1\n')).toEqual([]);
  });

  it('scans scripts and the hooks and shell frontmatter values, not references', () => {
    const root = project({
      'skill/scripts/run.sh': 'curl https://example.test\n',
      'skill/references/a.md': 'curl https://example.test\n',
    });
    const findings = scanRiskyScripts(join(root, 'skill'), { shell: 'rm -rf /tmp/x' });
    expect(findings.map((finding) => finding.file)).toEqual(['scripts/run.sh', 'SKILL.md#shell']);
  });
});

describe('AC-27: script-tests results', () => {
  const location = { dir: 'tests/skills/processing-invoices', framework: 'default' as const };

  it('lists pass for each of the seven checks with the proving test name', () => {
    const root = project({
      'tests/skills/processing-invoices/extract.test.ts': testFile('extract'),
    });
    const [report] = readScriptTestResults({
      projectRoot: root,
      location,
      scripts: ['scripts/extract.ts'],
      run: { exitCode: 0, failedTests: null },
    });
    expect(report!.checks).toEqual(
      CONTRACT_CHECKS.map((check) => ({
        check,
        status: 'passed',
        test: contractTestName('scripts/extract.ts', check),
      })),
    );
    expect(scriptReportsPass([report!])).toBe(true);
  });

  it('marks a missing test and a failed run, attributing failures when names are known', () => {
    const root = project({
      'tests/skills/processing-invoices/extract.test.ts': testFile('extract').replace(
        "it('extract secrets', () => {});",
        '',
      ),
    });
    const [report] = readScriptTestResults({
      projectRoot: root,
      location,
      scripts: ['scripts/extract.ts'],
      run: { exitCode: 1, failedTests: ['extract > extract idempotency'] },
    });
    const byCheck = Object.fromEntries(report!.checks.map((check) => [check.check, check.status]));
    expect(byCheck).toMatchObject({ idempotency: 'failed', help: 'passed', secrets: 'missing' });
    expect(scriptReportsPass([report!])).toBe(false);
  });

  it('EC-16: the gate fails when every test of a script was skipped', () => {
    const root = project({
      'tests/skills/processing-invoices/extract.test.ts': testFile('extract', [...CONTRACT_CHECKS]),
    });
    const reports = readScriptTestResults({
      projectRoot: root,
      location,
      scripts: ['scripts/extract.ts'],
      run: { exitCode: 0, failedTests: null },
    });
    expect(reports[0]!.all_skipped).toBe(true);
    expect(scriptReportsPass(reports)).toBe(false);
  });
});
