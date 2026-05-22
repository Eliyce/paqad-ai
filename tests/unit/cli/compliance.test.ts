import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  createComplianceCommand,
  formatBoundaryReport,
  formatSpecReviewSummary,
} from '@/cli/commands/compliance.js';
import { recordFindings } from '@/compliance/defect-patterns/store.js';
import { loadObligationIndex } from '@/compliance/index-store.js';
import { loadSpecReviewReport } from '@/compliance/spec-review-store.js';

async function makeTempProject(): Promise<string> {
  const root = path.join(os.tmpdir(), `paqad-ai-${Date.now()}-${Math.random()}`);
  await mkdir(root, { recursive: true });
  await mkdir(path.join(root, 'docs'), { recursive: true });
  await mkdir(path.join(root, 'tests'), { recursive: true });
  return root;
}

const INDEX_PATH = '.paqad/compliance/obligation-index.json';

async function writeSpecWithObligations(root: string, ids: string[]): Promise<string> {
  const specPath = path.join(root, 'docs', 'spec.md');
  const rows = ids.map((id) => `| ${id} | Condition | Unit | OK |`).join('\n');
  await writeFile(
    specPath,
    [
      '# Spec',
      '',
      '| Test ID | Condition | Method | Pass Criteria |',
      '|---|---|---|---|',
      rows,
      '',
    ].join('\n'),
    'utf8',
  );
  return specPath;
}

describe('paqad-ai compliance CLI', () => {
  it('extract persists an index and check returns a report exit code', async () => {
    const root = await makeTempProject();
    const specPath = await writeSpecWithObligations(root, ['FR-1-T1']);

    const cmd = createComplianceCommand();

    process.exitCode = undefined;
    await cmd.parseAsync([
      'node',
      'paqad-ai',
      'extract',
      '--project-root',
      root,
      '--spec',
      path.relative(root, specPath),
      '--index-path',
      INDEX_PATH,
    ]);

    const index = await loadObligationIndex({ project_root: root, index_path: INDEX_PATH });
    expect(index?.obligations.length).toBe(1);

    await writeFile(
      path.join(root, 'tests', 'x.test.ts'),
      ['it("x", () => {', '  // @obligation FR-1-T1', '});', ''].join('\n'),
      'utf8',
    );

    process.exitCode = undefined;
    await cmd.parseAsync([
      'node',
      'paqad-ai',
      'check',
      '--project-root',
      root,
      '--index-path',
      INDEX_PATH,
    ]);
    expect(process.exitCode).toBe(0);
  });

  it('doctor warns when index is missing and skeleton fails without index', async () => {
    const root = await makeTempProject();
    const cmd = createComplianceCommand();

    process.exitCode = undefined;
    await cmd.parseAsync([
      'node',
      'paqad-ai',
      'doctor',
      '--project-root',
      root,
      '--index-path',
      INDEX_PATH,
    ]);
    expect(process.exitCode).toBe(0);

    process.exitCode = undefined;
    await cmd.parseAsync([
      'node',
      'paqad-ai',
      'skeleton',
      '--project-root',
      root,
      '--index-path',
      INDEX_PATH,
      '--out',
      'tests/compliance-skeletons',
    ]);
    expect(process.exitCode).toBe(1);
  });

  it('doctor fails when an index is present but invalid', async () => {
    const root = await makeTempProject();
    await mkdir(path.join(root, '.paqad', 'compliance'), { recursive: true });
    await writeFile(
      path.join(root, '.paqad', 'compliance', 'obligation-index.json'),
      JSON.stringify({ metadata: { schema_version: 999 }, obligations: [] }),
      'utf8',
    );

    const cmd = createComplianceCommand();
    process.exitCode = undefined;
    await cmd.parseAsync([
      'node',
      'paqad-ai',
      'doctor',
      '--project-root',
      root,
      '--index-path',
      INDEX_PATH,
    ]);
    expect(process.exitCode).toBe(1);
  });

  it('check exits 1 when index is missing, and skeleton succeeds after extraction', async () => {
    const root = await makeTempProject();
    const cmd = createComplianceCommand();

    process.exitCode = undefined;
    await cmd.parseAsync([
      'node',
      'paqad-ai',
      'check',
      '--project-root',
      root,
      '--index-path',
      INDEX_PATH,
    ]);
    expect(process.exitCode).toBe(1);

    const specPath = await writeSpecWithObligations(root, ['FR-1-T1']);

    process.exitCode = undefined;
    await cmd.parseAsync([
      'node',
      'paqad-ai',
      'extract',
      '--project-root',
      root,
      '--spec',
      path.relative(root, specPath),
      '--index-path',
      INDEX_PATH,
    ]);
    expect(process.exitCode).toBe(0);

    process.exitCode = undefined;
    await cmd.parseAsync([
      'node',
      'paqad-ai',
      'skeleton',
      '--project-root',
      root,
      '--index-path',
      INDEX_PATH,
      '--out',
      'tests/compliance-skeletons',
    ]);
    expect(process.exitCode).toBe(0);
  });

  it('check exits 1 when the index is invalid', async () => {
    const root = await makeTempProject();
    await mkdir(path.join(root, '.paqad', 'compliance'), { recursive: true });
    await writeFile(
      path.join(root, '.paqad', 'compliance', 'obligation-index.json'),
      JSON.stringify({ metadata: { schema_version: 999 }, obligations: [] }),
      'utf8',
    );

    const cmd = createComplianceCommand();
    process.exitCode = undefined;
    await cmd.parseAsync([
      'node',
      'paqad-ai',
      'check',
      '--project-root',
      root,
      '--index-path',
      INDEX_PATH,
    ]);
    expect(process.exitCode).toBe(1);
  });

  it('check exits 1 when obligations are uncovered', async () => {
    const root = await makeTempProject();
    await mkdir(path.join(root, '.paqad', 'compliance'), { recursive: true });
    await writeFile(
      path.join(root, '.paqad', 'compliance', 'obligation-index.json'),
      JSON.stringify({
        metadata: {
          spec_file: 'docs/spec.md',
          spec_hash: 'hash',
          extracted_at: '2026-04-07T00:00:00.000Z',
          obligation_count: 1,
          schema_version: 1,
          warnings: [],
        },
        obligations: [
          {
            obligation_id: 'FR-1-T1',
            category: 'functional',
            description: 'Uncovered',
            pass_criteria: null,
            source_section: 'Spec',
            source_line: 1,
            spec_file: 'docs/spec.md',
          },
        ],
      }),
      'utf8',
    );
    await writeFile(path.join(root, 'tests', 'empty.test.ts'), 'export {};', 'utf8');

    const cmd = createComplianceCommand();
    process.exitCode = undefined;
    await cmd.parseAsync([
      'node',
      'paqad-ai',
      'check',
      '--project-root',
      root,
      '--index-path',
      INDEX_PATH,
    ]);
    expect(process.exitCode).toBe(1);
  });

  // --- report command ---

  it('report exits 0 when all obligations are covered and prints human-readable output', async () => {
    const root = await makeTempProject();
    const specPath = await writeSpecWithObligations(root, ['FR-1-T1']);
    const cmd = createComplianceCommand();

    await cmd.parseAsync([
      'node',
      'paqad-ai',
      'extract',
      '--project-root',
      root,
      '--spec',
      path.relative(root, specPath),
      '--index-path',
      INDEX_PATH,
    ]);

    await writeFile(
      path.join(root, 'tests', 'covered.test.ts'),
      ["it('FR-1-T1: test name covers it', () => {});", ''].join('\n'),
      'utf8',
    );

    const lines: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => lines.push(msg);

    process.exitCode = undefined;
    await cmd.parseAsync([
      'node',
      'paqad-ai',
      'report',
      '--project-root',
      root,
      '--index-path',
      INDEX_PATH,
    ]);

    console.log = origLog;

    expect(process.exitCode).toBe(0);
    const output = lines.join('\n');
    expect(output).toContain('Compliance Report');
    expect(output).toContain('Covered:');
    expect(output).toContain('100.0%');
  });

  it('report exits 1 when obligations are uncovered', async () => {
    const root = await makeTempProject();
    const specPath = await writeSpecWithObligations(root, ['FR-1-T1']);
    const cmd = createComplianceCommand();

    await cmd.parseAsync([
      'node',
      'paqad-ai',
      'extract',
      '--project-root',
      root,
      '--spec',
      path.relative(root, specPath),
      '--index-path',
      INDEX_PATH,
    ]);

    process.exitCode = undefined;
    await cmd.parseAsync([
      'node',
      'paqad-ai',
      'report',
      '--project-root',
      root,
      '--index-path',
      INDEX_PATH,
    ]);
    expect(process.exitCode).toBe(1);
  });

  it('report includes spec defect counts and warnings when a review exists', async () => {
    const root = await makeTempProject();
    const specPath = path.join(root, 'docs', 'spec.md');
    await writeFile(
      specPath,
      [
        '# Spec',
        '',
        'FR-SQ-1 compliance_ratio = covered / total',
        'FR-SQ-2 indeterminate obligations must be excluded from the denominator',
        '',
        '| Test ID | Condition | Method | Pass Criteria |',
        '|---|---|---|---|',
        '| FR-1-T1 | Condition | Unit | OK |',
        '',
      ].join('\n'),
      'utf8',
    );
    const relativeSpec = path.relative(root, specPath);
    const cmd = createComplianceCommand();

    await cmd.parseAsync(['node', 'paqad-ai', 'review', relativeSpec, '--project-root', root]);
    await cmd.parseAsync([
      'node',
      'paqad-ai',
      'extract',
      '--project-root',
      root,
      '--spec',
      relativeSpec,
      '--index-path',
      INDEX_PATH,
    ]);

    const lines: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => lines.push(msg);

    process.exitCode = undefined;
    await cmd.parseAsync([
      'node',
      'paqad-ai',
      'report',
      '--project-root',
      root,
      '--spec',
      relativeSpec,
      '--index-path',
      INDEX_PATH,
    ]);

    console.log = origLog;

    const output = lines.join('\n');
    expect(output).toContain('Spec defects:');
    expect(output).toContain('Warning:');
  });

  it('report renders partial obligations with evidence paths', async () => {
    const root = await makeTempProject();
    await mkdir(path.join(root, '.paqad', 'compliance'), { recursive: true });
    await writeFile(
      path.join(root, '.paqad', 'compliance', 'obligation-index.json'),
      JSON.stringify({
        metadata: {
          spec_file: 'docs/spec.md',
          spec_hash: 'hash',
          extracted_at: '2026-04-07T00:00:00.000Z',
          obligation_count: 1,
          schema_version: 1,
          warnings: [],
        },
        obligations: [
          {
            obligation_id: 'FR-1-T1',
            category: 'functional',
            description: 'Partially covered obligation',
            pass_criteria: 'Works end-to-end',
            source_section: 'Spec',
            source_line: 1,
            spec_file: 'docs/spec.md',
          },
        ],
      }),
      'utf8',
    );
    await writeFile(
      path.join(root, 'tests', 'partial.test.ts'),
      [
        "it('partial evidence exists', () => {",
        '  // implementation note',
        '});',
        '// FR-1-T1',
        '',
      ].join('\n'),
      'utf8',
    );

    const cmd = createComplianceCommand();
    const lines: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => lines.push(msg);

    process.exitCode = undefined;
    await cmd.parseAsync([
      'node',
      'paqad-ai',
      'report',
      '--project-root',
      root,
      '--index-path',
      INDEX_PATH,
    ]);

    console.log = origLog;

    expect(process.exitCode).toBe(0);
    const output = lines.join('\n');
    expect(output).toContain('Partial obligations:');
    expect(output).toContain('[FR-1-T1] Partially covered obligation');
  });

  it('report exits 1 when index is missing', async () => {
    const root = await makeTempProject();
    const cmd = createComplianceCommand();

    process.exitCode = undefined;
    await cmd.parseAsync([
      'node',
      'paqad-ai',
      'report',
      '--project-root',
      root,
      '--index-path',
      INDEX_PATH,
    ]);
    expect(process.exitCode).toBe(1);
  });

  // --- check --gate ---

  it('check --gate passes when compliance ratio meets threshold', async () => {
    const root = await makeTempProject();
    const specPath = await writeSpecWithObligations(root, ['FR-1-T1']);
    const cmd = createComplianceCommand();

    await cmd.parseAsync([
      'node',
      'paqad-ai',
      'extract',
      '--project-root',
      root,
      '--spec',
      path.relative(root, specPath),
      '--index-path',
      INDEX_PATH,
    ]);

    await writeFile(
      path.join(root, 'tests', 'x.test.ts'),
      ['it("x", () => {', '  // @obligation FR-1-T1', '});', ''].join('\n'),
      'utf8',
    );

    process.exitCode = undefined;
    await cmd.parseAsync([
      'node',
      'paqad-ai',
      'check',
      '--project-root',
      root,
      '--index-path',
      INDEX_PATH,
      '--gate',
      '--min-ratio',
      '0.9',
    ]);
    expect(process.exitCode).toBe(0);
  });

  it('check --gate fails when compliance ratio is below threshold', async () => {
    const root = await makeTempProject();
    const specPath = await writeSpecWithObligations(root, ['FR-1-T1', 'FR-1-T2']);
    const cmd = createComplianceCommand();

    await cmd.parseAsync([
      'node',
      'paqad-ai',
      'extract',
      '--project-root',
      root,
      '--spec',
      path.relative(root, specPath),
      '--index-path',
      INDEX_PATH,
    ]);

    // Only cover FR-1-T1, leaving FR-1-T2 uncovered → ratio 0.5
    await writeFile(
      path.join(root, 'tests', 'x.test.ts'),
      ['it("x", () => {', '  // @obligation FR-1-T1', '});', ''].join('\n'),
      'utf8',
    );

    process.exitCode = undefined;
    await cmd.parseAsync([
      'node',
      'paqad-ai',
      'check',
      '--project-root',
      root,
      '--index-path',
      INDEX_PATH,
      '--gate',
      '--min-ratio',
      '0.9',
    ]);
    expect(process.exitCode).toBe(1);
  });

  it('check --gate fails when uncovered critical obligations exceed threshold', async () => {
    const root = await makeTempProject();

    // Write spec with an acceptance obligation
    const specPath = path.join(root, 'docs', 'spec.md');
    await writeFile(
      specPath,
      [
        '# Spec',
        '',
        '## Acceptance Criteria',
        '',
        '| Test ID | Condition | Method | Pass Criteria |',
        '|---|---|---|---|',
        '| AC-1 | Must work | Manual | Works |',
        '',
      ].join('\n'),
      'utf8',
    );

    const cmd = createComplianceCommand();
    await cmd.parseAsync([
      'node',
      'paqad-ai',
      'extract',
      '--project-root',
      root,
      '--spec',
      path.relative(root, specPath),
      '--index-path',
      INDEX_PATH,
    ]);

    process.exitCode = undefined;
    await cmd.parseAsync([
      'node',
      'paqad-ai',
      'check',
      '--project-root',
      root,
      '--index-path',
      INDEX_PATH,
      '--gate',
      '--min-ratio',
      '0',
      '--max-uncovered-critical',
      '0',
    ]);
    expect(process.exitCode).toBe(1);
  });

  // --- spec-slug path derivation (FR-2.1) ---

  it('extract defaults index to spec-slug path when --index-path is omitted', async () => {
    const root = await makeTempProject();
    const specPath = await writeSpecWithObligations(root, ['FR-S-T1']);
    const cmd = createComplianceCommand();

    process.exitCode = undefined;
    await cmd.parseAsync([
      'node',
      'paqad-ai',
      'extract',
      '--project-root',
      root,
      '--spec',
      path.relative(root, specPath),
      // no --index-path
    ]);
    expect(process.exitCode).toBe(0);

    // Index must land in the spec-slug directory, not the legacy flat path
    const slugIndex = await loadObligationIndex({
      project_root: root,
      index_path: '.paqad/compliance/spec/obligations.json',
    });
    expect(slugIndex?.obligations.length).toBe(1);

    // Legacy path must NOT exist
    const legacyIndex = await loadObligationIndex({
      project_root: root,
      index_path: INDEX_PATH,
    });
    expect(legacyIndex).toBeNull();
  });

  it('check derives index path from --spec when --index-path is omitted', async () => {
    const root = await makeTempProject();
    const specPath = await writeSpecWithObligations(root, ['FR-S-T2']);
    const cmd = createComplianceCommand();

    // Extract using spec-slug path
    await cmd.parseAsync([
      'node',
      'paqad-ai',
      'extract',
      '--project-root',
      root,
      '--spec',
      path.relative(root, specPath),
    ]);

    // Cover the obligation
    await writeFile(
      path.join(root, 'tests', 'x.test.ts'),
      "it('x', () => { /* @obligation FR-S-T2 */ });\n",
      'utf8',
    );

    process.exitCode = undefined;
    const cmd2 = createComplianceCommand();
    await cmd2.parseAsync([
      'node',
      'paqad-ai',
      'check',
      '--project-root',
      root,
      '--spec',
      path.relative(root, specPath),
      // no --index-path
    ]);
    expect(process.exitCode).toBe(0);
  });

  it('doctor falls back to the legacy default index path when no spec or index path is provided', async () => {
    const root = await makeTempProject();
    await mkdir(path.join(root, '.paqad', 'compliance'), { recursive: true });
    await writeFile(
      path.join(root, '.paqad', 'compliance', 'obligation-index.json'),
      JSON.stringify({
        metadata: {
          spec_file: 'docs/spec.md',
          spec_hash: 'hash',
          extracted_at: '2026-04-07T00:00:00.000Z',
          obligation_count: 0,
          schema_version: 1,
          warnings: [],
        },
        obligations: [],
      }),
      'utf8',
    );

    const cmd = createComplianceCommand();
    process.exitCode = undefined;
    await cmd.parseAsync(['node', 'paqad-ai', 'doctor', '--project-root', root]);
    expect(process.exitCode).toBe(0);
  });

  // --- skeleton --all ---

  it('skeleton --all generates stubs for all obligations including covered ones', async () => {
    const root = await makeTempProject();
    const specPath = await writeSpecWithObligations(root, ['FR-1-T1', 'FR-1-T2']);
    const cmd = createComplianceCommand();

    await cmd.parseAsync([
      'node',
      'paqad-ai',
      'extract',
      '--project-root',
      root,
      '--spec',
      path.relative(root, specPath),
      '--index-path',
      INDEX_PATH,
    ]);

    // Cover FR-1-T1 so only FR-1-T2 is uncovered
    await writeFile(
      path.join(root, 'tests', 'x.test.ts'),
      ['it("x", () => {', '  // @obligation FR-1-T1', '});', ''].join('\n'),
      'utf8',
    );

    // Without --all: only FR-1-T2 skeleton
    process.exitCode = undefined;
    const cmd2 = createComplianceCommand();
    const writtenPartial: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => {
      try {
        writtenPartial.push(...(JSON.parse(msg).written ?? []));
      } catch {
        /* ignore */
      }
    };
    await cmd2.parseAsync([
      'node',
      'paqad-ai',
      'skeleton',
      '--project-root',
      root,
      '--index-path',
      INDEX_PATH,
      '--out',
      'tests/skeletons-partial',
    ]);
    console.log = origLog;
    expect(writtenPartial).toHaveLength(1);

    // With --all: both skeletons
    const writtenAll: string[] = [];
    const cmd3 = createComplianceCommand();
    console.log = (msg: string) => {
      try {
        writtenAll.push(...(JSON.parse(msg).written ?? []));
      } catch {
        /* ignore */
      }
    };
    process.exitCode = undefined;
    await cmd3.parseAsync([
      'node',
      'paqad-ai',
      'skeleton',
      '--project-root',
      root,
      '--index-path',
      INDEX_PATH,
      '--out',
      'tests/skeletons-all',
      '--all',
    ]);
    console.log = origLog;
    expect(writtenAll).toHaveLength(2);
  });

  it('skeleton loads an existing spec review when --spec is supplied', async () => {
    const root = await makeTempProject();
    const specPath = path.join(root, 'docs', 'spec.md');
    await writeFile(
      specPath,
      [
        '# Spec',
        '',
        'FR-SQ-1 compliance_ratio = covered / total',
        'FR-SQ-2 indeterminate obligations must be excluded from the denominator',
        '',
        '| Test ID | Condition | Method | Pass Criteria |',
        '|---|---|---|---|',
        '| FR-1-T1 | Condition | Unit | OK |',
        '',
      ].join('\n'),
      'utf8',
    );
    const relativeSpec = path.relative(root, specPath);
    const cmd = createComplianceCommand();

    await cmd.parseAsync(['node', 'paqad-ai', 'review', relativeSpec, '--project-root', root]);
    await cmd.parseAsync([
      'node',
      'paqad-ai',
      'extract',
      '--project-root',
      root,
      '--spec',
      relativeSpec,
      '--index-path',
      INDEX_PATH,
    ]);

    process.exitCode = undefined;
    await cmd.parseAsync([
      'node',
      'paqad-ai',
      'skeleton',
      '--project-root',
      root,
      '--spec',
      relativeSpec,
      '--index-path',
      INDEX_PATH,
      '--out',
      'tests/spec-skeletons',
    ]);

    expect(process.exitCode).toBe(0);
  });

  it('review persists a spec review report and supports --json output', async () => {
    const root = await makeTempProject();
    const specPath = path.join(root, 'docs', 'spec.md');
    await writeFile(
      specPath,
      [
        '# Spec',
        '',
        'FR-SQ-1 compliance_ratio = covered / total',
        'FR-SQ-2 indeterminate obligations must be excluded from the denominator',
        '',
      ].join('\n'),
      'utf8',
    );

    const lines: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => lines.push(msg);

    const cmd = createComplianceCommand();
    await cmd.parseAsync([
      'node',
      'paqad-ai',
      'review',
      path.relative(root, specPath),
      '--project-root',
      root,
      '--json',
    ]);

    console.log = origLog;

    const report = JSON.parse(lines.join('\n')) as { metadata: { defect_count: number } };
    expect(report.metadata.defect_count).toBe(1);
    await expect(
      loadSpecReviewReport({ project_root: root, spec_file: path.relative(root, specPath) }),
    ).resolves.toBeTruthy();
  });

  it('review includes pattern advisories from the defect-pattern store', async () => {
    const root = await makeTempProject();
    const specPath = path.join(root, 'docs', 'spec.md');
    const relativeSpec = path.relative(root, specPath);
    await writeFile(specPath, ['# Spec', '', 'FR-1 text', ''].join('\n'), 'utf8');

    await recordFindings(
      [
        {
          defect_id: 'docs/spec.md:FR-1',
          source: 'compliance',
          category: 'D5',
          subcategory: 'D5.missing-boundary',
          spec_file: 'docs/spec.md',
          obligation_id: 'FR-1',
          stack_context: { frameworks: ['react'], traits: ['typescript'] },
          description: 'Missing boundary handling in recurring implementations.',
          file_path: 'src/example.ts',
          recorded_at: new Date().toISOString(),
          resolved: false,
          recurrence_count: 1,
        },
        {
          defect_id: 'docs/spec.md:FR-2',
          source: 'compliance',
          category: 'D5',
          subcategory: 'D5.missing-boundary',
          spec_file: 'docs/spec.md',
          obligation_id: 'FR-2',
          stack_context: { frameworks: ['react'], traits: ['typescript'] },
          description: 'Missing boundary handling in recurring implementations.',
          file_path: 'src/example.ts',
          recorded_at: new Date().toISOString(),
          resolved: false,
          recurrence_count: 1,
        },
      ],
      path.join(root, '.paqad', 'defect-patterns'),
    );

    const cmd = createComplianceCommand();
    await cmd.parseAsync(['node', 'paqad-ai', 'review', relativeSpec, '--project-root', root]);

    const report = await loadSpecReviewReport({ project_root: root, spec_file: relativeSpec });
    expect(report?.pattern_advisories.length).toBeGreaterThan(0);
  });

  it('review prints resolved findings carried forward in human output', async () => {
    const root = await makeTempProject();
    const specPath = path.join(root, 'docs', 'spec.md');
    const relativeSpec = path.relative(root, specPath);
    await writeFile(
      specPath,
      [
        '# Spec',
        '',
        'FR-SQ-1 compliance_ratio = covered / total',
        'FR-SQ-2 indeterminate obligations must be excluded from the denominator',
        '',
      ].join('\n'),
      'utf8',
    );

    const cmd = createComplianceCommand();
    await cmd.parseAsync(['node', 'paqad-ai', 'review', relativeSpec, '--project-root', root]);
    await writeFile(
      specPath,
      ['# Spec', '', 'FR-SQ-1 compliance_ratio = covered / (total - indeterminate)', ''].join('\n'),
      'utf8',
    );

    const lines: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => lines.push(msg);

    await cmd.parseAsync(['node', 'paqad-ai', 'review', relativeSpec, '--project-root', root]);

    console.log = origLog;

    expect(lines.join('\n')).toContain('Resolved findings carried forward: 1');
  });

  it('formatSpecReviewSummary falls back to default location labels when a defect location is missing', () => {
    const output = formatSpecReviewSummary({
      metadata: {
        spec_file: 'docs/spec.md',
        spec_hash: 'hash',
        reviewed_at: '2026-04-08T00:00:00.000Z',
        defect_count: 1,
        schema_version: 1,
      },
      defects: [
        {
          defect_id: 'SQ-1',
          category: 'contradiction',
          severity: 'critical',
          description: 'Fallback location',
          locations: [],
          suggested_resolution: 'Fix',
          affected_obligation_ids: [],
          status: 'new',
        },
      ],
      pattern_advisories: [],
    });

    expect(output).toContain('[critical] contradiction at Spec:0');
  });

  it('check --gate reports spec review fields when a non-critical review exists', async () => {
    const root = await makeTempProject();
    const specPath = path.join(root, 'docs', 'spec.md');
    await writeFile(
      specPath,
      [
        '# Spec',
        '',
        '| Test ID | Condition | Method | Pass Criteria |',
        '|---|---|---|---|',
        '| FR-1-T1 | Condition | Unit | OK |',
        '',
      ].join('\n'),
      'utf8',
    );

    await mkdir(path.join(root, '.paqad', 'compliance', 'spec'), { recursive: true });
    await writeFile(
      path.join(root, '.paqad', 'compliance', 'spec', 'spec-review.json'),
      JSON.stringify({
        metadata: {
          spec_file: 'docs/spec.md',
          spec_hash: 'hash',
          reviewed_at: '2026-04-08T00:00:00.000Z',
          defect_count: 1,
          schema_version: 1,
        },
        defects: [
          {
            defect_id: 'SQ-1',
            category: 'boundary_gap',
            severity: 'major',
            description: 'Major but non-critical defect',
            locations: [{ section: 'Spec', line_range: [1, 1], text_excerpt: 'x' }],
            suggested_resolution: 'Fix',
            affected_obligation_ids: [],
            status: 'new',
          },
        ],
        pattern_advisories: [],
      }),
      'utf8',
    );

    const cmd = createComplianceCommand();
    await cmd.parseAsync([
      'node',
      'paqad-ai',
      'extract',
      '--project-root',
      root,
      '--spec',
      path.relative(root, specPath),
      '--index-path',
      INDEX_PATH,
    ]);

    await writeFile(
      path.join(root, 'tests', 'covered.test.ts'),
      ["it('FR-1-T1 covered', () => {});", ''].join('\n'),
      'utf8',
    );

    const lines: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => lines.push(msg);

    process.exitCode = undefined;
    await cmd.parseAsync([
      'node',
      'paqad-ai',
      'check',
      '--project-root',
      root,
      '--spec',
      path.relative(root, specPath),
      '--index-path',
      INDEX_PATH,
      '--gate',
      '--min-ratio',
      '0.9',
    ]);

    console.log = origLog;

    expect(process.exitCode).toBe(0);
    expect(JSON.parse(lines.join('\n'))).toMatchObject({
      gate_result: 'pass',
      spec_defect_count: 1,
      spec_defect_warning: null,
    });
  });

  it('check loads spec review correctly when --spec is passed as an absolute path', async () => {
    const root = await makeTempProject();
    const specPath = path.join(root, 'docs', 'spec.md');
    await writeFile(
      specPath,
      [
        '# Spec',
        '',
        'FR-SQ-1 compliance_ratio = covered / total',
        'FR-SQ-2 indeterminate obligations must be excluded from the denominator',
        '',
        '| Test ID | Condition | Method | Pass Criteria |',
        '|---|---|---|---|',
        '| FR-1-T1 | Condition | Unit | OK |',
        '',
      ].join('\n'),
      'utf8',
    );

    const cmd = createComplianceCommand();
    await cmd.parseAsync([
      'node',
      'paqad-ai',
      'review',
      path.relative(root, specPath),
      '--project-root',
      root,
    ]);
    await cmd.parseAsync([
      'node',
      'paqad-ai',
      'extract',
      '--project-root',
      root,
      '--spec',
      path.relative(root, specPath),
      '--index-path',
      INDEX_PATH,
    ]);
    await writeFile(
      path.join(root, 'tests', 'covered.test.ts'),
      "it('FR-1-T1', () => {});\n",
      'utf8',
    );

    const lines: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => lines.push(msg);

    process.exitCode = undefined;
    await cmd.parseAsync([
      'node',
      'paqad-ai',
      'check',
      '--project-root',
      root,
      '--spec',
      specPath,
      '--index-path',
      INDEX_PATH,
      '--gate',
      '--min-ratio',
      '0',
    ]);

    console.log = origLog;

    expect(process.exitCode).toBe(0);
    expect(JSON.parse(lines.join('\n'))).toMatchObject({
      gate_result: 'pass',
      spec_defect_count: 1,
    });
  });

  it('doctor warns when the spec review is stale relative to the spec file', async () => {
    const root = await makeTempProject();
    const specPath = await writeSpecWithObligations(root, ['FR-1-T1']);
    const relativeSpec = path.relative(root, specPath);
    const cmd = createComplianceCommand();

    await cmd.parseAsync(['node', 'paqad-ai', 'review', relativeSpec, '--project-root', root]);

    await new Promise((resolve) => setTimeout(resolve, 20));
    await writeFile(
      specPath,
      (await readFile(specPath, 'utf8')) + '\nFR-1-T2 always foo\n',
      'utf8',
    );

    const lines: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => lines.push(msg);

    process.exitCode = undefined;
    await cmd.parseAsync([
      'node',
      'paqad-ai',
      'doctor',
      '--project-root',
      root,
      '--spec',
      relativeSpec,
    ]);

    console.log = origLog;

    const output = lines.join('\n');
    expect(process.exitCode).toBe(0);
    expect(output).toContain('No obligation index found.');
    expect(output).toContain('stale');
  });

  // ── compliance boundary ──────────────────────────────────────────────────

  it('boundary exits 0 and prints human-readable output by default', async () => {
    const root = await makeTempProject();
    await mkdir(path.join(root, 'src'), { recursive: true });
    const cmd = createComplianceCommand();

    const lines: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => lines.push(msg);

    process.exitCode = undefined;
    await cmd.parseAsync(['node', 'paqad-ai', 'boundary', '--project-root', root]);

    console.log = origLog;
    expect(process.exitCode).toBe(0);
    expect(lines.join('\n')).toContain('Boundary Report');
  });

  it('boundary --json prints JSON output', async () => {
    const root = await makeTempProject();
    await mkdir(path.join(root, 'src'), { recursive: true });
    const cmd = createComplianceCommand();

    const lines: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => lines.push(msg);

    process.exitCode = undefined;
    await cmd.parseAsync(['node', 'paqad-ai', 'boundary', '--project-root', root, '--json']);

    console.log = origLog;
    const report = JSON.parse(lines.join('\n'));
    expect(report).toHaveProperty('gate_result');
    expect(report).toHaveProperty('metadata');
  });

  it('boundary --generate creates test stubs for unhandled variants', async () => {
    const root = await makeTempProject();
    await mkdir(path.join(root, 'src'), { recursive: true });
    await writeFile(
      path.join(root, 'src', 'types.ts'),
      `// @boundary GateResult producer:spec-a consumer:spec-b states:pass,fail\n`,
      'utf8',
    );
    const cmd = createComplianceCommand();

    process.exitCode = undefined;
    await cmd.parseAsync(['node', 'paqad-ai', 'boundary', '--project-root', root, '--generate']);

    expect(process.exitCode).toBe(0);
    const { readdir } = await import('node:fs/promises');
    const stubDir = path.join(root, '.paqad', 'compliance', 'boundary-tests');
    const files = await readdir(stubDir);
    expect(files.length).toBeGreaterThan(0);
  });

  it('formatBoundaryReport includes unhandled-variant lines', () => {
    const output = formatBoundaryReport({
      metadata: { generated_at: new Date().toISOString(), schema_version: 1 },
      total_interfaces: 1,
      total_states: 3,
      handled_count: 2,
      unhandled_count: 1,
      gate_result: 'warn',
      interfaces: [
        {
          type_name: 'GateResult',
          file: 'src/types.ts',
          producer_spec: 'spec-a',
          consumer_specs: ['spec-b'],
          total_states: 3,
          unhandled_variants: [
            {
              type_name: 'GateResult',
              state: 'warn',
              producer_spec: 'spec-a',
              consumer_spec: 'spec-b',
            },
          ],
        },
      ],
    });
    expect(output).toContain('WARN');
    expect(output).toContain('[unhandled]');
    expect(output).toContain('"warn"');
  });

  // ── compliance patterns ───────────────────────────────────────────────────

  it('patterns lists an empty store without error', async () => {
    const root = await makeTempProject();
    const cmd = createComplianceCommand();

    const lines: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => lines.push(msg);

    process.exitCode = undefined;
    await cmd.parseAsync(['node', 'paqad-ai', 'patterns', '--project-root', root]);

    console.log = origLog;
    expect(process.exitCode).toBe(0);
    expect(JSON.parse(lines.join('\n'))).toEqual([]);
  });

  it('patterns --prune removes stale entries and reports count', async () => {
    const root = await makeTempProject();
    const cmd = createComplianceCommand();

    const lines: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => lines.push(msg);

    process.exitCode = undefined;
    await cmd.parseAsync([
      'node',
      'paqad-ai',
      'patterns',
      '--prune',
      '365',
      '--project-root',
      root,
    ]);

    console.log = origLog;
    const output = JSON.parse(lines.join('\n'));
    expect(output).toHaveProperty('pruned');
    expect(process.exitCode).toBe(0);
  });

  it('patterns --prune without a day argument uses default 365', async () => {
    const root = await makeTempProject();
    const cmd = createComplianceCommand();

    const lines: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => lines.push(msg);

    process.exitCode = undefined;
    await cmd.parseAsync(['node', 'paqad-ai', 'patterns', '--prune', '--project-root', root]);

    console.log = origLog;
    expect(JSON.parse(lines.join('\n'))).toHaveProperty('pruned');
  });

  it('patterns --export writes JSON file by default', async () => {
    const root = await makeTempProject();
    const exportPath = path.join(root, 'patterns.json');
    const cmd = createComplianceCommand();

    const lines: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => lines.push(msg);

    process.exitCode = undefined;
    await cmd.parseAsync([
      'node',
      'paqad-ai',
      'patterns',
      '--export',
      exportPath,
      '--project-root',
      root,
    ]);

    console.log = origLog;
    expect(process.exitCode).toBe(0);
    const exported = JSON.parse(await readFile(exportPath, 'utf8'));
    expect(Array.isArray(exported)).toBe(true);
  });

  it('patterns --export --format markdown writes markdown file', async () => {
    const root = await makeTempProject();
    const exportPath = path.join(root, 'patterns.md');
    const cmd = createComplianceCommand();

    const lines: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => lines.push(msg);

    process.exitCode = undefined;
    await cmd.parseAsync([
      'node',
      'paqad-ai',
      'patterns',
      '--export',
      exportPath,
      '--format',
      'markdown',
      '--project-root',
      root,
    ]);

    console.log = origLog;
    expect(process.exitCode).toBe(0);
    const content = await readFile(exportPath, 'utf8');
    expect(content).toContain('# Defect Patterns');
  });

  it('patterns --export --format markdown includes pattern sections when store is populated', async () => {
    const root = await makeTempProject();
    const exportPath = path.join(root, 'patterns.md');
    const cmd = createComplianceCommand();

    await recordFindings(
      [
        {
          defect_id: 'docs/spec.md:FR-1-T1',
          source: 'compliance',
          category: 'D5',
          subcategory: 'D5.missing-boundary',
          spec_file: 'docs/spec.md',
          obligation_id: 'FR-1-T1',
          stack_context: { frameworks: ['react'], traits: ['typescript'] },
          description: 'Missing boundary handling at max length.',
          file_path: 'src/compliance/checker.ts',
          recorded_at: new Date().toISOString(),
          resolved: false,
          recurrence_count: 1,
        },
      ],
      path.join(root, '.paqad', 'defect-patterns'),
    );

    process.exitCode = undefined;
    await cmd.parseAsync([
      'node',
      'paqad-ai',
      'patterns',
      '--export',
      exportPath,
      '--format',
      'markdown',
      '--project-root',
      root,
      '--min-frequency',
      '1',
    ]);

    expect(process.exitCode).toBe(0);
    const content = await readFile(exportPath, 'utf8');
    expect(content).toContain('## D5.missing-boundary');
    expect(content).toContain('**Frequency:**');
    expect(content).toContain('Missing boundary handling at max length.');
  });

  it('doctor treats missing spec files as non-stale when staleness cannot be checked', async () => {
    const root = await makeTempProject();
    const specPath = await writeSpecWithObligations(root, ['FR-1-T1']);
    const relativeSpec = path.relative(root, specPath);
    const cmd = createComplianceCommand();

    await cmd.parseAsync(['node', 'paqad-ai', 'review', relativeSpec, '--project-root', root]);
    await rm(specPath);

    process.exitCode = undefined;
    await cmd.parseAsync([
      'node',
      'paqad-ai',
      'doctor',
      '--project-root',
      root,
      '--spec',
      relativeSpec,
    ]);

    expect(process.exitCode).toBe(0);
  });
});
