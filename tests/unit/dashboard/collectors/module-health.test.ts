import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { collectModuleHealth } from '@/dashboard/collectors/module-health';

const NOW = Date.UTC(2026, 4, 26);

function writeHealth(root: string, module: string, tier: string, daysOld: number): void {
  const dir = join(root, '.paqad/module-health');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${module}.json`),
    JSON.stringify({
      module,
      tier,
      updated_at: new Date(NOW - daysOld * 86_400_000).toISOString(),
    }),
  );
}

describe('collectModuleHealth', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-dash-mh-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns unknown when the directory is absent', () => {
    const { section } = collectModuleHealth(root, NOW);
    expect(section.band).toBe('unknown');
  });

  it('returns unknown when the directory is empty', () => {
    mkdirSync(join(root, '.paqad/module-health'), { recursive: true });
    const { section } = collectModuleHealth(root, NOW);
    expect(section.band).toBe('unknown');
  });

  it('scores green for an all-stable, fresh population', () => {
    writeHealth(root, 'a', 'stable', 1);
    writeHealth(root, 'b', 'stable', 2);
    const { section, attention } = collectModuleHealth(root, NOW);
    expect(section.score).toBe(100);
    expect(section.band).toBe('green');
    expect(attention).toEqual([]);
  });

  it('emits critical attention items for fragile modules', () => {
    writeHealth(root, 'payments', 'fragile', 1);
    writeHealth(root, 'core', 'stable', 1);
    const { section, attention } = collectModuleHealth(root, NOW);
    expect(attention.length).toBe(1);
    expect(attention[0]?.message).toMatch(/payments/);
    expect(attention[0]?.severity).toBe('critical');
    // Tier average: (100 + 25)/2 = 62.5 → 63 (rounded).
    expect(section.score).toBe(63);
    expect(section.band).toBe('amber');
  });

  it('penalises stale entries beyond the fresh window', () => {
    writeHealth(root, 'a', 'stable', 1);
    writeHealth(root, 'b', 'stable', 60); // 30d penalty cap is 20 → score 80
    const { section } = collectModuleHealth(root, NOW);
    expect(section.score).toBe(80);
  });

  it('flags modules whose health updated_at predates a recent source commit', () => {
    // Stand up a real git repo so lastCommitTouchingSources() can resolve.
    const git = (args: string[]): void => {
      execFileSync('git', args, {
        cwd: root,
        stdio: ['ignore', 'ignore', 'ignore'],
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 'test',
          GIT_AUTHOR_EMAIL: 'test@example.com',
          GIT_COMMITTER_NAME: 'test',
          GIT_COMMITTER_EMAIL: 'test@example.com',
        },
      });
    };
    git(['init', '-q']);
    mkdirSync(join(root, 'src/payments'), { recursive: true });
    writeFileSync(join(root, 'src/payments/index.ts'), 'export {}');
    // module-map.yml declares the payments module so the collector can look
    // its sources up.
    mkdirSync(join(root, 'docs/instructions/rules'), { recursive: true });
    writeFileSync(
      join(root, 'docs/instructions/rules/module-map.yml'),
      [
        'modules:',
        '  - slug: payments',
        '    name: Payments',
        '    sources:',
        '      - src/payments/**',
        '    features: []',
        '',
      ].join('\n'),
    );
    git(['add', '.']);
    git(['commit', '-q', '-m', 'init payments']);

    // Stale module-health entry — updated long before the commit above.
    const dir = join(root, '.paqad/module-health');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'payments.json'),
      JSON.stringify({
        module: 'payments',
        tier: 'stable',
        updated_at: '2020-01-01T00:00:00Z',
      }),
    );

    const { staleModules, attention, section } = collectModuleHealth(root, Date.now());
    expect(staleModules).toEqual(['payments']);
    expect(attention.some((a) => a.message.includes('payments'))).toBe(true);
    // 100 tier - 20 freshness cliff (updated_at far past 30d) - 5 stale
    // signal penalty = 75. Both penalties are exercised here.
    expect(section.score).toBe(75);
  });

  it('ignores entries with unrecognised tier values', () => {
    writeHealth(root, 'a', 'stable', 1);
    writeHealth(root, 'b', 'wobbly' as unknown as string, 1);
    const { section } = collectModuleHealth(root, NOW);
    // 'wobbly' falls through to 'unknown' which weighs 0.
    expect(section.score).toBe(50);
  });

  it('skips a malformed entry and dates an entry without updated_at by mtime', () => {
    writeHealth(root, 'a', 'stable', 1);
    const dir = join(root, '.paqad/module-health');
    writeFileSync(join(dir, 'bad.json'), '{bad json'); // unparseable → skipped
    writeFileSync(join(dir, 'c.json'), JSON.stringify({ module: 'c', tier: 'stable' })); // no updated_at → mtime
    const { section } = collectModuleHealth(root, NOW);
    // 'a' + 'c' counted (both stable), 'bad' skipped → still a real score.
    expect(section.score).toBe(100);
    expect(section.metrics.find((m) => m.label === 'stable')?.value).toBe('2');
  });
});
