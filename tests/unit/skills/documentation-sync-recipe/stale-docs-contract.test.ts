import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runScript } from '../_helpers/run-script.js';

const SKILL = process.env.PAQAD_SKILL_UNDER_TEST ?? 'runtime/base/skills/documentation-sync-recipe';
const SCRIPT = join(SKILL, 'scripts', 'stale-docs.mjs');
const OUTPUT_LIMIT = 40_000;
const CANARY = 'canary-value-7f3a';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'stale-docs-contract-'));
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

describe('stale-docs.mjs contract', () => {
  function project(): string {
    mkdirSync(join(dir, 'docs/modules/billing'), { recursive: true });
    writeFileSync(join(dir, 'docs/modules/billing/summary.md'), 'doc');
    return dir;
  }

  it('stale-docs help', () => {
    const run = runScript(SCRIPT, ['--help']);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('[project-root] [--ok <doc>]');
  });

  it('stale-docs invalid input', () => {
    const noValue = runScript(SCRIPT, [dir, '--ok'], { input: '' });
    expect(noValue.status).toBe(2);
    expect(noValue.stderr).toContain('expected [project-root]');
    const unknown = runScript(SCRIPT, ['--nope'], { input: '' });
    expect(unknown.status).toBe(2);
    const absent = runScript(SCRIPT, [join(dir, 'absent')], { input: '' });
    expect(absent.status).toBe(2);
    expect(absent.stderr).toContain('project root not found');
  });

  it('stale-docs fixture output', () => {
    const root = project();
    const run = runScript(SCRIPT, [root], { input: 'src/billing/invoice.ts\n' });
    expect(run.status).toBe(1);
    expect(JSON.parse(run.stdout).stale).toEqual(['docs/modules/billing/summary.md']);
    const kept = runScript(SCRIPT, [root, '--ok', 'docs/modules/billing/summary.md'], {
      input: 'src/billing/invoice.ts\n',
    });
    expect(kept.status).toBe(0);
    expect(JSON.parse(kept.stdout).ok).toBe(true);
    expect(runScript(SCRIPT, [root], { input: '' }).status).toBe(0);
  });

  it('stale-docs idempotency', () => {
    const root = project();
    const input = 'src/billing/invoice.ts\n';
    expect(runScript(SCRIPT, [root], { input })).toEqual(runScript(SCRIPT, [root], { input }));
  });

  it('stale-docs dry run', () => {
    const root = project();
    const folder = join(root, 'docs/modules/billing');
    const before = snapshot(folder);
    expect(runScript(SCRIPT, [root], { input: 'src/billing/invoice.ts\n' }).status).toBe(1);
    expect(snapshot(folder)).toBe(before);
  });

  it('stale-docs output size', () => {
    const names = Array.from({ length: 200 }, (_, index) => `mod${index}`);
    for (const name of names) {
      mkdirSync(join(dir, 'docs/modules', name), { recursive: true });
      writeFileSync(join(dir, 'docs/modules', name, 'summary.md'), 'doc');
    }
    const input = names.map((name) => `src/${name}/a.ts`).join('\n');
    const run = runScript(SCRIPT, [dir], { input });
    expect(run.status).toBe(1);
    expect(run.stdout.length).toBeLessThan(OUTPUT_LIMIT);
    expect(JSON.parse(run.stdout).errors.at(-1)).toBe('and 100 more');
  });

  it('stale-docs secrets', () => {
    const root = project();
    writeFileSync(join(root, 'docs/modules/billing/summary.md'), CANARY);
    const run = runScript(SCRIPT, [root], {
      input: `src/billing/${CANARY}-free.ts\nsrc/billing/a.ts\n`,
    });
    expect(run.status).toBe(1);
    expect(run.stdout + run.stderr).not.toContain(CANARY);
  });
});
