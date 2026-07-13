import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  computeDependencyUsage,
  packageNameFromSpecifier,
} from '@/code-knowledge/dependency-usage.js';

describe('packageNameFromSpecifier', () => {
  it.each([
    ['chalk', 'chalk'],
    ['chalk/foo', 'chalk'],
    ['@scope/pkg', '@scope/pkg'],
    ['@scope/pkg/sub', '@scope/pkg'],
  ])('%s -> %s', (spec, expected) => {
    expect(packageNameFromSpecifier(spec)).toBe(expected);
  });

  it.each([['./rel'], ['../up'], ['/abs'], ['node:fs'], ['@/alias'], ['@nogroup'], ['']])(
    'returns null for %s',
    (spec) => {
      expect(packageNameFromSpecifier(spec)).toBeNull();
    },
  );
});

describe('computeDependencyUsage', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-dep-usage-'));
    mkdirSync(join(root, 'src'), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('marks a dependency imported when a file imports it, and unused when none do (AC-3)', async () => {
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        dependencies: { chalk: '^5.0.0', 'left-pad': '^1.0.0', '@scope/used': '^1.0.0' },
      }),
    );
    const appBody = 'import chalk from "chalk";\nimport { x } from "@scope/used/sub";\n';
    writeFileSync(join(root, 'src', 'app.ts'), appBody);
    const contentByFile = new Map([['src/app.ts', appBody]]);

    const deps = await computeDependencyUsage(root, ['src/app.ts'], contentByFile);
    const byName = new Map(deps.map((d) => [d.name, d]));

    expect(byName.get('chalk')).toMatchObject({ imported: true, ecosystem: 'node' });
    expect(byName.get('@scope/used')).toMatchObject({ imported: true });
    expect(byName.get('left-pad')).toMatchObject({ imported: false });
  });

  it('ignores relative imports when deciding usage', async () => {
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ dependencies: { chalk: '^5.0.0' } }),
    );
    const body = 'import { helper } from "./helper.js";\n';
    writeFileSync(join(root, 'src', 'a.ts'), body);

    const deps = await computeDependencyUsage(root, ['src/a.ts'], new Map([['src/a.ts', body]]));
    expect(deps.find((d) => d.name === 'chalk')?.imported).toBe(false);
  });

  it('skips files absent from the content map', async () => {
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ dependencies: { chalk: '^5.0.0' } }),
    );
    const deps = await computeDependencyUsage(root, ['src/missing.ts'], new Map());
    expect(deps.find((d) => d.name === 'chalk')?.imported).toBe(false);
  });

  it('returns an empty list when there is no manifest', async () => {
    const deps = await computeDependencyUsage(root, [], new Map());
    expect(deps).toEqual([]);
  });

  it('does not scan non-TS/JS files for usage', async () => {
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ dependencies: { chalk: '^5.0.0' } }),
    );
    // A markdown file that merely mentions "chalk" must not count as an import.
    const md = 'see chalk for colors';
    writeFileSync(join(root, 'README.md'), md);
    const deps = await computeDependencyUsage(root, ['README.md'], new Map([['README.md', md]]));
    expect(deps.find((d) => d.name === 'chalk')?.imported).toBe(false);
  });
});
