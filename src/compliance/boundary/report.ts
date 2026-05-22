/**
 * FR-BT4: Gate and Report Integration
 *
 * Produces and persists the boundary coverage report from the extraction
 * results.  Gate behaviour (FR-BT4.3):
 *   - 'skip'  — no boundaries detected
 *   - 'warn'  — unhandled variants exist
 *   - 'pass'  — all variants handled
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { ExtractionResult } from './extractor.js';
import type { BoundaryReport, UnhandledVariant } from './types.js';
import { BOUNDARY_SCHEMA_VERSION } from './types.js';

export const DEFAULT_BOUNDARY_REPORT_PATH = '.paqad/compliance/boundary-report.json';

export function buildBoundaryReport(results: ExtractionResult[]): BoundaryReport {
  if (results.length === 0) {
    return {
      metadata: { generated_at: new Date().toISOString(), schema_version: BOUNDARY_SCHEMA_VERSION },
      total_interfaces: 0,
      total_states: 0,
      handled_count: 0,
      unhandled_count: 0,
      gate_result: 'skip',
      interfaces: [],
    };
  }

  let totalStates = 0;
  let unhandledCount = 0;

  const interfaces = results.map((result) => {
    const allUnhandled: UnhandledVariant[] = [...result.unhandled_by_consumer.values()].flat();

    totalStates += result.boundary.output_states.length * result.boundary.consumer_specs.length;
    unhandledCount += allUnhandled.length;

    return {
      type_name: result.boundary.type_name,
      file: result.boundary.file,
      producer_spec: result.boundary.producer_spec,
      consumer_specs: result.boundary.consumer_specs,
      total_states: result.boundary.output_states.length,
      unhandled_variants: allUnhandled,
    };
  });

  const handledCount = totalStates - unhandledCount;
  const gateResult: BoundaryReport['gate_result'] = unhandledCount > 0 ? 'warn' : 'pass';

  return {
    metadata: { generated_at: new Date().toISOString(), schema_version: BOUNDARY_SCHEMA_VERSION },
    total_interfaces: results.length,
    total_states: totalStates,
    handled_count: handledCount,
    unhandled_count: unhandledCount,
    gate_result: gateResult,
    interfaces,
  };
}

export async function saveBoundaryReport(
  report: BoundaryReport,
  projectRoot: string,
  reportPath = DEFAULT_BOUNDARY_REPORT_PATH,
): Promise<string> {
  const fullPath = path.resolve(projectRoot, reportPath);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  return fullPath;
}

export async function loadBoundaryReport(
  projectRoot: string,
  reportPath = DEFAULT_BOUNDARY_REPORT_PATH,
): Promise<BoundaryReport | null> {
  try {
    const fullPath = path.resolve(projectRoot, reportPath);
    const raw = await readFile(fullPath, 'utf8');
    return JSON.parse(raw) as BoundaryReport;
  } catch {
    return null;
  }
}
