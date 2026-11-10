import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { computeHudHeadline } from '@/hud/snapshot.js';
import { writeStackArtifacts } from '@/stack-docs/generator.js';
import { moveBaselineToRun } from '@/rules-discovery/baseline.js';
import {
  clearNudgeState,
  computeRulesDriftNudge,
  rulesDriftHeadline,
  rulesDriftSessionStartText,
} from '@/rules-discovery/nudge.js';
import { RULES_DISCOVERY_NUDGE_STATE, STACK_SNAPSHOT_PATH } from '@/rules-discovery/paths.js';
import { openRun } from '@/rules-discovery/run-store.js';
import type { StackInventory } from '@/rules-discovery/types.js';
import type { StackSnapshot } from '@/core/types/introspection.js';

const NOW = new Date('2026-11-10T12:00:00Z');
const roots: string[] = [];

function snapshotOf(names: string[]): StackSnapshot {
  return {
    generated_at: '2026-11-01T00:00:00Z',
    source_hashes: {},
    toolchains: [],
    packages: names.map((name) => ({
      name,
      version_constraint: '^1.0.0',
      locked_version: '1.0.0',
      ecosystem: 'node',
      is_dev: false,
    })),
    profile: { frameworks: [], traits: [], toolchains: [], version_bands: [], sources: [] },
  };
}

function project(baseline: string[], deps: string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-rd-nudge-'));
  roots.push(root);
  const write = (path: string, body: string): void => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), body, 'utf8');
  };
  write(STACK_SNAPSHOT_PATH, JSON.stringify(snapshotOf(baseline)));
  setDeps(root, deps);
  return root;
}

function setDeps(root: string, deps: string[]): void {
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ dependencies: Object.fromEntries(deps.map((name) => [name, '^1.0.0'])) }),
  );
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('rules drift nudge', () => {
  it('AC-12: shows exactly one line with the real count and up to three names', () => {
    const root = project(['react'], ['react', 'zod', 'drizzle-orm', 'hono']);
    expect(rulesDriftSessionStartText(root, NOW)).toBe(
      "Your rules may be behind: 3 new packages (zod, drizzle-orm, hono). Say 'discover rules' to update them.",
    );
  });

  it('AC-13: does not show the same set again until the set changes or a run finishes', () => {
    const root = project(['react'], ['react', 'zod', 'drizzle-orm', 'hono']);
    expect(rulesDriftSessionStartText(root, NOW)).not.toBeNull();
    expect(rulesDriftSessionStartText(root, NOW)).toBeNull();
    expect(rulesDriftSessionStartText(root, NOW)).toBeNull();
    clearNudgeState(root);
    expect(rulesDriftSessionStartText(root, NOW)).not.toBeNull();
  });

  it('AC-14: shows nothing when no package was added or only packages were removed', () => {
    expect(rulesDriftSessionStartText(project(['react'], ['react']), NOW)).toBeNull();
    expect(rulesDriftSessionStartText(project(['react', 'zod'], ['react']), NOW)).toBeNull();
  });

  it('AC-15: one name for one package, count 5 with three names, and again for a swapped set', () => {
    expect(rulesDriftSessionStartText(project([], ['zod']), NOW)).toBe(
      "Your rules may be behind: 1 new package (zod). Say 'discover rules' to update them.",
    );
    const root = project([], ['a1', 'b2', 'c3', 'd4', 'e5']);
    expect(rulesDriftSessionStartText(root, NOW)).toBe(
      "Your rules may be behind: 5 new packages (a1, b2, c3). Say 'discover rules' to update them.",
    );
    setDeps(root, ['a1', 'b2', 'c3', 'd4', 'f6']);
    expect(rulesDriftSessionStartText(root, NOW)).toBe(
      "Your rules may be behind: 5 new packages (a1, b2, c3). Say 'discover rules' to update them.",
    );
  });

  it('AC-17: still shows the packages after a documentation run rewrote the stack snapshot', async () => {
    const root = project(['react'], ['react', 'zod']);
    expect(computeRulesDriftNudge(root, NOW)?.names).toEqual(['zod']);
    await writeStackArtifacts(root, snapshotOf(['react', 'zod']), snapshotOf(['react']));
    const stored = JSON.parse(readFileSync(join(root, STACK_SNAPSHOT_PATH), 'utf8')) as {
      packages: Array<{ name: string }>;
    };
    expect(stored.packages.map((pkg) => pkg.name)).toContain('zod');
    expect(computeRulesDriftNudge(root, NOW)?.names).toEqual(['zod']);
  });

  it('AC-18: tells the developer to continue an open run instead of starting one', () => {
    const root = project(['react'], ['react', 'zod']);
    openRun(root, NOW);
    expect(rulesDriftSessionStartText(root, NOW)).toBe(
      "Your rules may be behind: 1 new package (zod). A rules discovery run is open: say 'discover rules' to continue it.",
    );
  });

  it('AC-19: leaves out invalid or overlong names but still counts them', () => {
    const long = `a${'b'.repeat(64)}`;
    const root = project([], ['zod', 'Bad Name; rm -rf', long]);
    const nudge = computeRulesDriftNudge(root, NOW);
    expect(nudge?.count).toBe(3);
    expect(nudge?.names).toEqual(['zod']);
    expect(nudge?.line).toContain('3 new packages (zod)');
  });

  it('clears after a finished run moves the baseline and shows the line in the HUD meanwhile', () => {
    const root = project(['react'], ['react', 'zod']);
    rulesDriftSessionStartText(root, NOW);
    const headline = rulesDriftHeadline(root);
    expect(headline).toContain('Your rules may be behind');
    expect(
      computeHudHeadline({
        route: null,
        active: false,
        stages: [],
        pendingDecisions: 0,
        verdict: null,
        flags: [],
        paused: 0,
        rulesDrift: headline,
      }).text,
    ).toBe(headline);
    const inventory = {
      run_id: 'rd-20261110-120000',
      packages: [
        {
          name: 'react',
          ecosystem: 'node',
          declared: '^1.0.0',
          installed: null,
          dev: false,
          status: 'unchanged',
        },
        {
          name: 'zod',
          ecosystem: 'node',
          declared: '^1.0.0',
          installed: null,
          dev: false,
          status: 'new',
        },
      ],
    } as unknown as StackInventory;
    moveBaselineToRun(root, inventory, NOW);
    expect(rulesDriftSessionStartText(root, NOW)).toBeNull();
    expect(rulesDriftHeadline(root)).toBeNull();
    expect(readFileSync(join(root, RULES_DISCOVERY_NUDGE_STATE), 'utf8')).toContain('"line": ""');
  });
});
