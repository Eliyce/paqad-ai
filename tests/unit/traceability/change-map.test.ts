import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { StructuredTestResult } from '@/core/types/test-output.js';
import { featureFilePath } from '@/feature-evidence/paths.js';
import { loadChangeEvidence } from '@/pipeline/change-evidence.js';
import {
  buildAndWriteChangeTraceabilityMap,
  buildChangeTraceabilityMap,
  extractTitlesAndTags,
  namesCriterion,
  readTraceabilityMap,
} from '@/traceability/index.js';

import { commitAll, git, makeEmptyRepo, writeRepoFile } from '../pipeline/changed-files.fixture.js';
import { openChange, writeSpec } from './change-map.fixture.js';

const roots: string[] = [];
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-change-map-'));
  roots.push(root);
  mkdirSync(join(root, '.paqad'), { recursive: true });
  return root;
}

function write(root: string, rel: string, body: string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), body);
}

function failingResult(testId: string): StructuredTestResult {
  return {
    schema_version: '1.0.0',
    summary: {
      total: 1,
      passed: 0,
      failed: 1,
      skipped: 0,
      errored: 0,
      duration_ms: 1,
      timestamp: '1970-01-01T00:00:00.000Z',
      runner_id: 'test',
    },
    failures: [
      {
        test_id: testId,
        suite: null,
        message: 'expected true',
        stack_trace: null,
        file_path: 'tests/feature.test.ts',
        line_number: 1,
        category: 'assertion',
        duration_ms: 1,
      },
    ],
    errors: [],
    warnings: [],
    parse_metadata: {
      raw_byte_size: 1,
      structured_byte_size: 1,
      compression_ratio: 0,
      original_size: 1,
      compact_size: 1,
      reduction_ratio: 0,
      delta_mode_used: false,
      escalation_occurred: false,
      escalation_reason: null,
      delta_summary: null,
      parse_strategy: 'structured',
      parse_warnings: [],
    },
  };
}

function proving(map: { forward: Array<{ promise_id: string; proven: boolean }> }): string[] {
  return map.forward.filter((link) => link.proven).map((link) => link.promise_id);
}

describe('namesCriterion: word-boundary matching (AC-30)', () => {
  it('AC-30: AC-1 matches its own id but never AC-10, AC-1x or AC-1.2', () => {
    expect(namesCriterion('AC-1: works', 'AC-1')).toBe(true);
    expect(namesCriterion('covers (AC-1)', 'AC-1')).toBe(true);
    expect(namesCriterion('AC-1/AC-2 both', 'AC-1')).toBe(true);
    expect(namesCriterion('AC-10: other', 'AC-1')).toBe(false);
    expect(namesCriterion('AC-1x: other', 'AC-1')).toBe(false);
    expect(namesCriterion('AC-1.2 nested', 'AC-1')).toBe(false);
    expect(namesCriterion('XAC-1 prefixed', 'AC-1')).toBe(false);
    expect(namesCriterion('anything', '')).toBe(false);
  });

  it('AC-30: an id like AC-TRACK-foo matches exactly, never AC-TRACK-foo-bar', () => {
    expect(namesCriterion('AC-TRACK-foo fires once', 'AC-TRACK-foo')).toBe(true);
    expect(namesCriterion('AC-TRACK-foo-bar fires', 'AC-TRACK-foo')).toBe(false);
    expect(namesCriterion('AC-TRACK-fo fires', 'AC-TRACK-foo')).toBe(false);
  });
});

describe('extractTitlesAndTags (AC-30)', () => {
  it('AC-30: reads it, test and describe titles with modifiers, it.each tables and @obligation tags', () => {
    const source = [
      "describe('AC-1 suite', () => {",
      '  it("AC-2 double quoted", () => {});',
      '  test.skip(`AC-3 template`, () => {});',
      "  it.each([['a', 1], ['b', (2)]])('AC-4 table %s', () => {});",
      "  it.each([1, 'x)'])('AC-5 tricky', () => {});",
      "  it.only('it\\'s AC-6', () => {});",
      '  // @obligation AC-7',
      '  /* @obligation AC-8 */',
      "  helper.it('AC-9 not a test call');",
      "  edit('AC-11 not a test call');",
      '  it(name, () => {});',
      "  it.each([1)('AC-12 unbalanced');",
      '  it.each([1])  ;',
      '});',
    ].join('\n');
    const texts = extractTitlesAndTags(source);
    expect(texts).toEqual(
      expect.arrayContaining([
        'AC-1 suite',
        'AC-2 double quoted',
        'AC-3 template',
        'AC-4 table %s',
        'AC-5 tricky',
        "it\\'s AC-6",
        'AC-7',
        'AC-8',
      ]),
    );
    expect(texts.join('|')).not.toContain('AC-9');
    expect(texts.join('|')).not.toContain('AC-11');
    expect(texts.join('|')).not.toContain('AC-12');
  });

  it('AC-30: an unterminated string or table reads no title', () => {
    expect(extractTitlesAndTags("it('AC-1 never closed\n")).toEqual([]);
    expect(extractTitlesAndTags("it.each(['open)")).toEqual([]);
    expect(extractTitlesAndTags('it.each([1, 2')).toEqual([]);
    expect(extractTitlesAndTags('// @obligation   \n')).toEqual([]);
  });
});

describe('buildChangeTraceabilityMap', () => {
  it('AC-32: returns null with no open change, no spec, or a spec that is not frozen', () => {
    const root = project();
    expect(
      buildChangeTraceabilityMap({
        projectRoot: root,
        dirName: null,
        changedFiles: [],
        lane: 'fast',
      }),
    ).toBeNull();
    const dir = openChange(root, 'ses-490', 'fast', 'ORD-490 copy fix');
    expect(
      buildChangeTraceabilityMap({
        projectRoot: root,
        dirName: dir,
        changedFiles: [],
        lane: 'fast',
      }),
    ).toBeNull();
    writeSpec(root, dir, [{ id: 'AC-1', proof: 'automated' }], false);
    expect(
      buildChangeTraceabilityMap({
        projectRoot: root,
        dirName: dir,
        changedFiles: [],
        lane: 'fast',
      }),
    ).toBeNull();
  });

  it('AC-29: a changed test whose title names the criterion proves it', () => {
    const root = project();
    const dir = openChange(root, 'ses-29');
    writeSpec(root, dir, [
      { id: 'AC-1', proof: 'automated' },
      { id: 'AC-2', proof: 'automated' },
    ]);
    write(root, 'tests/feature.test.ts', "it('AC-1: exports the rows', () => {});\n");

    const built = buildChangeTraceabilityMap({
      projectRoot: root,
      dirName: dir,
      changedFiles: ['tests/feature.test.ts', 'src/feature.ts'],
      lane: 'full',
      now: () => '2026-10-19T00:00:00.000Z',
    });

    expect(built?.automated).toEqual(['AC-1', 'AC-2']);
    expect(built?.map.scope).toBe('change');
    expect(built?.map.change).toBe(dir);
    expect(built?.map.generated_at).toBe('2026-10-19T00:00:00.000Z');
    const ac1 = built?.map.forward.find((link) => link.promise_id === 'AC-1');
    expect(ac1).toMatchObject({
      source: 'acceptance-criterion',
      proving_checks: ['tests/feature.test.ts'],
      proven: true,
    });
    expect(ac1?.description).toContain('Given a AC-1 setup');
    expect(built?.map.forward.find((link) => link.promise_id === 'AC-2')?.proven).toBe(false);
  });

  it('AC-30: describe titles and @obligation tags prove; a prefix-sharing id and an unchanged file do not', () => {
    const root = project();
    const dir = openChange(root, 'ses-30');
    writeSpec(root, dir, [
      { id: 'AC-1', proof: 'automated' },
      { id: 'AC-2', proof: 'automated' },
      { id: 'AC-3', proof: 'automated' },
      { id: 'AC-4', proof: 'automated' },
    ]);
    write(
      root,
      'tests/describe.test.ts',
      "describe('AC-1 export', () => { it('works', () => {}); });\n",
    );
    write(root, 'tests/tagged.test.ts', "// @obligation AC-2\nit('exports', () => {});\n");
    write(root, 'tests/prefix.test.ts', "it('AC-30 is a different criterion', () => {});\n");
    write(root, 'tests/unchanged.test.ts', "it('AC-4 lives in an unchanged file', () => {});\n");
    write(root, 'tests/fixtures/data.json', '{"title":"AC-4"}');

    const built = buildChangeTraceabilityMap({
      projectRoot: root,
      dirName: dir,
      changedFiles: [
        'tests/describe.test.ts',
        'tests/tagged.test.ts',
        'tests/prefix.test.ts',
        'tests/fixtures/data.json',
        'tests/deleted.test.ts',
      ],
      lane: 'full',
    });

    expect(proving(built!.map)).toEqual(['AC-1', 'AC-2']);
    expect(built!.map.counts.untested_promises).toBe(2);
  });

  it('AC-31: visual and manual criteria never become promises, so neither is reported missing', () => {
    const root = project();
    const dir = openChange(root, 'ses-31');
    writeSpec(root, dir, [
      { id: 'AC-1', proof: 'visual' },
      { id: 'AC-2', proof: 'manual' },
    ]);

    const built = buildChangeTraceabilityMap({
      projectRoot: root,
      dirName: dir,
      changedFiles: [],
      lane: 'full',
    });

    expect(built?.map.forward).toEqual([]);
    expect(built?.map.findings).toEqual([]);
    expect(built?.visual).toEqual(['AC-1']);
    expect(built?.manual).toEqual(['AC-2']);
  });

  it('AC-35: a criterion whose only tagged test failed is not proved', () => {
    const root = project();
    const dir = openChange(root, 'ses-35');
    writeSpec(root, dir, [
      { id: 'AC-1', proof: 'automated' },
      { id: 'AC-TRACK-export', proof: 'automated' },
      { id: 'AC-3', proof: 'automated' },
      { id: 'AC-4', proof: 'automated' },
    ]);
    write(
      root,
      'tests/feature.test.ts',
      [
        "it('AC-1 exports', () => {});",
        "it('AC-TRACK-export fires', () => {});",
        "it('AC-3 holds', () => {});",
        "it('AC-4 holds', () => {});",
      ].join('\n'),
    );

    const built = buildChangeTraceabilityMap({
      projectRoot: root,
      dirName: dir,
      changedFiles: ['tests/feature.test.ts'],
      testResults: [
        failingResult('feature > AC-1 exports'),
        failingResult('feature > AC-TRACK-export fires'),
      ],
      failingAcIds: ['AC-3'],
      lane: 'full',
    });

    expect(proving(built!.map)).toEqual(['AC-4']);
  });

  it('keeps compliance obligations but never lets one prove a criterion of the same id', () => {
    const root = project();
    const dir = openChange(root, 'ses-obl');
    writeSpec(root, dir, [{ id: 'AC-1', proof: 'automated' }]);
    write(
      root,
      '.paqad/compliance/spec/report.json',
      JSON.stringify({
        obligations: [
          { obligation_id: 'AC-1', description: 'same id', evidence: ['tests/old.test.ts'] },
          { obligation_id: 'OBL-1', description: 'kept', evidence: ['tests/obl.test.ts'] },
          { obligation_id: 'OBL-1', description: 'duplicate', evidence: [] },
          { obligation_id: 'OBL-2', description: 'no evidence', evidence: [] },
        ],
      }),
    );

    const built = buildChangeTraceabilityMap({
      projectRoot: root,
      dirName: dir,
      changedFiles: [],
      lane: 'full',
    });

    const byId = Object.fromEntries(built!.map.forward.map((link) => [link.promise_id, link]));
    expect(byId['AC-1']).toMatchObject({ source: 'acceptance-criterion', proven: false });
    expect(byId['OBL-1']).toMatchObject({ source: 'obligation', proven: true });
    expect(byId['OBL-2']).toMatchObject({ source: 'obligation', proven: false });
    expect(built!.map.anchors_known).toBe(false);
    expect(built!.map.backward).toEqual([]);
  });

  it('a spec with no criteria array reads as no automated criteria', () => {
    const root = project();
    const dir = openChange(root, 'ses-empty');
    write(
      root,
      featureFilePath(dir, 'specification'),
      JSON.stringify({ frozen: { frozen_at: 'x', spec_hash: 'h', signed_off_by: 't' } }),
    );
    const built = buildChangeTraceabilityMap({
      projectRoot: root,
      dirName: dir,
      changedFiles: [],
      lane: 'full',
    });
    expect(built?.automated).toEqual([]);
    expect(built?.map.forward).toEqual([]);
  });

  it('describes a criterion by its id when it has no given, when or then', () => {
    const root = project();
    const dir = openChange(root, 'ses-bare');
    write(
      root,
      featureFilePath(dir, 'specification'),
      JSON.stringify({
        frozen: { frozen_at: 'x', spec_hash: 'h', signed_off_by: 't' },
        acceptance_criteria: [
          { criterion_id: 'AC-1', proof_type: 'automated' },
          { criterion_id: 'AC-2', proof_type: 'automated', then: 'it holds' },
        ],
      }),
    );
    const built = buildChangeTraceabilityMap({
      projectRoot: root,
      dirName: dir,
      changedFiles: [],
      lane: 'full',
    });
    expect(built?.map.forward.map((link) => link.description)).toEqual(['AC-1', 'then it holds']);
  });

  it('skips a test file too large to be one someone wrote', () => {
    const root = project();
    const dir = openChange(root, 'ses-big');
    writeSpec(root, dir, [{ id: 'AC-1', proof: 'automated' }]);
    write(
      root,
      'tests/huge.test.ts',
      "it('AC-1 hides in a huge file', () => {});\n" + 'x'.repeat(2_200_000),
    );
    const built = buildChangeTraceabilityMap({
      projectRoot: root,
      dirName: dir,
      changedFiles: ['tests/huge.test.ts'],
      lane: 'full',
    });
    expect(proving(built!.map)).toEqual([]);
  });

  it('reads a test result with no failure or error lists as no failing criteria', () => {
    const root = project();
    const dir = openChange(root, 'ses-partial-result');
    writeSpec(root, dir, [{ id: 'AC-1', proof: 'automated' }]);
    write(root, 'tests/a.test.ts', "it('AC-1 works', () => {});\n");
    const partial = { ...failingResult('x'), failures: undefined, errors: undefined };
    const built = buildChangeTraceabilityMap({
      projectRoot: root,
      dirName: dir,
      changedFiles: ['tests/a.test.ts'],
      testResults: [partial as unknown as StructuredTestResult],
      lane: 'full',
    });
    expect(proving(built!.map)).toEqual(['AC-1']);
  });

  it('skips a corrupt compliance report and an obligation with no evidence list', () => {
    const root = project();
    const dir = openChange(root, 'ses-corrupt');
    writeSpec(root, dir, [{ id: 'AC-1', proof: 'automated' }]);
    write(root, '.paqad/compliance/broken/report.json', '{not json');
    write(
      root,
      '.paqad/compliance/ok/report.json',
      JSON.stringify({ obligations: [{ obligation_id: 'OBL-9', description: 'no list' }] }),
    );
    const built = buildChangeTraceabilityMap({
      projectRoot: root,
      dirName: dir,
      changedFiles: [],
      lane: 'full',
    });
    expect(built!.map.forward.find((link) => link.promise_id === 'OBL-9')?.proven).toBe(false);
  });
});

describe('buildAndWriteChangeTraceabilityMap', () => {
  it('AC-29: writes the built map through the traceability writer', async () => {
    const root = project();
    const dir = openChange(root, 'ses-write');
    writeSpec(root, dir, [{ id: 'AC-1', proof: 'automated' }]);
    write(root, 'tests/a.test.ts', "it('AC-1 works', () => {});\n");
    const errors: string[] = [];

    const built = await buildAndWriteChangeTraceabilityMap(
      { projectRoot: root, dirName: dir, changedFiles: ['tests/a.test.ts'], lane: 'full' },
      (message) => errors.push(message),
    );

    expect(built.error).toBeNull();
    expect(errors).toEqual([]);
    const onDisk = await readTraceabilityMap(root);
    expect(onDisk?.scope).toBe('change');
    expect(proving(onDisk!)).toEqual(['AC-1']);
  });

  it('writes nothing and reports no error when there is no frozen spec', async () => {
    const root = project();
    const built = await buildAndWriteChangeTraceabilityMap(
      { projectRoot: root, dirName: null, changedFiles: [], lane: 'full' },
      () => {},
    );
    expect(built).toEqual({ result: null, error: null });
    expect(await readTraceabilityMap(root)).toBeNull();
  });

  it('returns the build fault as an error instead of throwing', async () => {
    const root = project();
    const errors: string[] = [];
    const built = await buildAndWriteChangeTraceabilityMap(
      {
        projectRoot: root,
        dirName: openChangeWithSpec(root),
        changedFiles: 42 as unknown as string[],
        lane: 'full',
      },
      (message) => errors.push(message),
    );
    expect(built.result).toBeNull();
    expect(built.error).toContain('could not build the acceptance-criteria map');
    expect(errors).toHaveLength(1);
  });

  it('reports a thrown non-Error as text', async () => {
    const root = project();
    const throwing = {
      [Symbol.iterator]() {
        throw 'plain text fault';
      },
    };
    const built = await buildAndWriteChangeTraceabilityMap(
      {
        projectRoot: root,
        dirName: openChangeWithSpec(root),
        changedFiles: throwing as unknown as string[],
        lane: 'full',
      },
      () => {},
    );
    expect(built.error).toContain('(plain text fault)');
  });

  it('keeps the built map when only the write fails', async () => {
    const root = project();
    const dir = openChangeWithSpec(root);
    writeFileSync(join(root, '.paqad/traceability'), 'not a directory');
    const errors: string[] = [];
    const built = await buildAndWriteChangeTraceabilityMap(
      { projectRoot: root, dirName: dir, changedFiles: [], lane: 'full' },
      (message) => errors.push(message),
    );
    expect(built.result).not.toBeNull();
    expect(built.error).toBeNull();
    expect(errors[0]).toContain('could not write the acceptance-criteria map');
  });
});

function openChangeWithSpec(root: string): string {
  const dir = openChange(root, `ses-${Math.random().toString(36).slice(2)}`);
  writeSpec(root, dir, [{ id: 'AC-1', proof: 'automated' }]);
  return dir;
}

describe('change scoping over a real git branch (AC-30)', () => {
  it('AC-30: a test committed on the branch proves its criterion; an unchanged test on main does not', async () => {
    const root = makeEmptyRepo('main');
    roots.push(root);
    writeRepoFile(root, 'tests/old.test.ts', "it('AC-2 already on main', () => {});\n");
    commitAll(root, 'base');
    git(root, ['switch', '-q', '-c', 'feat/ord-501']);
    const dir = openChange(root, 'ses-git');
    writeRepoFile(root, 'tests/new.test.ts', "it('AC-1 exports the CSV', () => {});\n");
    commitAll(root, 'the change');
    writeRepoFile(root, 'tests/wip.test.ts', "describe('AC-3 in progress', () => {});\n");
    writeSpec(root, dir, [
      { id: 'AC-1', proof: 'automated' },
      { id: 'AC-2', proof: 'automated' },
      { id: 'AC-3', proof: 'automated' },
    ]);

    const changedFiles = (await loadChangeEvidence(root)).files;
    expect(changedFiles).toContain('tests/new.test.ts');
    expect(changedFiles).not.toContain('tests/old.test.ts');

    const built = buildChangeTraceabilityMap({
      projectRoot: root,
      dirName: dir,
      changedFiles,
      lane: 'full',
    });
    expect(proving(built!.map)).toEqual(['AC-1', 'AC-3']);
  });
});
