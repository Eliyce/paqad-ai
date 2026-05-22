import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { generateBoundaryTests } from '@/compliance/boundary/generator.js';
import type { BoundaryInterface, UnhandledVariant } from '@/compliance/boundary/types.js';

async function tempRoot(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'paqad-btg-'));
}

function makeBoundary(overrides: Partial<BoundaryInterface> = {}): BoundaryInterface {
  return {
    type_name: 'GateResult',
    file: 'src/types.ts',
    producer_spec: 'integrity-spec',
    consumer_specs: ['output-spec'],
    output_states: ['pass', 'fail', 'warn'],
    relationship: 'producer_consumer',
    ...overrides,
  };
}

describe('generateBoundaryTests', () => {
  it('generates one test file per consumer spec (FR-BT3-T1)', async () => {
    const root = await tempRoot();
    const results = await generateBoundaryTests({
      project_root: root,
      boundary: makeBoundary(),
      unhandled: [],
    });
    expect(results).toHaveLength(1);
    expect(results[0]!.written).toBe(true);
    expect(results[0]!.file_path).toContain('GateResult');
  });

  it('generates one stub per output state (FR-BT3-T1)', async () => {
    const root = await tempRoot();
    await generateBoundaryTests({
      project_root: root,
      boundary: makeBoundary(),
      unhandled: [],
    });
    const [result] = await generateBoundaryTests({
      project_root: root,
      boundary: makeBoundary(),
      unhandled: [],
    });
    const content = await readFile(result!.file_path, 'utf8');
    expect((content.match(/handles GateResult state/g) ?? []).length).toBe(3);
  });

  it('annotates unhandled variants with a NOTE comment (FR-BT3-T2)', async () => {
    const root = await tempRoot();
    const unhandled: UnhandledVariant[] = [
      {
        type_name: 'GateResult',
        state: 'warn',
        producer_spec: 'integrity-spec',
        consumer_spec: 'output-spec',
      },
    ];
    const [result] = await generateBoundaryTests({
      project_root: root,
      boundary: makeBoundary(),
      unhandled,
    });
    const content = await readFile(result!.file_path, 'utf8');
    expect(content).toContain('NOTE: this state is produced by integrity-spec');
    expect(content).toContain('but not explicitly handled by output-spec');
  });

  it('is idempotent — returns written: false on second run with same content (FR-BT3-T4)', async () => {
    const root = await tempRoot();
    await generateBoundaryTests({ project_root: root, boundary: makeBoundary(), unhandled: [] });
    const [second] = await generateBoundaryTests({
      project_root: root,
      boundary: makeBoundary(),
      unhandled: [],
    });
    expect(second!.written).toBe(false);
  });

  it('file name encodes both spec slugs and type name (FR-BT3-T3)', async () => {
    const root = await tempRoot();
    const [result] = await generateBoundaryTests({
      project_root: root,
      boundary: makeBoundary(),
      unhandled: [],
    });
    const fileName = path.basename(result!.file_path);
    expect(fileName).toContain('integrity-spec');
    expect(fileName).toContain('output-spec');
    expect(fileName).toContain('GateResult');
    expect(fileName).toMatch(/\.test\.ts$/);
  });

  it('uses custom output directory when provided', async () => {
    const root = await tempRoot();
    const [result] = await generateBoundaryTests({
      project_root: root,
      boundary: makeBoundary(),
      unhandled: [],
      output_dir: 'custom/boundary',
    });
    expect(result!.file_path).toContain(path.join('custom', 'boundary'));
  });

  it('handles producer_spec null gracefully in file name', async () => {
    const root = await tempRoot();
    const [result] = await generateBoundaryTests({
      project_root: root,
      boundary: makeBoundary({ producer_spec: null }),
      unhandled: [],
    });
    expect(result!.file_path).toContain('unknown');
  });

  it('uses "unknown" in NOTE comment when producer_spec is null', async () => {
    const root = await tempRoot();
    const unhandled: UnhandledVariant[] = [
      {
        type_name: 'GateResult',
        state: 'warn',
        producer_spec: 'unknown',
        consumer_spec: 'output-spec',
      },
    ];
    const [result] = await generateBoundaryTests({
      project_root: root,
      boundary: makeBoundary({ producer_spec: null }),
      unhandled,
    });
    const content = await readFile(result!.file_path, 'utf8');
    expect(content).toContain('NOTE: this state is produced by unknown');
  });

  it('produces syntactically complete TypeScript (starts with /** and ends with });)', async () => {
    const root = await tempRoot();
    const [result] = await generateBoundaryTests({
      project_root: root,
      boundary: makeBoundary(),
      unhandled: [],
    });
    const content = await readFile(result!.file_path, 'utf8');
    expect(content.startsWith('/**')).toBe(true);
    expect(content.trimEnd().endsWith('});')).toBe(true);
  });

  it('generates nothing when consumer_specs is empty', async () => {
    const root = await tempRoot();
    const results = await generateBoundaryTests({
      project_root: root,
      boundary: makeBoundary({ consumer_specs: [] }),
      unhandled: [],
    });
    expect(results).toHaveLength(0);
  });
});
