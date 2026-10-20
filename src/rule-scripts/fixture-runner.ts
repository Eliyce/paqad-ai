import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import fg from 'fast-glob';

import { executeRuleScript, missingBinaries } from './execute.js';
import { parseScriptHeader } from './header.js';

export interface FixtureFailure {
  fixture: string;
  expected: 'zero-findings' | 'at-least-one-finding';
  actual: number;
  detail?: string;
}

export interface FixtureResult {
  passed: boolean;
  pass_fixtures: number;
  fail_fixtures: number;
  failures: FixtureFailure[];
  missing_fixtures: boolean;
  missing_binaries?: string[];
}

export function fixturesRoot(scriptPath: string): string {
  const dir = dirname(scriptPath);
  const stem = basename(scriptPath).replace(/\.mjs$/, '');
  return join(dir, stem, '__fixtures__');
}

function listFixtures(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }
  return fg.sync('**/*', { cwd: dir, onlyFiles: true, dot: false }).sort();
}

export function runFixtures(scriptPath: string): FixtureResult {
  const root = fixturesRoot(scriptPath);
  const passDir = join(root, 'pass');
  const failDir = join(root, 'fail');
  const passFiles = listFixtures(passDir);
  const failFiles = listFixtures(failDir);

  if (passFiles.length === 0 && failFiles.length === 0) {
    return {
      passed: false,
      pass_fixtures: 0,
      fail_fixtures: 0,
      failures: [],
      missing_fixtures: true,
    };
  }

  if (existsSync(scriptPath)) {
    const header = parseScriptHeader(readFileSync(scriptPath, 'utf8'));
    const missing = missingBinaries(header.header?.requires?.binaries);
    if (missing.length > 0) {
      return {
        passed: false,
        pass_fixtures: passFiles.length,
        fail_fixtures: failFiles.length,
        failures: [],
        missing_fixtures: false,
        missing_binaries: missing,
      };
    }
  }

  const failures: FixtureFailure[] = [];

  for (const rel of passFiles) {
    const result = executeRuleScript(scriptPath, { projectRoot: passDir, files: [rel] });
    if (!result.ok) {
      failures.push({
        fixture: `pass/${rel}`,
        expected: 'zero-findings',
        actual: -1,
        detail: result.error,
      });
      continue;
    }
    const count = result.report?.findings.length ?? 0;
    if (count !== 0) {
      failures.push({ fixture: `pass/${rel}`, expected: 'zero-findings', actual: count });
    }
  }

  for (const rel of failFiles) {
    const result = executeRuleScript(scriptPath, { projectRoot: failDir, files: [rel] });
    if (!result.ok) {
      failures.push({
        fixture: `fail/${rel}`,
        expected: 'at-least-one-finding',
        actual: -1,
        detail: result.error,
      });
      continue;
    }
    const count = result.report?.findings.length ?? 0;
    if (count < 1) {
      failures.push({ fixture: `fail/${rel}`, expected: 'at-least-one-finding', actual: count });
    }
  }

  return {
    passed: failures.length === 0,
    pass_fixtures: passFiles.length,
    fail_fixtures: failFiles.length,
    failures,
    missing_fixtures: false,
  };
}
