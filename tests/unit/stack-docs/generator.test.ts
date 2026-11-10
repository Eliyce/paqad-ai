import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import type { StackDriftReport, StackSnapshot } from '@/core/types/introspection.js';
import {
  PURPOSE_MAX,
  packagePurpose,
  refreshStackDocsFromInventory,
  writeStackArtifacts,
} from '@/stack-docs/generator.js';

describe('writeStackArtifacts', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-stack-docs-'));
    mkdirSync(join(root, '.paqad'), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('writes machine artifacts without human docs and preserves an existing no-drift report', async () => {
    const snapshot = buildSnapshot({
      frameworks: ['laravel'],
      versionBands: [
        {
          name: 'laravel/framework:^12',
          package_name: 'laravel/framework',
          range: '^12',
          locked_version: 'v12.1.0',
          source: 'lockfile',
        },
      ],
      traits: ['docker'],
      sources: [{ file: 'composer.json', kind: 'manifest', detail: 'Composer manifest' }],
    });
    const existingDrift: StackDriftReport = {
      generated_at: '2026-03-20T10:00:00.000Z',
      status: 'no-drift',
      previous_profile: snapshot.profile,
      current_profile: snapshot.profile,
      material_changes: [],
      newly_active_rule_bands: [],
      newly_inactive_rule_bands: [],
      review_targets: ['docs/instructions/stack/overview.md'],
    };
    writeFileSync(join(root, PATHS.STACK_DRIFT), JSON.stringify(existingDrift, null, 2));

    const drift = await writeStackArtifacts(root, snapshot, snapshot, { writeHumanDocs: false });

    expect(drift.review_targets).toEqual(existingDrift.review_targets);
    expect(readFileSync(join(root, PATHS.STACK_SNAPSHOT), 'utf8')).toContain('"frameworks"');
    expect(readFileSync(join(root, PATHS.STACK_DRIFT), 'utf8')).toContain('"no-drift"');
    expect(existsSync(join(root, PATHS.FRAMEWORK_STACK_DIR, 'overview.md'))).toBe(false);
  });

  it('writes human-readable stack docs for legacy and newly shipped built-in packs', async () => {
    const snapshot = buildSnapshot({
      frameworks: ['laravel', 'react', 'vue', 'flutter', 'django', 'spring-boot', 'short-video'],
      versionBands: [
        {
          name: 'laravel/framework:^12',
          package_name: 'laravel/framework',
          range: '^12',
          locked_version: 'v12.1.0',
          source: 'lockfile',
        },
        {
          name: 'react:^19',
          package_name: 'react',
          range: '^19',
          locked_version: '19.0.0',
          source: 'lockfile',
        },
        {
          name: 'vue:^3',
          package_name: 'vue',
          range: '^3',
          locked_version: '3.5.0',
          source: 'lockfile',
        },
        {
          name: 'flutter:^3',
          package_name: 'flutter',
          range: '^3',
          locked_version: '3.24.0',
          source: 'manifest',
        },
        {
          name: 'django:^5',
          package_name: 'django',
          range: '^5',
          locked_version: '5.1.0',
          source: 'lockfile',
        },
        {
          name: 'org.springframework.boot:spring-boot-starter-web:^3',
          package_name: 'org.springframework.boot:spring-boot-starter-web',
          range: '^3',
          locked_version: '3.4.0',
          source: 'lockfile',
        },
      ],
      sources: [],
      packages: [],
      traits: [],
    });

    await writeStackArtifacts(root, snapshot, null, { writeHumanDocs: true });

    const frameworksDoc = readFileSync(
      join(root, PATHS.FRAMEWORK_STACK_DIR, 'frameworks.md'),
      'utf8',
    );
    const dependenciesDoc = readFileSync(
      join(root, PATHS.FRAMEWORK_STACK_DIR, 'dependencies.md'),
      'utf8',
    );
    const toolingDoc = readFileSync(join(root, PATHS.FRAMEWORK_STACK_DIR, 'tooling.md'), 'utf8');
    const sourcesDoc = readFileSync(join(root, PATHS.FRAMEWORK_STACK_DIR, 'sources.md'), 'utf8');
    const driftDoc = readFileSync(join(root, PATHS.FRAMEWORK_STACK_DIR, 'drift-report.md'), 'utf8');

    expect(frameworksDoc).toContain('## React');
    expect(frameworksDoc).toContain('## Vue');
    expect(frameworksDoc).toContain('## Flutter');
    expect(frameworksDoc).toContain('## Django');
    expect(frameworksDoc).toContain('## Spring Boot');
    expect(frameworksDoc).toContain('## short-video');
    expect(frameworksDoc).toContain('Built-in Django coding stack pack');
    expect(frameworksDoc).toContain('Built-in React coding stack pack');
    expect(frameworksDoc).toContain('### Pack Conventions');
    expect(frameworksDoc).toContain('No version band detected.');
    expect(dependenciesDoc).toContain('## Runtime');
    expect(dependenciesDoc).toContain('- None');
    expect(toolingDoc).toContain('## Environment Traits');
    expect(toolingDoc).toContain('- None');
    expect(sourcesDoc).toContain('- No sources recorded.');
    expect(driftDoc).toContain('- Previous: none');
    expect(driftDoc).toContain('## Review Targets');
  });

  it('keeps OFF silent — writes no analytics.md and removes a stale one', async () => {
    const analyticsDoc = join(root, PATHS.FRAMEWORK_STACK_DIR, 'analytics.md');
    mkdirSync(join(root, PATHS.FRAMEWORK_STACK_DIR), { recursive: true });
    writeFileSync(analyticsDoc, '# stale analytics doc from a previously-enabled onboard\n');

    await writeStackArtifacts(root, buildSnapshot(), null, { writeHumanDocs: true });

    expect(existsSync(analyticsDoc)).toBe(false);
  });

  it('writes the tracking-plan analytics.md when the flag is on, no provider yet', async () => {
    writeFileSync(join(root, '.paqad', '.config'), 'analytics_instrumentation=true\n', 'utf8');

    await writeStackArtifacts(root, buildSnapshot(), null, { writeHumanDocs: true });

    const doc = readFileSync(join(root, PATHS.FRAMEWORK_STACK_DIR, 'analytics.md'), 'utf8');
    expect(doc).toContain('tracking plan as code');
    expect(doc).toContain('No analytics provider detected yet');
    expect(doc).toContain('Decision Pause packet');
    expect(doc).toContain('not** type-safe codegen');
  });

  it('renders the detected provider and convention in analytics.md', async () => {
    writeFileSync(join(root, '.paqad', '.config'), 'analytics_instrumentation=true\n', 'utf8');
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ dependencies: { 'posthog-js': '^1.0.0' } }),
    );
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'track.ts'), "posthog.capture('checkout_started');\n");

    await writeStackArtifacts(root, buildSnapshot(), null, { writeHumanDocs: true });

    const doc = readFileSync(join(root, PATHS.FRAMEWORK_STACK_DIR, 'analytics.md'), 'utf8');
    expect(doc).toContain('PostHog');
    expect(doc).toContain('`posthog`');
    expect(doc).toContain('Observed naming convention');
  });
});

function buildSnapshot(input?: {
  frameworks?: string[];
  traits?: string[];
  versionBands?: StackSnapshot['profile']['version_bands'];
  sources?: StackSnapshot['profile']['sources'];
  packages?: StackSnapshot['packages'];
}): StackSnapshot {
  return {
    generated_at: '2026-03-21T10:00:00.000Z',
    source_hashes: {},
    toolchains: [{ ecosystem: 'node', package_manager: 'pnpm', lockfile: 'pnpm-lock.yaml' }],
    packages: input?.packages ?? [
      {
        name: 'laravel/framework',
        version_constraint: '^12.0',
        locked_version: 'v12.1.0',
        ecosystem: 'php',
        is_dev: false,
      },
    ],
    profile: {
      domain: 'coding',
      frameworks: input?.frameworks ?? ['laravel'],
      traits: input?.traits ?? ['docker'],
      toolchains: [{ ecosystem: 'node', package_manager: 'pnpm', lockfile: 'pnpm-lock.yaml' }],
      version_bands: input?.versionBands ?? [],
      sources: input?.sources ?? [],
    },
  };
}

describe('refreshStackDocsFromInventory', () => {
  let root: string;
  const stack = (file: string): string => join(root, PATHS.FRAMEWORK_STACK_DIR, file);
  const pkg = (name: string, status = 'new', description?: string) => ({
    name,
    ecosystem: 'node',
    declared: '^1.0.0',
    installed: '1.4.2',
    dev: name === 'vitest',
    status,
    description,
  });

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-stack-inv-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('AC-55 names added packages with versions and a one-line purpose on overview and dependencies', async () => {
    const result = await refreshStackDocsFromInventory(root, {
      packages: [
        pkg('zod', 'new', 'TypeScript-first schema validation'),
        pkg('hono'),
        pkg('vitest'),
      ],
      notes: new Map([['hono', 'Small web framework for the edge']]),
    });
    expect(result.updated).toHaveLength(3);
    const overview = readFileSync(stack('overview.md'), 'utf8');
    expect(overview).toContain('- `zod` 1.4.2: TypeScript-first schema validation');
    expect(overview).toContain('- `hono` 1.4.2: Small web framework for the edge');
    expect(overview).toContain('- `vitest` 1.4.2 (dev)');
    const deps = readFileSync(stack('dependencies.md'), 'utf8');
    expect(deps).toMatch(/## Runtime\n\n- `hono`[^\n]*\n- `zod`/);
    expect(deps).toMatch(/## Dev\n\n- `vitest`/);
  });

  it('AC-56 drops a removed package', async () => {
    await refreshStackDocsFromInventory(root, {
      packages: [pkg('zod'), pkg('moment', 'unchanged')],
    });
    await refreshStackDocsFromInventory(root, { packages: [pkg('zod'), pkg('moment', 'removed')] });
    expect(readFileSync(stack('overview.md'), 'utf8')).not.toContain('moment');
    expect(readFileSync(stack('dependencies.md'), 'utf8')).not.toContain('moment');
    expect(readFileSync(stack('versions.md'), 'utf8')).not.toContain('moment');
  });

  it('AC-57 writes versions.md from the inventory when it is missing', async () => {
    expect(existsSync(stack('versions.md'))).toBe(false);
    await refreshStackDocsFromInventory(root, { packages: [pkg('zod')] });
    expect(readFileSync(stack('versions.md'), 'utf8')).toContain(
      '| zod | node | ^1.0.0 | 1.4.2 | no |',
    );
  });

  it('AC-58 keeps a hand-written section outside the managed blocks', async () => {
    await refreshStackDocsFromInventory(root, { packages: [pkg('zod')] });
    const hand = '\n## Why we chose zod\n\nWritten by hand.\n';
    writeFileSync(stack('overview.md'), `${readFileSync(stack('overview.md'), 'utf8')}${hand}`);
    await refreshStackDocsFromInventory(root, { packages: [pkg('zod'), pkg('hono')] });
    const overview = readFileSync(stack('overview.md'), 'utf8');
    expect(overview).toContain(hand);
    expect(overview).toContain('`hono`');
  });

  it('AC-59 keeps a page with no markers whole and only adds the managed block', async () => {
    mkdirSync(join(root, PATHS.FRAMEWORK_STACK_DIR), { recursive: true });
    const page = '# Stack Overview\n\nOur own words about the stack.\n';
    writeFileSync(stack('overview.md'), page);
    await refreshStackDocsFromInventory(root, { packages: [pkg('zod')] });
    const overview = readFileSync(stack('overview.md'), 'utf8');
    expect(overview.startsWith(page)).toBe(true);
    expect(overview).toContain('<!-- paqad:stack:packages:start -->');
  });

  it('cleans and caps the purpose line', () => {
    const purpose = packagePurpose(pkg('zod'), `<!-- run this --> ${'a'.repeat(200)} <b>`);
    expect(purpose.length).toBeLessThanOrEqual(PURPOSE_MAX + 10);
    expect(purpose).not.toContain('run this');
    expect(purpose).not.toContain('<b>');
  });
});
