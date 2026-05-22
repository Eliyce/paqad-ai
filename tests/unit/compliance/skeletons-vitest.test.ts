import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { generateVitestSkeletons, renderVitestSkeleton } from '@/compliance/skeletons/vitest.js';
import type { Obligation } from '@/compliance/types.js';

function makeObligation(obligation_id: string, overrides: Partial<Obligation> = {}): Obligation {
  return {
    obligation_id,
    category: 'functional',
    description: 'Some obligation',
    pass_criteria: null,
    source_section: 'Spec > Tests',
    source_line: 1,
    spec_file: 'docs/spec.md',
    ...overrides,
  };
}

describe('vitest skeletons', () => {
  // FR-5.2: skeleton must contain @obligation annotation and always fail
  it('renders a failing skeleton with an @obligation annotation', () => {
    const skeleton = renderVitestSkeleton(
      makeObligation('FR-1-T1', { description: 'Must do the thing' }),
    );
    expect(skeleton).toContain('// @obligation FR-1-T1');
    expect(skeleton).toContain(
      "expect(false, 'TODO: implement test for this obligation').toBe(true)",
    );
  });

  // FR-5.2: obligation ID must appear in the test name
  it('uses the obligation ID in the test name', () => {
    const skeleton = renderVitestSkeleton(makeObligation('FR-2-T3', { description: 'My desc' }));
    expect(skeleton).toContain('it("FR-2-T3: My desc"');
  });

  // FR-5.2: comment block must include pass_criteria and source_section
  it('includes pass_criteria and source_section in the comment block', () => {
    const skeleton = renderVitestSkeleton(
      makeObligation('FR-3-T1', {
        description: 'Parses tables',
        pass_criteria: 'All rows extracted',
        source_section: 'Spec > FR-3',
        source_line: 42,
      }),
    );
    expect(skeleton).toContain('Pass criteria:  All rows extracted');
    expect(skeleton).toContain('Source:         Spec > FR-3 (line 42)');
  });

  it('renders N/A for pass_criteria when null', () => {
    const skeleton = renderVitestSkeleton(makeObligation('FR-4-T1', { pass_criteria: null }));
    expect(skeleton).toContain('Pass criteria:  N/A');
  });

  it('omits the line number when source_line is null', () => {
    const skeleton = renderVitestSkeleton(
      makeObligation('FR-5-T1', { source_section: 'Spec > AC', source_line: null }),
    );
    expect(skeleton).toContain('Source:         Spec > AC');
    expect(skeleton).not.toContain('(line');
  });

  it('falls back to obligation ID in test name when description is empty', () => {
    const skeleton = renderVitestSkeleton(makeObligation('FR-6-T1', { description: '' }));
    expect(skeleton).toContain('FR-6-T1: Obligation FR-6-T1');
  });

  it('writes one test file per obligation passed', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'paqad-ai-'));

    const obligations: Obligation[] = [
      makeObligation('FR-1-T1', { description: 'First' }),
      makeObligation('FR-1-T2', { description: '' }),
    ];

    const written = await generateVitestSkeletons({
      project_root: root,
      obligations,
      output_dir: 'tests/compliance-skeletons',
    });

    expect(written.length).toBe(2);
    const fileContents = await readFile(written[0]!, 'utf8');
    expect(fileContents).toContain("describe('Spec compliance obligation'");
  });

  it('produces no files when passed an empty obligation list', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'paqad-ai-'));

    const written = await generateVitestSkeletons({
      project_root: root,
      obligations: [],
      output_dir: 'tests/compliance-skeletons',
    });

    expect(written).toHaveLength(0);
  });

  it('only generates stubs for the obligations passed — caller controls filtering (FR-5.5)', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'paqad-ai-'));

    const uncoveredObligations: Obligation[] = [
      makeObligation('FR-2-T1', { description: 'Uncovered one' }),
      makeObligation('FR-2-T2', { description: 'Partial one' }),
    ];

    const written = await generateVitestSkeletons({
      project_root: root,
      obligations: uncoveredObligations,
      output_dir: 'tests/compliance-skeletons',
    });

    expect(written).toHaveLength(2);
    expect(written.some((f) => f.includes('FR-2-T1'))).toBe(true);
    expect(written.some((f) => f.includes('FR-2-T2'))).toBe(true);
  });

  it('returns output files sorted alphabetically', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'paqad-ai-'));

    const written = await generateVitestSkeletons({
      project_root: root,
      obligations: [makeObligation('FR-Z-T1'), makeObligation('FR-A-T1')],
      output_dir: 'tests/compliance-skeletons',
    });

    expect(written[0]).toContain('FR-A-T1');
    expect(written[1]).toContain('FR-Z-T1');
  });

  // FR-5.4: idempotent — second run must not overwrite existing files
  it('does not overwrite existing skeleton files on repeated runs (FR-5.4)', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'paqad-ai-'));
    const obligation = makeObligation('FR-7-T1', { description: 'Should not be overwritten' });

    const [firstRun] = await generateVitestSkeletons({
      project_root: root,
      obligations: [obligation],
      output_dir: 'tests/compliance-skeletons',
    });

    // Simulate developer partially implementing the test
    const customContent = '// developer work in progress';
    await writeFile(firstRun!, customContent, 'utf8');

    // Second run with the same obligation
    await generateVitestSkeletons({
      project_root: root,
      obligations: [obligation],
      output_dir: 'tests/compliance-skeletons',
    });

    // Developer's content must be preserved
    const preserved = await readFile(firstRun!, 'utf8');
    expect(preserved).toBe(customContent);
  });

  // FR-5.4: second run still returns the file path even when not overwriting
  it('still returns the file path on second run even though no write occurs (FR-5.4)', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'paqad-ai-'));
    const obligation = makeObligation('FR-8-T1');

    const firstRun = await generateVitestSkeletons({
      project_root: root,
      obligations: [obligation],
      output_dir: 'tests/compliance-skeletons',
    });

    const secondRun = await generateVitestSkeletons({
      project_root: root,
      obligations: [obligation],
      output_dir: 'tests/compliance-skeletons',
    });

    expect(firstRun).toEqual(secondRun);
    // File exists
    await expect(access(secondRun[0]!)).resolves.toBeUndefined();
  });
});
