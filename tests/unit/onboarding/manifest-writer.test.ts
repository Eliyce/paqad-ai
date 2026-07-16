import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import { FrameworkError } from '@/core/errors/index.js';
import {
  readExistingOnboardingManifest,
  sanitizeStackSnapshotRepository,
  writeFrameworkVersionPreservingTimestamp,
  writeJsonPreservingTimestamp,
  writeOnboardingManifest,
} from '@/onboarding/manifest-writer.js';

describe('readExistingOnboardingManifest (PQD-424)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'paqad-mw-existing-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns null when no manifest exists (first onboarding)', () => {
    expect(readExistingOnboardingManifest(dir)).toBeNull();
  });

  it('parses and returns an existing valid manifest', () => {
    const path = join(dir, PATHS.ONBOARDING_MANIFEST);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ framework_version: '1.0.0' }));

    expect(readExistingOnboardingManifest(dir)).toMatchObject({ framework_version: '1.0.0' });
  });

  it('throws a coded FrameworkError when the manifest is corrupt JSON', () => {
    const path = join(dir, PATHS.ONBOARDING_MANIFEST);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, '{ not valid json');

    try {
      readExistingOnboardingManifest(dir);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(FrameworkError);
      expect((error as FrameworkError).code).toBe('REGISTRY_CORRUPTED');
    }
  });
});

describe('writeJsonPreservingTimestamp', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'paqad-mw-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes fresh content when the file does not exist', () => {
    const path = join(dir, 'a.json');
    writeJsonPreservingTimestamp(
      path,
      { name: 'x', timestamp: '2025-01-01T00:00:00.000Z' },
      'timestamp',
    );
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
      name: 'x',
      timestamp: '2025-01-01T00:00:00.000Z',
    });
    expect(readFileSync(path, 'utf8')).toMatch(/\n$/);
  });

  it('preserves the existing timestamp when other fields are unchanged', () => {
    const path = join(dir, 'a.json');
    writeJsonPreservingTimestamp(
      path,
      { name: 'x', timestamp: '2025-01-01T00:00:00.000Z' },
      'timestamp',
    );
    writeJsonPreservingTimestamp(
      path,
      { name: 'x', timestamp: '2030-12-31T00:00:00.000Z' },
      'timestamp',
    );
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
      name: 'x',
      timestamp: '2025-01-01T00:00:00.000Z',
    });
  });

  it('writes a fresh timestamp when any other field changes', () => {
    const path = join(dir, 'a.json');
    writeJsonPreservingTimestamp(
      path,
      { name: 'x', timestamp: '2025-01-01T00:00:00.000Z' },
      'timestamp',
    );
    writeJsonPreservingTimestamp(
      path,
      { name: 'y', timestamp: '2030-12-31T00:00:00.000Z' },
      'timestamp',
    );
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
      name: 'y',
      timestamp: '2030-12-31T00:00:00.000Z',
    });
  });

  it('writes a fresh timestamp when existing content is unparseable', () => {
    const path = join(dir, 'a.json');
    writeFileSync(path, 'not json');
    writeJsonPreservingTimestamp(
      path,
      { name: 'x', timestamp: '2030-12-31T00:00:00.000Z' },
      'timestamp',
    );
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
      name: 'x',
      timestamp: '2030-12-31T00:00:00.000Z',
    });
  });

  it('preserves multiple timestamp paths when all meaningful fields are unchanged', () => {
    const path = join(dir, 'nested.json');
    writeJsonPreservingTimestamp(
      path,
      {
        generated_at: '2025-01-01T00:00:00.000Z',
        detected: { timestamp: '2025-01-02T00:00:00.000Z', stack: 'node' },
      },
      ['generated_at', 'detected.timestamp'],
    );
    const first = readFileSync(path, 'utf8');

    writeJsonPreservingTimestamp(
      path,
      {
        generated_at: '2030-01-01T00:00:00.000Z',
        detected: { timestamp: '2030-01-02T00:00:00.000Z', stack: 'node' },
      },
      ['generated_at', 'detected.timestamp'],
    );

    expect(readFileSync(path, 'utf8')).toBe(first);
  });

  it('rejects prototype-chain segments in caller-supplied timestamp paths', () => {
    const path = join(dir, 'nested.json');
    writeFileSync(path, '{"__proto__":{"polluted":"yes"}}\n');

    writeJsonPreservingTimestamp(path, { name: 'safe' }, ['__proto__.polluted']);

    expect(({} as { polluted?: string }).polluted).toBeUndefined();
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ name: 'safe' });
  });
});

describe('writeFrameworkVersionPreservingTimestamp', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'paqad-mw-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes fresh content when the file does not exist', () => {
    const path = join(dir, 'framework-version.txt');
    writeFrameworkVersionPreservingTimestamp(path, '1.0.0', '2025-01-01T00:00:00.000Z');
    expect(readFileSync(path, 'utf8')).toBe('version=1.0.0\nupdated_at=2025-01-01T00:00:00.000Z\n');
  });

  it('preserves updated_at on identical version', () => {
    const path = join(dir, 'framework-version.txt');
    writeFrameworkVersionPreservingTimestamp(path, '1.0.0', '2025-01-01T00:00:00.000Z');
    writeFrameworkVersionPreservingTimestamp(path, '1.0.0', '2030-12-31T00:00:00.000Z');
    expect(readFileSync(path, 'utf8')).toBe('version=1.0.0\nupdated_at=2025-01-01T00:00:00.000Z\n');
  });

  it('refreshes updated_at when version changes', () => {
    const path = join(dir, 'framework-version.txt');
    writeFrameworkVersionPreservingTimestamp(path, '1.0.0', '2025-01-01T00:00:00.000Z');
    writeFrameworkVersionPreservingTimestamp(path, '1.0.1', '2030-12-31T00:00:00.000Z');
    expect(readFileSync(path, 'utf8')).toBe('version=1.0.1\nupdated_at=2030-12-31T00:00:00.000Z\n');
  });
});

describe('portability sanitization (issue #69)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'paqad-portability-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('strips absolute compiled_rules_path from the onboarding manifest', () => {
    writeOnboardingManifest(dir, {
      framework_version: '1.0.0',
      adapter: 'claude-code',
      project_root: dir,
      profile: {} as never,
      detected: null,
      generated_at: '2026-01-01T00:00:00.000Z',
      generated_artifacts: [],
      planning_artifacts: {
        compiled_rules_path: join(dir, '.paqad/compiled-rules.json'),
        module_health_initialized: [],
      },
    });
    const written = readFileSync(join(dir, '.paqad/onboarding-manifest.json'), 'utf8');
    expect(written).not.toContain(dir);
    expect(written).toContain('"compiled_rules_path": ".paqad/compiled-rules.json"');
    expect(written).toContain('"project_root": "."');
  });

  it('writes byte-identical normalized manifests across repeat runs', () => {
    const manifestPath = join(dir, '.paqad/onboarding-manifest.json');
    const repository = {
      selected_root: dir,
      scan_max_depth: 3,
      ignored_paths: [join(dir, '.vscode'), join(dir, 'node_modules'), join(dir, '.DS_Store')],
      projects: [],
      applications: [],
      primary_project_root: dir,
    };
    const createManifest = (timestamp: string, reverse = false) => ({
      adapter: 'codex-cli' as const,
      project_root: dir,
      profile: {} as never,
      detected: {
        detected_domain: 'coding' as const,
        detected_stack: 'node-cli' as const,
        detected_capabilities: [],
        confidence: 'high' as const,
        signals: [
          {
            signal: 'package',
            file: join(dir, 'package.json'),
            implies: 'node-cli',
            confidence: 'high' as const,
          },
        ],
        timestamp,
        repository: {
          ...repository,
          ignored_paths: reverse
            ? [...repository.ignored_paths].reverse()
            : repository.ignored_paths,
        },
      },
      repository: {
        ...repository,
        ignored_paths: reverse ? [...repository.ignored_paths].reverse() : repository.ignored_paths,
      },
      generated_at: timestamp,
      generated_artifacts: reverse
        ? [
            { path: 'z-last.json', auto_update: true },
            { path: 'a-first.json', auto_update: true },
          ]
        : [
            { path: 'a-first.json', auto_update: true },
            { path: 'z-last.json', auto_update: true },
          ],
    });

    writeOnboardingManifest(dir, createManifest('2026-01-01T00:00:00.000Z'));
    const first = readFileSync(manifestPath, 'utf8');
    writeOnboardingManifest(dir, createManifest('2030-12-31T00:00:00.000Z', true));
    const second = readFileSync(manifestPath, 'utf8');

    expect(second).toBe(first);
    expect(second).toMatch(/\n$/);
    expect(second).not.toContain(dir);
    const parsed = JSON.parse(second) as {
      detected: { signals: Array<{ file: string }>; repository: { ignored_paths: string[] } };
      repository: { ignored_paths: string[] };
      generated_artifacts: Array<{ path: string }>;
    };
    expect(parsed.detected.signals[0]?.file).toBe('package.json');
    expect(parsed.detected.repository.ignored_paths).toEqual(['node_modules']);
    expect(parsed.repository.ignored_paths).toEqual(['node_modules']);
    expect(parsed.generated_artifacts.map((artifact) => artifact.path)).toEqual([
      'a-first.json',
      'z-last.json',
    ]);
  });

  it('strips absolute selected_root from the stack snapshot repository context', () => {
    const sanitized = sanitizeStackSnapshotRepository(dir, {
      foo: 'bar',
      repository: {
        selected_root: dir,
        scan_max_depth: 5,
        ignored_paths: [join(dir, 'node_modules')],
        projects: [
          { root: dir, role: 'standalone', parent_root: null, markers: [], ecosystems: ['node'] },
        ],
        applications: [{ root: dir, component_roots: [join(dir, 'pkg-a')] }],
        primary_project_root: dir,
      },
    });
    const json = JSON.stringify(sanitized);
    expect(json).not.toContain(dir);
    expect(sanitized.repository?.selected_root).toBe('.');
    expect(sanitized.repository?.primary_project_root).toBe('.');
  });

  it('is a noop for stack snapshots without a repository field', () => {
    const input = { profile: { frameworks: [] } };
    expect(sanitizeStackSnapshotRepository(dir, input)).toBe(input);
  });
});
