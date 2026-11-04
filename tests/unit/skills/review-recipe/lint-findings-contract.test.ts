import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runScript } from '../_helpers/run-script.js';

const SKILL = process.env.PAQAD_SKILL_UNDER_TEST ?? 'runtime/base/skills/review-recipe';
const SCRIPT = join(SKILL, 'scripts', 'lint-findings.mjs');
const OUTPUT_LIMIT = 40_000;
const CANARY = 'canary-value-7f3a';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lint-findings-contract-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function snapshot(folder: string): string {
  return readdirSync(folder)
    .sort()
    .map((name) => {
      const path = join(folder, name);
      return `${name}:${statSync(path).mtimeMs}:${readFileSync(path, 'utf8')}`;
    })
    .join('\n');
}

function write(name: string, text: string): string {
  const path = join(dir, name);
  writeFileSync(path, text);
  return path;
}

describe('lint-findings.mjs contract', () => {
  const GOOD = '## Findings\n\n- **High**: bad. Required action: fix.\n';

  it('lint-findings help', () => {
    const run = runScript(SCRIPT, ['--help']);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('usage: lint-findings.mjs <review-template.json | findings.md>');
  });

  it('lint-findings invalid input', () => {
    expect(runScript(SCRIPT, []).status).toBe(2);
    const missing = runScript(SCRIPT, [join(dir, 'absent.md')]);
    expect(missing.status).toBe(2);
    expect(missing.stderr).toContain('file not found');
    expect(missing.stderr).toContain('a review template JSON or findings Markdown file');
    const bad = runScript(SCRIPT, [write('bad.json', '{not json')]);
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain('not valid JSON');
  });

  it('lint-findings fixture output', () => {
    expect(JSON.parse(runScript(SCRIPT, [write('good.md', GOOD)]).stdout).ok).toBe(true);
    const text = '## Findings\n\n- **Low**: a. Required action: x.\n- **High**: b.\n- none\n';
    const run = runScript(SCRIPT, [write('bad.md', text)]);
    expect(run.status).toBe(1);
    expect(JSON.parse(run.stdout).errors).toEqual([
      'severity out of order at: finding 2',
      "finding 2 has no 'Required action:' segment",
      'finding 3 has no severity tag',
    ]);
  });

  it('lint-findings idempotency', () => {
    const file = write('good.md', GOOD);
    expect(runScript(SCRIPT, [file])).toEqual(runScript(SCRIPT, [file]));
  });

  it('lint-findings dry run', () => {
    const file = write('good.md', GOOD);
    const before = snapshot(dir);
    expect(runScript(SCRIPT, [file], { cwd: dir }).status).toBe(0);
    expect(snapshot(dir)).toBe(before);
  });

  it('lint-findings output size', () => {
    const findings = Array.from({ length: 5_000 }, () => ({ severity: 'minor' }));
    const run = runScript(SCRIPT, [write('huge.json', JSON.stringify({ findings }))]);
    expect(run.status).toBe(1);
    expect(run.stdout.length).toBeLessThan(OUTPUT_LIMIT);
    expect(JSON.parse(run.stdout).errors.at(-1)).toBe('and 4900 more');
  });

  it('lint-findings secrets', () => {
    const text = `## Findings\n\n- the key ${CANARY} leaked\n- **High**: ${CANARY}\n`;
    const run = runScript(SCRIPT, [write('leaky.md', text)]);
    expect(run.status).toBe(1);
    expect(run.stdout + run.stderr).not.toContain(CANARY);
  });
});
