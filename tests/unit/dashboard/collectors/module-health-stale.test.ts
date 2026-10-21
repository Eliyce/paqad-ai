import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import { collectModuleHealth } from '@/dashboard/collectors/module-health.js';

const MODULES = ['alpha', 'beta', 'gamma', 'delta', 'epsilon'];

describe('collectModuleHealth staleness against recent commits', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-mh-stale-'));
    const git = (...args: string[]): void => {
      execFileSync('git', args, { cwd: root, stdio: 'ignore' });
    };
    git('init', '-q');
    git('config', 'user.email', 't@example.com');
    git('config', 'user.name', 'T');
    for (const slug of MODULES) {
      mkdirSync(join(root, 'src', slug), { recursive: true });
      writeFileSync(join(root, 'src', slug, 'index.ts'), `export const ${slug} = 1;\n`);
    }
    git('add', '.');
    git('commit', '-q', '-m', 'init');

    mkdirSync(join(root, 'docs/instructions/rules'), { recursive: true });
    writeFileSync(
      join(root, PATHS.MODULE_MAP),
      [
        'modules:',
        ...MODULES.flatMap((slug) => [`  - slug: ${slug}`, `    sources: [src/${slug}]`]),
        '  - slug: bare',
        '    sources: []',
        '  - slug: quiet',
        '    sources: [src/never-touched]',
      ].join('\n'),
    );
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function health(file: string, entry: Record<string, unknown>): void {
    const dir = join(root, PATHS.PLANNING_MODULE_HEALTH_DIR);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, file), JSON.stringify(entry));
  }

  it('flags modules whose health predates their last commit and summarises the overflow', () => {
    for (const slug of MODULES) {
      health(`${slug}.json`, { module: slug, tier: 'stable', updated_at: '2020-01-01T00:00:00Z' });
    }
    health('bare.json', { module: 'bare', tier: 'stable' });
    health('quiet.json', { module: 'quiet', tier: 'stable' });
    health('unnamed.json', { tier: 'moderate' });

    const result = collectModuleHealth(root);

    expect([...result.staleModules].sort()).toEqual([...MODULES].sort());
    expect(result.attention.map((item) => item.message)).toContain(
      '2 more module(s) have stale health.',
    );
    expect(
      (result.section.details as { entries: { module: string }[] }).entries.map(
        (entry) => entry.module,
      ),
    ).toContain('unnamed');
  });

  it('treats health with no update time as stale once its sources are committed', () => {
    health('alpha.json', { module: 'alpha', tier: 'fragile' });
    expect(collectModuleHealth(root).staleModules).toEqual(['alpha']);
  });
});
