import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runScript } from '../_helpers/run-script.js';

const SKILL = process.env.PAQAD_SKILL_UNDER_TEST ?? 'runtime/base/skills/planning-recipe';
const SCRIPT = join(SKILL, 'scripts', 'check-plan.mjs');
const OUTPUT_LIMIT = 40_000;
const CANARY = 'canary-value-7f3a';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'check-plan-contract-'));
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

describe('check-plan.mjs contract', () => {
  const GOOD = JSON.stringify({
    reuse: { consulted: [{ query: 'x' }] },
    steps: [{ id: 'S1', classification: 'ac-satisfying' }],
  });

  it('check-plan help', () => {
    const run = runScript(SCRIPT, ['--help']);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('usage: check-plan.mjs <plan-template.json>');
  });

  it('check-plan invalid input', () => {
    expect(runScript(SCRIPT, []).status).toBe(2);
    const missing = runScript(SCRIPT, [join(dir, 'absent.json')]);
    expect(missing.status).toBe(2);
    expect(missing.stderr).toContain('file not found');
    expect(missing.stderr).toContain('a plan template JSON file');
    const bad = runScript(SCRIPT, [write('bad.json', '{not json')]);
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain('not valid JSON');
    expect(bad.stdout).toBe('');
    const scalar = runScript(SCRIPT, [write('null.json', 'null')]);
    expect(scalar.status).toBe(1);
    expect(scalar.stderr).toContain('not a JSON object');
  });

  it('check-plan fixture output', () => {
    const good = JSON.parse(runScript(SCRIPT, [write('good.json', GOOD)]).stdout);
    expect(good.ok).toBe(true);
    expect(good.errors).toEqual([]);
    expect(good.hash).toMatch(/^[0-9a-f]{64}$/u);
    const run = runScript(SCRIPT, [
      write('no-verdict.json', JSON.stringify({ steps: [{ id: 'S1' }] })),
    ]);
    expect(run.status).toBe(1);
    expect(JSON.parse(run.stdout).errors).toEqual([
      'the plan has no reuse section with a consulted list',
      expect.stringContaining('S1 has no keep-or-drop verdict'),
    ]);
  });

  it('check-plan idempotency', () => {
    const file = write('good.json', GOOD);
    expect(runScript(SCRIPT, [file])).toEqual(runScript(SCRIPT, [file]));
  });

  it('check-plan dry run', () => {
    write('good.json', GOOD);
    const before = snapshot(dir);
    expect(runScript(SCRIPT, [join(dir, 'good.json')], { cwd: dir }).status).toBe(0);
    expect(snapshot(dir)).toBe(before);
  });

  it('check-plan output size', () => {
    const steps = Array.from({ length: 5_000 }, (_, index) => ({ id: `S${index}` }));
    const run = runScript(SCRIPT, [write('huge.json', JSON.stringify({ steps }))]);
    expect(run.status).toBe(1);
    expect(run.stdout.length).toBeLessThan(OUTPUT_LIMIT);
    expect(JSON.parse(run.stdout).errors.at(-1)).toBe('and 4901 more');
  });

  it('check-plan secrets', () => {
    const leaky = { steps: [{ id: 'S1', description: `rotate ${CANARY}`, files: [CANARY] }] };
    const run = runScript(SCRIPT, [write('leaky.json', JSON.stringify(leaky))]);
    expect(run.status).toBe(1);
    expect(run.stdout + run.stderr).not.toContain(CANARY);
  });
});
