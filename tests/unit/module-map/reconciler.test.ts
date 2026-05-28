import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import {
  _matchesAnyGlob,
  _normaliseGlob,
  driftReportHasFindings,
  reconcileModuleMap,
} from '@/module-map/reconciler.js';

describe('module-map/reconciler glob helpers', () => {
  it('normalises a bare directory into a recursive glob', () => {
    expect(_normaliseGlob('src/foo')).toBe('src/foo/**');
  });

  it('leaves file paths and glob patterns alone', () => {
    expect(_normaliseGlob('src/foo/bar.ts')).toBe('src/foo/bar.ts');
    expect(_normaliseGlob('src/foo/**')).toBe('src/foo/**');
    expect(_normaliseGlob('src/**/*.ts')).toBe('src/**/*.ts');
  });

  it('matches files against normalised globs', () => {
    expect(_matchesAnyGlob('src/foo/bar.ts', ['src/foo'])).toBe(true);
    expect(_matchesAnyGlob('src/foo/bar.ts', ['src/foo/**'])).toBe(true);
    expect(_matchesAnyGlob('src/foo/bar.ts', ['src/baz/**'])).toBe(false);
    expect(_matchesAnyGlob('src/foo/bar.ts', ['src/**/*.ts'])).toBe(true);
    expect(_matchesAnyGlob('src/foo/bar.tsx', ['src/**/*.ts'])).toBe(false);
  });
});

describe('module-map/reconciler', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-reconciler-'));
    mkdirSync(join(root, 'docs/instructions/rules'), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function writeMap(yaml: string): void {
    writeFileSync(join(root, PATHS.MODULE_MAP), yaml, 'utf8');
  }

  function writeFile(relPath: string, contents = '// test\n'): void {
    const abs = join(root, relPath);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, contents, 'utf8');
  }

  it('blocks with source_roots_unknown when sourceRoots is null', async () => {
    const report = await reconcileModuleMap({
      projectRoot: root,
      sourceRoots: null,
      writeReport: false,
    });
    expect(report.blocked).toBe('source_roots_unknown');
    expect(report.findings).toEqual([]);
    expect(driftReportHasFindings(report)).toBe(true);
  });

  it('blocks with source_roots_unknown when sourceRoots is an empty array', async () => {
    const report = await reconcileModuleMap({
      projectRoot: root,
      sourceRoots: [],
      writeReport: false,
    });
    expect(report.blocked).toBe('source_roots_unknown');
  });

  it('emits MM-REMOVE when a declared module has no matching source files', async () => {
    writeMap(
      [
        'modules:',
        '  - slug: payments',
        '    name: Payments',
        '    sources:',
        '      - src/payments/**',
        '',
      ].join('\n'),
    );
    // Source roots exist but no payments dir.
    writeFile('src/other/thing.ts');
    const report = await reconcileModuleMap({
      projectRoot: root,
      sourceRoots: ['src'],
      fileExtensions: ['.ts'],
      writeReport: false,
    });
    const codes = report.findings.map((f) => f.code);
    expect(codes).toContain('MM-REMOVE');
    expect(report.counts['MM-REMOVE']).toBe(1);
  });

  it('emits MM-ADD for undeclared source files grouped by directory', async () => {
    writeMap(
      [
        'modules:',
        '  - slug: payments',
        '    name: Payments',
        '    sources:',
        '      - src/payments/**',
        '',
      ].join('\n'),
    );
    writeFile('src/payments/index.ts');
    writeFile('src/auth/login.ts');
    writeFile('src/auth/signup.ts');
    const report = await reconcileModuleMap({
      projectRoot: root,
      sourceRoots: ['src'],
      fileExtensions: ['.ts'],
      writeReport: false,
    });
    const mmAdd = report.findings.find((f) => f.code === 'MM-ADD');
    expect(mmAdd).toBeDefined();
    expect(mmAdd?.paths).toHaveLength(2);
    expect(mmAdd?.paths.every((p) => p.startsWith('src/auth/'))).toBe(true);
    expect(report.counts['MM-REMOVE']).toBe(0);
  });

  it('emits MM-FEAT-STALE for declared features with no matching files', async () => {
    writeMap(
      [
        'modules:',
        '  - slug: payments',
        '    name: Payments',
        '    sources:',
        '      - src/payments/**',
        '    features:',
        '      - slug: stripe',
        '        name: Stripe',
        '        sources: [src/payments/stripe/**]',
        '      - slug: paypal',
        '        name: PayPal',
        '        sources: [src/payments/paypal/**]',
        '',
      ].join('\n'),
    );
    writeFile('src/payments/stripe/index.ts');
    // No paypal/ files.
    const report = await reconcileModuleMap({
      projectRoot: root,
      sourceRoots: ['src'],
      fileExtensions: ['.ts'],
      writeReport: false,
    });
    const stale = report.findings.find((f) => f.code === 'MM-FEAT-STALE');
    expect(stale?.feature_slug).toBe('paypal');
  });

  it('emits MM-FEAT-ADD when files in a module match no feature glob', async () => {
    writeMap(
      [
        'modules:',
        '  - slug: payments',
        '    name: Payments',
        '    sources:',
        '      - src/payments/**',
        '    features:',
        '      - slug: stripe',
        '        name: Stripe',
        '        sources: [src/payments/stripe/**]',
        '',
      ].join('\n'),
    );
    writeFile('src/payments/stripe/index.ts');
    writeFile('src/payments/shared/utils.ts');
    const report = await reconcileModuleMap({
      projectRoot: root,
      sourceRoots: ['src'],
      fileExtensions: ['.ts'],
      writeReport: false,
    });
    const featAdd = report.findings.find((f) => f.code === 'MM-FEAT-ADD');
    expect(featAdd?.module_slug).toBe('payments');
    expect(featAdd?.paths).toContain('src/payments/shared/utils.ts');
  });

  it('emits MM-DOC-MISSING and MM-DOC-ORPHAN by comparing module-map.yml against docs/modules/', async () => {
    writeMap(
      [
        'modules:',
        '  - slug: payments',
        '    name: Payments',
        '    sources: [src/payments/**]',
        '  - slug: auth',
        '    name: Auth',
        '    sources: [src/auth/**]',
        '',
      ].join('\n'),
    );
    writeFile('src/payments/index.ts');
    writeFile('src/auth/login.ts');
    mkdirSync(join(root, 'docs/modules/payments'), { recursive: true });
    mkdirSync(join(root, 'docs/modules/legacy-billing'), { recursive: true });
    const report = await reconcileModuleMap({
      projectRoot: root,
      sourceRoots: ['src'],
      fileExtensions: ['.ts'],
      writeReport: false,
    });
    const missing = report.findings.find(
      (f) => f.code === 'MM-DOC-MISSING' && f.module_slug === 'auth',
    );
    const orphan = report.findings.find(
      (f) => f.code === 'MM-DOC-ORPHAN' && f.module_slug === 'legacy-billing',
    );
    expect(missing).toBeDefined();
    expect(orphan).toBeDefined();
  });

  it('writes drift.json to .paqad/module-map/ by default', async () => {
    writeMap('modules: []\n');
    writeFile('src/foo/bar.ts');
    await reconcileModuleMap({
      projectRoot: root,
      sourceRoots: ['src'],
      fileExtensions: ['.ts'],
    });
    const driftPath = join(root, PATHS.MODULE_MAP_DRIFT);
    expect((await import('node:fs')).existsSync(driftPath)).toBe(true);
  });

  it('appends a module.reconciled event to events.jsonl when writeReport is true (AC #36)', async () => {
    writeMap('modules: []\n');
    writeFile('src/foo/bar.ts');
    await reconcileModuleMap({
      projectRoot: root,
      sourceRoots: ['src'],
      fileExtensions: ['.ts'],
    });
    const { readModuleMapEvents } = await import('@/module-decisions/events.js');
    const events = readModuleMapEvents(root);
    expect(events.some((e) => e.type === 'module.reconciled')).toBe(true);
  });
});
