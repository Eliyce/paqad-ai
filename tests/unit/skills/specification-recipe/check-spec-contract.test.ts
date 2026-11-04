import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runScript } from '../_helpers/run-script.js';

const SKILL = process.env.PAQAD_SKILL_UNDER_TEST ?? 'runtime/base/skills/specification-recipe';
const SCRIPT = join(SKILL, 'scripts', 'check-spec.mjs');
const OUTPUT_LIMIT = 40_000;
const CANARY = 'canary-value-7f3a';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'check-spec-contract-'));
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

describe('check-spec.mjs contract', () => {
  const GOOD = [
    '## Acceptance criteria',
    '',
    '- AC-1: Given a plan, when it compiles, then it passes (proof: automated).',
    '',
    '## Edge cases',
    '',
    '- empty: none',
    '',
  ].join('\n');

  it('check-spec help', () => {
    const run = runScript(SCRIPT, ['--help']);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('usage: check-spec.mjs <spec.md>');
  });

  it('check-spec invalid input', () => {
    expect(runScript(SCRIPT, []).status).toBe(2);
    const missing = runScript(SCRIPT, [join(dir, 'absent.md')]);
    expect(missing.status).toBe(2);
    expect(missing.stderr).toContain('file not found');
    expect(missing.stderr).toContain('a spec Markdown file');
  });

  it('check-spec fixture output', () => {
    const good = JSON.parse(runScript(SCRIPT, [write('good.md', GOOD)]).stdout);
    expect(good.ok).toBe(true);
    expect(good.hash).toMatch(/^[0-9a-f]{64}$/u);
    const bad = '## Acceptance criteria\n\n- AC-1.a: it works\n- AC-1.a: again\n';
    const run = runScript(SCRIPT, [write('bad.md', bad)]);
    expect(run.status).toBe(1);
    expect(JSON.parse(run.stdout).errors).toEqual([
      'AC-1.a is not a flat AC-N id',
      'AC-1.a is not in given, when, then form',
      'AC-1.a is not a flat AC-N id',
      'AC-1.a appears twice',
      'AC-1.a is not in given, when, then form',
      'the spec has no "## Edge cases" section',
    ]);
  });

  it('check-spec idempotency', () => {
    const file = write('good.md', GOOD);
    expect(runScript(SCRIPT, [file])).toEqual(runScript(SCRIPT, [file]));
  });

  it('check-spec dry run', () => {
    const file = write('good.md', GOOD);
    const before = snapshot(dir);
    expect(runScript(SCRIPT, [file], { cwd: dir }).status).toBe(0);
    expect(snapshot(dir)).toBe(before);
  });

  it('check-spec output size', () => {
    const lines = Array.from({ length: 5_000 }, (_, index) => `- AC-${index}: no form`);
    const run = runScript(SCRIPT, [
      write('huge.md', `## Acceptance criteria\n\n${lines.join('\n')}\n`),
    ]);
    expect(run.status).toBe(1);
    expect(run.stdout.length).toBeLessThan(OUTPUT_LIMIT);
    expect(JSON.parse(run.stdout).errors.at(-1)).toBe('and 4901 more');
  });

  it('check-spec secrets', () => {
    const leaky = `## Acceptance criteria\n\n- AC-1: the key ${CANARY} leaks\n`;
    const run = runScript(SCRIPT, [write('leaky.md', leaky)]);
    expect(run.status).toBe(1);
    expect(run.stdout + run.stderr).not.toContain(CANARY);
  });
});
