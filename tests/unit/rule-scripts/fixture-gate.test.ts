import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { executeRuleScript, missingBinaries } from '@/rule-scripts/execute.js';
import { fixturesRoot, runFixtures } from '@/rule-scripts/fixture-runner.js';
import { checkOverFlag } from '@/rule-scripts/guard.js';
import { parseScriptHeader } from '@/rule-scripts/header.js';

const roots: string[] = [];

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-fixture-gate-'));
  roots.push(root);
  return root;
}

function write(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body, 'utf8');
}

// A real, self-contained rule script: flags `debugger` statements. Pure node,
// reads { projectRoot, files } from stdin, emits the findings contract.
const NO_DEBUGGER_SCRIPT = `// @paqad-rule-script
// rule_id: RL-7f3a
// source: docs/instructions/rules/coding/code-quality.md
// kind: deterministic
// scope: changed-files
// runtime: node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const { projectRoot, files } = JSON.parse(readFileSync(0, 'utf8'));
const findings = [];
for (const f of files) {
  const text = readFileSync(join(projectRoot, f), 'utf8');
  text.split('\\n').forEach((line, i) => {
    if (/\\bdebugger\\b/.test(line)) {
      findings.push({ file: f, line: i + 1, message: 'debugger statement', severity: 'blocker' });
    }
  });
}
process.stdout.write(JSON.stringify({ rule_id: 'RL-7f3a', kind: 'deterministic', findings }));
`;

afterEach(() => {
  while (roots.length > 0) {
    rmSync(roots.pop()!, { recursive: true, force: true });
  }
});

describe('script header', () => {
  it('parses and validates a well-formed header', () => {
    const parsed = parseScriptHeader(NO_DEBUGGER_SCRIPT);
    expect(parsed.ok).toBe(true);
    expect(parsed.header?.rule_id).toBe('RL-7f3a');
    expect(parsed.header?.kind).toBe('deterministic');
    expect(parsed.header?.scope).toBe('changed-files');
  });

  it('parses a requires block as JSON', () => {
    const withReq = NO_DEBUGGER_SCRIPT.replace(
      '// runtime: node\n',
      '// runtime: node\n// requires: {"node":">=22","binaries":["git"]}\n',
    );
    const parsed = parseScriptHeader(withReq);
    expect(parsed.ok).toBe(true);
    expect(parsed.header?.requires?.binaries).toEqual(['git']);
  });

  it('rejects a missing marker and a bad rule_id', () => {
    expect(parseScriptHeader('import x from "y";').ok).toBe(false);
    const badId = NO_DEBUGGER_SCRIPT.replace('RL-7f3a', 'NOPE');
    expect(parseScriptHeader(badId).ok).toBe(false);
  });

  it('accepts an uppercase-hex rule_id by canonicalising before validation', () => {
    const upper = NO_DEBUGGER_SCRIPT.replace('RL-7f3a', 'RL-7F3A');
    const parsed = parseScriptHeader(upper);
    expect(parsed.ok).toBe(true);
    expect(parsed.header?.rule_id).toBe('RL-7f3a');
  });

  it('tolerates blank lines and a bare // separator in the header block (D-2)', () => {
    const spaced = [
      '// @paqad-rule-script',
      '//',
      '// rule_id: RL-7f3a',
      '',
      '// source: docs/instructions/rules/coding/q.md',
      '// kind: deterministic',
      '// scope: changed-files',
      '// runtime: node',
      '',
      "import { readFileSync } from 'node:fs';",
    ].join('\n');
    const parsed = parseScriptHeader(spaced);
    expect(parsed.ok).toBe(true);
    expect(parsed.header?.rule_id).toBe('RL-7f3a');
    expect(parsed.header?.kind).toBe('deterministic');
  });

  it('canonicalises uppercase kind/scope/runtime enums (C-5)', () => {
    const upper = NO_DEBUGGER_SCRIPT.replace('// kind: deterministic', '// kind: Deterministic')
      .replace('// scope: changed-files', '// scope: Changed-Files')
      .replace('// runtime: node', '// runtime: Node');
    const parsed = parseScriptHeader(upper);
    expect(parsed.ok).toBe(true);
    expect(parsed.header?.kind).toBe('deterministic');
  });
});

describe('executeRuleScript', () => {
  it('runs a script and parses validated findings', () => {
    const root = createRoot();
    const scriptPath = join(root, 'no-debugger.mjs');
    write(scriptPath, NO_DEBUGGER_SCRIPT);
    write(join(root, 'sample.ts'), 'function f() {\n  debugger;\n}\n');

    const result = executeRuleScript(scriptPath, { projectRoot: root, files: ['sample.ts'] });
    expect(result.ok).toBe(true);
    expect(result.report?.findings).toHaveLength(1);
    expect(result.report?.findings[0].line).toBe(2);
  });

  it('reports a clear error when the script emits non-conforming JSON', () => {
    const root = createRoot();
    const scriptPath = join(root, 'bad.mjs');
    write(scriptPath, `process.stdout.write('{"nope":true}');`);
    const result = executeRuleScript(scriptPath, { projectRoot: root, files: [] });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/schema/);
  });

  it('honours valid findings even when the script exits non-zero (C-3)', () => {
    const root = createRoot();
    const scriptPath = join(root, 'exit-nonzero.mjs');
    // Linter convention: emit findings, then exit 1 to signal "violations found".
    write(
      scriptPath,
      `process.stdout.write(JSON.stringify({ rule_id: 'RL-7f3a', kind: 'deterministic', findings: [{ file: 'a.ts', message: 'x', severity: 'low' }] }));\nprocess.exit(1);`,
    );
    const result = executeRuleScript(scriptPath, { projectRoot: root, files: [] });
    expect(result.ok).toBe(true);
    expect(result.report?.findings).toHaveLength(1);
  });

  it('reports the exit code when a non-zero script emits no parseable findings', () => {
    const root = createRoot();
    const scriptPath = join(root, 'crash.mjs');
    write(scriptPath, `process.stderr.write('boom');\nprocess.exit(3);`);
    const result = executeRuleScript(scriptPath, { projectRoot: root, files: [] });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/exited 3/);
  });
});

describe('runFixtures (the gate)', () => {
  it('passes a correct script against pass/fail fixtures', () => {
    const root = createRoot();
    const scriptPath = join(root, '001-no-debugger.mjs');
    write(scriptPath, NO_DEBUGGER_SCRIPT);
    const fx = fixturesRoot(scriptPath);
    write(join(fx, 'pass', 'clean.ts'), 'function ok() {\n  return 1;\n}\n');
    write(join(fx, 'fail', 'leftover.ts'), 'function bad() {\n  debugger;\n}\n');

    const result = runFixtures(scriptPath);
    expect(result.missing_fixtures).toBe(false);
    expect(result.passed).toBe(true);
    expect(result.pass_fixtures).toBe(1);
    expect(result.fail_fixtures).toBe(1);
  });

  it('rejects a script that misclassifies its own fixtures', () => {
    const root = createRoot();
    const scriptPath = join(root, '001-no-debugger.mjs');
    write(scriptPath, NO_DEBUGGER_SCRIPT);
    const fx = fixturesRoot(scriptPath);
    // A "pass" fixture that actually contains a debugger -> script flags it ->
    // the gate must reject (pass folder must produce zero findings).
    write(join(fx, 'pass', 'wrong.ts'), 'debugger;\n');
    write(join(fx, 'fail', 'leftover.ts'), 'debugger;\n');

    const result = runFixtures(scriptPath);
    expect(result.passed).toBe(false);
    expect(result.failures.some((f) => f.fixture.startsWith('pass/'))).toBe(true);
  });

  it('rejects when no fixtures exist', () => {
    const root = createRoot();
    const scriptPath = join(root, '001-no-debugger.mjs');
    write(scriptPath, NO_DEBUGGER_SCRIPT);
    const result = runFixtures(scriptPath);
    expect(result.missing_fixtures).toBe(true);
    expect(result.passed).toBe(false);
  });

  it('defers (does not reject) when a declared binary is missing (D-4)', () => {
    const root = createRoot();
    const scriptPath = join(root, '001-needs-bin.mjs');
    const withReq = NO_DEBUGGER_SCRIPT.replace(
      '// runtime: node\n',
      '// runtime: node\n// requires: {"binaries":["definitely-not-a-real-binary-xyz"]}\n',
    );
    write(scriptPath, withReq);
    const fx = fixturesRoot(scriptPath);
    write(join(fx, 'pass', 'clean.ts'), 'ok\n');
    write(join(fx, 'fail', 'bad.ts'), 'debugger;\n');

    const result = runFixtures(scriptPath);
    expect(result.missing_binaries).toEqual(['definitely-not-a-real-binary-xyz']);
    expect(result.failures).toHaveLength(0); // not a logic failure
  });
});

describe('checkOverFlag', () => {
  it('flags a script that over-matches the in-scope files', () => {
    const root = createRoot();
    const scriptPath = join(root, 'greedy.mjs');
    // Greedy: flags every file regardless of content.
    write(
      scriptPath,
      `import { readFileSync } from 'node:fs';
const { files } = JSON.parse(readFileSync(0, 'utf8'));
const findings = files.map((f) => ({ file: f, message: 'x', severity: 'low' }));
process.stdout.write(JSON.stringify({ rule_id: 'RL-7f3a', kind: 'deterministic', findings }));`,
    );
    for (const f of ['a.ts', 'b.ts', 'c.ts', 'd.ts']) {
      write(join(root, f), 'noop\n');
    }
    const result = checkOverFlag(scriptPath, 'deterministic', root, [
      'a.ts',
      'b.ts',
      'c.ts',
      'd.ts',
    ]);
    expect(result.rate).toBe(1);
    expect(result.exceeded).toBe(true);
  });

  it('does not flag a well-behaved script and stays under the threshold', () => {
    const root = createRoot();
    const scriptPath = join(root, 'no-debugger.mjs');
    write(scriptPath, NO_DEBUGGER_SCRIPT);
    for (const f of ['a.ts', 'b.ts']) {
      write(join(root, f), 'const ok = 1;\n');
    }
    const result = checkOverFlag(scriptPath, 'deterministic', root, ['a.ts', 'b.ts']);
    expect(result.files_flagged).toBe(0);
    expect(result.rate).toBe(0);
    expect(result.exceeded).toBe(false);
  });

  it('reports a zero rate when there are no in-scope files', () => {
    const root = createRoot();
    const scriptPath = join(root, 'no-debugger.mjs');
    write(scriptPath, NO_DEBUGGER_SCRIPT);
    const result = checkOverFlag(scriptPath, 'heuristic', root, []);
    expect(result.files_checked).toBe(0);
    expect(result.rate).toBe(0);
    expect(result.exceeded).toBe(false);
  });
});

describe('missingBinaries', () => {
  it('returns [] for present binaries and names absent ones', () => {
    expect(missingBinaries(['node'])).toEqual([]);
    expect(missingBinaries(['definitely-not-a-real-binary-xyz'])).toEqual([
      'definitely-not-a-real-binary-xyz',
    ]);
    expect(missingBinaries(undefined)).toEqual([]);
  });
});
