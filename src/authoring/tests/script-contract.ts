import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { readProjectProfile } from '@/core/project-profile.js';

import { listFolderFiles } from '../hash.js';
import { studlySkillName } from './locations.js';

export const CONTRACT_CHECKS = [
  'help',
  'invalid input',
  'fixture output',
  'idempotency',
  'dry run',
  'output size',
  'secrets',
] as const;
export type ContractCheck = (typeof CONTRACT_CHECKS)[number];

export const HOOK_CONTRACT_CHECKS = ['blocks', 'allows', 'invalid input'] as const;
export type HookContractCheck = (typeof HOOK_CONTRACT_CHECKS)[number];

export type CheckStatus = 'passed' | 'failed' | 'skipped' | 'missing';

export interface ScriptCheckResult {
  check: ContractCheck | HookContractCheck;
  status: CheckStatus;
  test: string | null;
  reason?: string;
}

export interface ScriptTestReport {
  script: string;
  checks: ScriptCheckResult[];
  all_skipped: boolean;
}

export interface TestLocation {
  dir: string;
  framework: 'laravel' | 'default';
}

export function usesLaravel(projectRoot: string): boolean {
  const frameworks = readProjectProfile(projectRoot)?.stack_profile?.frameworks ?? [];
  if (frameworks.some((framework) => framework.toLowerCase() === 'laravel')) return true;
  try {
    const composer = JSON.parse(readFileSync(join(projectRoot, 'composer.json'), 'utf8')) as {
      require?: Record<string, string>;
    };
    return composer.require?.['laravel/framework'] !== undefined;
  } catch {
    return false;
  }
}

export function skillTestLocation(projectRoot: string, name: string): TestLocation {
  return usesLaravel(projectRoot)
    ? { dir: `tests/Feature/Skills/${studlySkillName(name)}`, framework: 'laravel' }
    : { dir: `tests/skills/${name}`, framework: 'default' };
}

export function agentTestLocation(projectRoot: string, name: string): TestLocation {
  return usesLaravel(projectRoot)
    ? { dir: `tests/Feature/Agents/${studlySkillName(name)}`, framework: 'laravel' }
    : { dir: `tests/agents/${name}`, framework: 'default' };
}

export function scriptStemOf(script: string): string {
  const name = basename(script);
  const dot = name.indexOf('.');
  return dot <= 0 ? name : name.slice(0, dot);
}

export function contractTestName(script: string, check: ContractCheck | HookContractCheck): string {
  return `${scriptStemOf(script)} ${check}`;
}

export interface ScriptContractPlan {
  location: TestLocation;
  scripts: Array<{ script: string; tests: string[] }>;
}

export function planScriptContractTests(
  projectRoot: string,
  name: string,
  scripts: readonly string[],
): ScriptContractPlan {
  return {
    location: skillTestLocation(projectRoot, name),
    scripts: scripts.map((script) => ({
      script,
      tests: CONTRACT_CHECKS.map((check) => contractTestName(script, check)),
    })),
  };
}

export type RiskKind = 'network' | 'package-install' | 'file-delete';

export interface RiskFinding {
  file: string;
  line: number;
  kind: RiskKind;
  match: string;
}

const RISK_PATTERNS: ReadonlyArray<{ kind: RiskKind; pattern: RegExp }> = [
  {
    kind: 'network',
    pattern:
      /\bfetch\(|\bhttps?\.(?:get|request)\(|\baxios\b|\brequests\.(?:get|post|put|delete|patch)\(|\burllib\b|\bcurl\s|\bwget\s|\bHttp::|\bGuzzle|\bnet\/http\b|\bXMLHttpRequest\b|\bWebSocket\b|\bsocket\.connect\(|file_get_contents\(\s*['"]https?:/,
  },
  {
    kind: 'package-install',
    pattern:
      /\b(?:npm|pnpm|yarn|bun)\s+(?:install|i|add)\b|\bpip3?\s+install\b|\bcomposer\s+(?:require|install)\b|\bgem\s+install\b|\bgo\s+(?:get|install)\b|\bapt(?:-get)?\s+install\b|\bbrew\s+install\b|\bcargo\s+install\b|\bnpx\s/,
  },
  {
    kind: 'file-delete',
    pattern:
      /\brm\s+-|\brm\s+\S|\bunlink(?:Sync)?\(|\bfs\.rm|\brmSync\(|\brmdirSync\(|\bos\.remove\(|\bos\.unlink\(|\bshutil\.rmtree\(|\bFile::delete\(|\bStorage::delete\(|\bos\.RemoveAll\(|\bFileUtils\.rm/,
  },
];

export function scanRiskyText(file: string, text: string): RiskFinding[] {
  const findings: RiskFinding[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    for (const { kind, pattern } of RISK_PATTERNS) {
      const match = pattern.exec(line);
      if (match) findings.push({ file, line: index + 1, kind, match: match[0].trim() });
    }
  });
  return findings;
}

export function scanRiskyScripts(
  skillFolder: string,
  frontmatter: Record<string, unknown> = {},
): RiskFinding[] {
  const findings: RiskFinding[] = [];
  for (const file of listFolderFiles(skillFolder)) {
    if (!file.rel.startsWith('scripts/') || file.bytes.subarray(0, 8000).includes(0)) continue;
    findings.push(...scanRiskyText(file.rel, file.bytes.toString('utf8')));
  }
  for (const key of ['hooks', 'shell'] as const) {
    if (frontmatter[key] === undefined) continue;
    findings.push(...scanRiskyText(`SKILL.md#${key}`, JSON.stringify(frontmatter[key])));
  }
  return findings;
}

const SKIP_MARKERS =
  /\.skip\(|\bxit\(|\bxtest\(|->skip\(|markTestSkipped|@pytest\.mark\.skip|\bt\.Skip\(|\bskip\(\s*['"]/;

interface TestSource {
  path: string;
  text: string;
}

function readTestSources(projectRoot: string, location: TestLocation): TestSource[] {
  const abs = join(projectRoot, location.dir);
  if (!existsSync(abs)) return [];
  return listFolderFiles(abs)
    .filter((file) => !file.bytes.subarray(0, 8000).includes(0))
    .map((file) => ({ path: `${location.dir}/${file.rel}`, text: file.bytes.toString('utf8') }));
}

function findTest(sources: readonly TestSource[], testName: string): { line: string } | null {
  for (const source of sources) {
    for (const line of source.text.split(/\r?\n/)) {
      if (
        line.includes(`'${testName}'`) ||
        line.includes(`"${testName}"`) ||
        line.includes(`\`${testName}\``)
      ) {
        return { line };
      }
    }
  }
  return null;
}

export interface TestRun {
  exitCode: number;
  failedTests: readonly string[] | null;
}

export function readScriptTestResults(input: {
  projectRoot: string;
  location: TestLocation;
  scripts: readonly string[];
  run: TestRun;
  checks?: readonly (ContractCheck | HookContractCheck)[];
}): ScriptTestReport[] {
  const sources = readTestSources(input.projectRoot, input.location);
  return input.scripts.map((script) => {
    const checks = (input.checks ?? CONTRACT_CHECKS).map((check): ScriptCheckResult => {
      const testName = contractTestName(script, check);
      const found = findTest(sources, testName);
      if (found === null) {
        return { check, status: 'missing', test: null, reason: `no test named "${testName}"` };
      }
      if (SKIP_MARKERS.test(found.line)) {
        return { check, status: 'skipped', test: testName, reason: 'the test is skipped' };
      }
      if (input.run.exitCode === 0) return { check, status: 'passed', test: testName };
      const failed = input.run.failedTests;
      const attributed = failed !== null && failed.length > 0;
      if (!attributed || failed.some((name) => name.includes(testName))) {
        return { check, status: 'failed', test: testName, reason: 'the test run failed' };
      }
      return { check, status: 'passed', test: testName };
    });
    return {
      script,
      checks,
      all_skipped: checks.every((check) => check.status === 'skipped'),
    };
  });
}

export function scriptReportsPass(reports: readonly ScriptTestReport[]): boolean {
  return reports.every(
    (report) =>
      !report.all_skipped &&
      report.checks.every((check) => check.status === 'passed' || check.status === 'skipped'),
  );
}
