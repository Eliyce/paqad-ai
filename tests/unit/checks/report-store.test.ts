import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  CHECKS_REPORT_SCHEMA_VERSION,
  checksReportPath,
  readChecksReport,
  writeChecksReport,
} from '@/checks/report-store.js';

describe('checks report store', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-checks-report-'));
    mkdirSync(join(root, '.paqad/checks'), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('round-trips a report through write then read', () => {
    writeChecksReport(root, {
      schema_version: CHECKS_REPORT_SCHEMA_VERSION,
      generated_at: '2026-01-01T00:00:00.000Z',
      passed: false,
      ran: true,
      results: [],
    });
    const read = readChecksReport(root);
    expect(read?.passed).toBe(false);
    expect(read?.ran).toBe(true);
  });

  it('returns null when no report exists', () => {
    expect(readChecksReport(root)).toBeNull();
  });

  it('returns null (Inconclusive, never a false pass) on a corrupt report', () => {
    writeFileSync(checksReportPath(root), '{ not valid json');
    expect(readChecksReport(root)).toBeNull();
  });

  it('returns null when the shape is wrong (missing passed / results)', () => {
    writeFileSync(checksReportPath(root), JSON.stringify({ generated_at: 'x' }));
    expect(readChecksReport(root)).toBeNull();
  });
});
