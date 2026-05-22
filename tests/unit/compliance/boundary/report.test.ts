import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildBoundaryReport,
  loadBoundaryReport,
  saveBoundaryReport,
} from '@/compliance/boundary/report.js';
import type { ExtractionResult } from '@/compliance/boundary/extractor.js';
import type { BoundaryInterface } from '@/compliance/boundary/types.js';
import { BOUNDARY_SCHEMA_VERSION } from '@/compliance/boundary/types.js';

function makeResult(
  states: string[],
  unhandledStates: string[],
  consumerSpec = 'output-spec',
): ExtractionResult {
  const boundary: BoundaryInterface = {
    type_name: 'GateResult',
    file: 'src/types.ts',
    producer_spec: 'integrity-spec',
    consumer_specs: [consumerSpec],
    output_states: states,
    relationship: 'producer_consumer',
  };
  const unhandled = unhandledStates.map((state) => ({
    type_name: 'GateResult',
    state,
    producer_spec: 'integrity-spec',
    consumer_spec: consumerSpec,
  }));
  return {
    boundary,
    unhandled_by_consumer: new Map([[consumerSpec, unhandled]]),
  };
}

describe('buildBoundaryReport', () => {
  it('returns gate_result skip for empty results (EC-BT1-T1)', () => {
    const report = buildBoundaryReport([]);
    expect(report.gate_result).toBe('skip');
    expect(report.total_interfaces).toBe(0);
    expect(report.metadata.schema_version).toBe(BOUNDARY_SCHEMA_VERSION);
  });

  it('returns gate_result pass when all variants handled (FR-BT4-T4)', () => {
    const report = buildBoundaryReport([makeResult(['pass', 'fail'], [])]);
    expect(report.gate_result).toBe('pass');
    expect(report.unhandled_count).toBe(0);
    expect(report.handled_count).toBe(2);
  });

  it('returns gate_result warn when unhandled variants exist (FR-BT4-T2)', () => {
    const report = buildBoundaryReport([makeResult(['pass', 'fail', 'warn'], ['warn'])]);
    expect(report.gate_result).toBe('warn');
    expect(report.unhandled_count).toBe(1);
    expect(report.handled_count).toBe(2);
  });

  it('includes per-interface breakdown (FR-BT4-T1)', () => {
    const report = buildBoundaryReport([makeResult(['pass', 'fail'], ['fail'])]);
    expect(report.interfaces).toHaveLength(1);
    expect(report.interfaces[0]!.type_name).toBe('GateResult');
    expect(report.interfaces[0]!.unhandled_variants).toHaveLength(1);
  });

  it('counts states per consumer (total_states = states × consumers)', () => {
    const boundary: BoundaryInterface = {
      type_name: 'T',
      file: 'src/t.ts',
      producer_spec: 'p',
      consumer_specs: ['c1', 'c2'],
      output_states: ['a', 'b', 'c'],
      relationship: 'producer_consumer',
    };
    const result: ExtractionResult = {
      boundary,
      unhandled_by_consumer: new Map([
        ['c1', [{ type_name: 'T', state: 'c', producer_spec: 'p', consumer_spec: 'c1' }]],
        ['c2', []],
      ]),
    };
    const report = buildBoundaryReport([result]);
    // 3 states × 2 consumers = 6 total
    expect(report.total_states).toBe(6);
    expect(report.unhandled_count).toBe(1);
  });
});

describe('saveBoundaryReport + loadBoundaryReport', () => {
  it('saves and loads the report correctly', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'paqad-br-'));
    const report = buildBoundaryReport([]);
    await saveBoundaryReport(report, root);
    const loaded = await loadBoundaryReport(root);
    expect(loaded).toEqual(report);
  });

  it('returns null when report does not exist', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'paqad-br-missing-'));
    expect(await loadBoundaryReport(root)).toBeNull();
  });

  it('uses custom report path when provided', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'paqad-br-custom-'));
    const report = buildBoundaryReport([]);
    const saved = await saveBoundaryReport(report, root, 'custom/my-report.json');
    expect(saved).toContain('my-report.json');
    const loaded = await loadBoundaryReport(root, 'custom/my-report.json');
    expect(loaded).toEqual(report);
  });
});
