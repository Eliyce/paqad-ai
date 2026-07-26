// Issue #398, AC-4 — the plan-compile gate treats a PHP, Python or JVM framework claim
// exactly as it treats a JS/TS one. There is no new gate code to prove: the point of the
// adapter contract is that the verifier Phase B (#397) already ships is ecosystem-agnostic,
// so this suite is the evidence that it really is, per ecosystem.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  FRAMEWORK_API_INDEX_ABSENT_WARNING,
  validateReuseSection,
  type PlanReuse,
} from '@/feature-evidence/reuse.js';
import { writeFrameworkApiIndex } from '@/framework-api/store.js';
import { FRAMEWORK_API_SCHEMA_VERSION, type FrameworkApiSymbol } from '@/framework-api/types.js';

const roots: string[] = [];
function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-framework-multi-'));
  roots.push(root);
  return root;
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

interface Case {
  ecosystem: 'php' | 'python' | 'jvm';
  package: string;
  version: string;
  /** The symbol the index resolves. */
  live: string;
  /** How a plan would spell that symbol. */
  claim: string;
  /** A symbol the index carries a deprecation for. */
  deprecated: string;
  /** A member covered only by a wildcard container. */
  dynamic: string;
  /** A symbol that genuinely is not there, with the suggestion it should draw. */
  absent: string;
  nearest: string;
}

const CASES: Case[] = [
  {
    ecosystem: 'php',
    package: 'laravel/framework',
    version: '13.18.0',
    live: 'Illuminate\\Support\\Str::random',
    claim: 'Str::random',
    deprecated: 'Illuminate\\Support\\Str::of',
    dynamic: 'Str::someMacro',
    absent: 'Illuminate\\Support\\Strr',
    nearest: 'Illuminate\\Support\\Str',
  },
  {
    ecosystem: 'python',
    package: 'flask',
    version: '3.1.2',
    live: 'flask.Flask',
    claim: 'Flask',
    deprecated: 'flask.escape',
    dynamic: 'flask.something_dynamic',
    // Unqualified on purpose: every Python module carries a wildcard, so `flask.anything`
    // is `unknown-dynamic` by design and only a bare name can be asserted absent (INV-1).
    absent: 'Flaskk',
    nearest: 'flask.Flask',
  },
  {
    ecosystem: 'jvm',
    package: 'org.springframework.boot:spring-boot',
    version: '3.5.0',
    live: 'org.springframework.boot.SpringApplication',
    claim: 'SpringApplication',
    deprecated: 'org.springframework.boot.SpringApplication.setWebEnvironment',
    dynamic: 'org.springframework.boot.SpringApplication.whateverElse',
    absent: 'org.springframework.boot.SpringApplicationn',
    nearest: 'org.springframework.boot.SpringApplication',
  },
];

function symbol(overrides: Partial<FrameworkApiSymbol> & { name: string }): FrameworkApiSymbol {
  return {
    kind: 'function',
    exists: true,
    deprecated: false,
    message: null,
    since: null,
    for_removal: false,
    provenance: 'asserted',
    ...overrides,
  };
}

/** A snapshot whose locked version agrees with the claim, so Phase A (#357) passes. */
function withSnapshot(root: string, entry: Case): void {
  const target = join(root, '.paqad/stack-snapshot.json');
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(
    target,
    JSON.stringify({
      generated_at: '2026-07-26T00:00:00.000Z',
      source_hashes: {},
      toolchains: [],
      packages: [
        {
          name: entry.package,
          version_constraint: `^${entry.version}`,
          locked_version: entry.version,
          ecosystem: entry.ecosystem,
          is_dev: false,
        },
      ],
      profile: { frameworks: [], traits: [], toolchains: [], version_bands: [], sources: [] },
    }),
    'utf8',
  );
}

/** The index an adapter for this ecosystem would have produced. */
function withIndex(root: string, entry: Case): void {
  writeFrameworkApiIndex(root, {
    schema_version: FRAMEWORK_API_SCHEMA_VERSION,
    header: { generated_at: '2026-07-26T00:00:00.000Z', schema_version: 1 },
    packages: [
      {
        package: entry.package,
        version: entry.version,
        ecosystem: entry.ecosystem,
        root: '.',
        content_hash: 'sha256:test',
        sources: [],
        symbols: [
          symbol({ name: entry.live }),
          symbol({ name: entry.nearest }),
          symbol({
            name: entry.deprecated,
            deprecated: true,
            message: 'gone in the next major.',
            since: '12.0',
          }),
          symbol({
            name: `${entry.dynamic.slice(0, entry.dynamic.lastIndexOf(entry.dynamic.includes('::') ? '::' : '.'))}.*`,
            kind: 'member',
            provenance: 'unknown-dynamic',
          }),
        ],
      },
    ],
    blocked: [],
  });
}

function claiming(entry: Case, symbolName: string): PlanReuse {
  return {
    consulted: [
      {
        source: 'framework-api',
        query: symbolName,
        target: `${entry.package}@${entry.version}`,
        hits: 1,
      },
    ],
    reusing: [
      { symbol: symbolName, how: 'call as-is', package: entry.package, version: entry.version },
    ],
    new_constructs: [],
  };
}

describe.each(CASES)('AC-4 — the $ecosystem gate', (entry) => {
  it('passes a symbol that resolves at the installed version, however the plan spells it', () => {
    const root = tempRoot();
    withSnapshot(root, entry);
    withIndex(root, entry);
    for (const spelling of [entry.live, entry.claim]) {
      const result = validateReuseSection({
        projectRoot: root,
        reuse: claiming(entry, spelling),
        steps: [],
      });
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([]);
    }
  });

  it('blocks a deprecated symbol with the reason', () => {
    const root = tempRoot();
    withSnapshot(root, entry);
    withIndex(root, entry);
    const result = validateReuseSection({
      projectRoot: root,
      reuse: claiming(entry, entry.deprecated),
      steps: [],
    });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('is deprecated in');
    expect(result.errors[0]).toContain('gone in the next major.');
  });

  it('blocks an absent symbol and suggests the nearest one', () => {
    const root = tempRoot();
    withSnapshot(root, entry);
    withIndex(root, entry);
    const result = validateReuseSection({
      projectRoot: root,
      reuse: claiming(entry, entry.absent),
      steps: [],
    });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('does not exist in');
    expect(result.errors[0]).toContain(entry.nearest);
  });

  it('only warns for a member the container provides dynamically (INV-1)', () => {
    const root = tempRoot();
    withSnapshot(root, entry);
    withIndex(root, entry);
    const result = validateReuseSection({
      projectRoot: root,
      reuse: claiming(entry, entry.dynamic),
      steps: [],
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings[0]).toContain('provided dynamically');
  });

  it('only warns when no index has been built at all', () => {
    const root = tempRoot();
    withSnapshot(root, entry);
    const result = validateReuseSection({
      projectRoot: root,
      reuse: claiming(entry, entry.live),
      steps: [],
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings).toContain(FRAMEWORK_API_INDEX_ABSENT_WARNING);
  });
});
