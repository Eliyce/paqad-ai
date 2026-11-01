import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..', '..');
const AUTHORING = join(ROOT, 'src', 'authoring');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith('.ts') ? [path] : [];
  });
}

const STAGE_ISOLATION_IMPORT = /from\s+['"](?:@\/stage-isolation\/|(?:\.\.\/)+stage-isolation\/)/u;

describe('INV-17: one import direction, stage-isolation to authoring', () => {
  it('INV-17: no src/authoring file imports from src/stage-isolation', () => {
    const offenders = sourceFiles(AUTHORING)
      .filter((file) => STAGE_ISOLATION_IMPORT.test(readFileSync(file, 'utf8')))
      .map((file) => relative(ROOT, file));
    expect(offenders).toEqual([]);
  });
});
