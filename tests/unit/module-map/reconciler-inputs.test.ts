import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import {
  _matchesAnyGlob,
  driftReportBlockedReason,
  driftReportHasFindings,
  readDriftReport,
  readRawModuleMap,
  reconcileModuleMap,
} from '@/module-map/reconciler.js';

describe('module-map reconciler inputs', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-reconciler-inputs-'));
    mkdirSync(join(root, 'docs/instructions/rules'), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function write(relPath: string, contents: string): void {
    const abs = join(root, relPath);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, contents, 'utf8');
  }

  it('reads an empty map file as no map', () => {
    write(PATHS.MODULE_MAP, '');
    expect(readRawModuleMap(root)).toBeNull();
  });

  it('reads malformed module and feature entries with empty names', () => {
    write(
      PATHS.MODULE_MAP,
      [
        'modules:',
        '  - just-a-string',
        '  - slug: core',
        '    source_paths: [src/core]',
        '    sensitivity: high',
        '    features:',
        '      - 7',
        '      - slug: x',
        '        sources: [src/core/x.ts]',
      ].join('\n'),
    );

    expect(readRawModuleMap(root)).toEqual({
      modules: [
        { slug: '', name: '', sources: [], features: [], sensitivity: 'normal' },
        {
          slug: 'core',
          name: '',
          sources: ['src/core'],
          features: [
            { slug: '', name: '', sources: [] },
            { slug: 'x', name: '', sources: ['src/core/x.ts'] },
          ],
          sensitivity: 'high',
        },
      ],
    });
  });

  it('matches single-character and escaped glob characters and skips empty globs', () => {
    expect(_matchesAnyGlob('src/a1.ts', ['', 'src/a?.ts'])).toBe(true);
    expect(_matchesAnyGlob('src/a(1).ts', ['src/a(1).ts'])).toBe(true);
    expect(_matchesAnyGlob('src/ab.ts', ['src/a?.tsx'])).toBe(false);
    expect(_matchesAnyGlob('src/core/a.ts', ['src/core/'])).toBe(true);
  });

  it('reconciles without writing a report, with extensions given with and without a dot', async () => {
    write(PATHS.MODULE_MAP, 'modules:\n  - slug: core\n    sources: [src/core]\n');
    write('src/core/a.ts', 'x');
    write('src/core/b.md', 'x');
    write('src/core/c.tsx', 'x');
    mkdirSync(join(root, 'docs/modules/core'), { recursive: true });

    const report = await reconcileModuleMap({
      projectRoot: root,
      sourceRoots: ['src/'],
      fileExtensions: ['.ts', 'tsx'],
      writeReport: false,
    });

    expect(report.findings).toEqual([]);
    expect(readDriftReport(root)).toBeNull();
    expect(driftReportBlockedReason(report)).toBeNull();
  });

  it('blocks without writing a report when the source roots are unknown', async () => {
    const report = await reconcileModuleMap({
      projectRoot: root,
      sourceRoots: [],
      writeReport: false,
    });
    expect(driftReportBlockedReason(report)).toBe('source_roots_unknown');
    expect(readDriftReport(root)).toBeNull();
  });

  it('flags a feature that is the only one with sources but matches nothing', async () => {
    write(
      PATHS.MODULE_MAP,
      [
        'modules:',
        '  - slug: core',
        '    sources: [src/core]',
        '    features:',
        '      - slug: gone',
        '        sources: [src/core/gone.ts]',
        '      - slug: bare',
      ].join('\n'),
    );
    write('src/core/a.ts', 'x');

    const report = await reconcileModuleMap({
      projectRoot: root,
      sourceRoots: ['src'],
      writeReport: false,
    });

    expect(report.counts['MM-FEAT-STALE']).toBe(1);
    expect(report.counts['MM-FEAT-ADD']).toBe(1);
  });

  it('treats a map without a modules list, or no map at all, as declaring nothing', async () => {
    write(PATHS.MODULE_MAP, 'version: 1\n');
    expect(readRawModuleMap(root)).toEqual({ modules: [] });

    rmSync(join(root, PATHS.MODULE_MAP));
    write('src/a.ts', 'x');
    const report = await reconcileModuleMap({
      projectRoot: root,
      sourceRoots: ['src'],
      writeReport: false,
    });
    expect(report.counts['MM-ADD']).toBe(1);
  });

  it('says whether a report has anything to act on', () => {
    expect(driftReportHasFindings(null)).toBe(false);
    expect(
      driftReportHasFindings({
        generated_at: 'now',
        source_roots: [],
        findings: [],
        blocked: 'source_roots_unknown',
        counts: {} as never,
      }),
    ).toBe(true);
    expect(driftReportBlockedReason(null)).toBeNull();
  });

  it('reads an unreadable drift report as missing', () => {
    write(PATHS.MODULE_MAP_DRIFT, '{not json');
    expect(readDriftReport(root)).toBeNull();
  });
});
