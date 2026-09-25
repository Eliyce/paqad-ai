// Issue #581 (AC-22, INV-1) — no code other than the migration module names the retired
// per-feature spec scratch folder. The pattern is pinned with a boundary on purpose: a bare
// `_specs` search also matches the unrelated `consumer_specs` field in src/compliance/boundary,
// so only the folder path or a quoted `_specs` literal counts.

import { readdirSync, readFileSync, statSync } from 'node:fs';

import { join, relative, resolve } from 'pathe';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '../../..');
const SCANNED = ['src', 'runtime/hooks'];
const ALLOWED = ['src/feature-evidence/migrate.ts'];
const SPECS_FOLDER_PATTERN = /\.paqad\/_specs|['"`]_specs\b/;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) out.push(...sourceFiles(abs));
    else if (/\.(?:ts|tsx|mts|mjs|js|cjs)$/.test(name)) out.push(abs);
  }
  return out;
}

describe('the retired spec scratch folder in the source tree (AC-22)', () => {
  it('is named only by the migration module', () => {
    const hits = SCANNED.flatMap((dir) => sourceFiles(join(REPO_ROOT, dir)))
      .filter((file) => SPECS_FOLDER_PATTERN.test(readFileSync(file, 'utf8')))
      .map((file) => relative(REPO_ROOT, file))
      .sort();
    expect(hits).toEqual(ALLOWED);
  });

  it('does not report the unrelated consumer_specs field', () => {
    expect(SPECS_FOLDER_PATTERN.test('const consumer_specs = [];')).toBe(false);
    expect(SPECS_FOLDER_PATTERN.test("entry.consumer_specs ?? '_x'")).toBe(false);
    expect(SPECS_FOLDER_PATTERN.test("join('.paqad', '_specs')")).toBe(true);
    expect(SPECS_FOLDER_PATTERN.test('".paqad/_specs/x"')).toBe(true);
  });
});
