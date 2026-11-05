import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runScript } from '../_helpers/run-script.js';

const SKILL = process.env.PAQAD_SKILL_UNDER_TEST ?? 'runtime/base/skills/development-recipe';
const SCRIPT = join(SKILL, 'scripts', 'check-ac-map.mjs');
const OUTPUT_LIMIT = 40_000;
const CANARY = 'canary-value-7f3a';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'check-ac-map-contract-'));
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

describe('check-ac-map.mjs contract', () => {
  const spec = (ids: string[]) =>
    JSON.stringify({ acceptance_criteria: ids.map((criterion_id) => ({ criterion_id })) });

  it('check-ac-map help', () => {
    const run = runScript(SCRIPT, ['--help']);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('usage: check-ac-map.mjs <specification.json> [project-root]');
  });

  it('check-ac-map invalid input', () => {
    expect(runScript(SCRIPT, []).status).toBe(2);
    const missing = runScript(SCRIPT, [join(dir, 'absent.json')]);
    expect(missing.status).toBe(2);
    expect(missing.stderr).toContain('file not found');
    expect(missing.stderr).toContain('a specification.json file');
    const bad = runScript(SCRIPT, [write('bad.json', '{not json'), dir]);
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain('not valid JSON');
  });

  it('check-ac-map fixture output', () => {
    write('a.test.ts', "it('AC-1: holds', () => {});\n");
    const file = write('spec.json', spec(['AC-1', 'AC-2']));
    const run = runScript(SCRIPT, [file, dir]);
    expect(run.status).toBe(1);
    expect(JSON.parse(run.stdout).errors).toEqual(['AC-2 has no test that names it']);
  });

  it('check-ac-map idempotency', () => {
    const file = write('spec.json', spec(['AC-1']));
    expect(runScript(SCRIPT, [file, dir])).toEqual(runScript(SCRIPT, [file, dir]));
  });

  it('check-ac-map dry run', () => {
    write('a.test.ts', "it('AC-1: holds', () => {});\n");
    const file = write('spec.json', spec(['AC-1']));
    const before = snapshot(dir);
    expect(runScript(SCRIPT, [file, dir]).status).toBe(0);
    expect(snapshot(dir)).toBe(before);
  });

  it('check-ac-map output size', () => {
    write('a.test.ts', 'nothing named here\n');
    const ids = Array.from({ length: 5_000 }, (_, index) => `AC-${index}`);
    const run = runScript(SCRIPT, [write('spec.json', spec(ids)), dir]);
    expect(run.status).toBe(1);
    expect(run.stdout.length).toBeLessThan(OUTPUT_LIMIT);
    expect(JSON.parse(run.stdout).errors.at(-1)).toBe('and 4900 more');
  });

  it('check-ac-map secrets', () => {
    write('a.test.ts', `const key = '${CANARY}';\n`);
    const leaky = JSON.stringify({
      acceptance_criteria: [{ criterion_id: 'AC-1', statement: `uses ${CANARY}` }],
    });
    const run = runScript(SCRIPT, [write('spec.json', leaky), dir]);
    expect(run.status).toBe(1);
    expect(run.stdout + run.stderr).not.toContain(CANARY);
  });
});
