import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  CHECKS_REPORT_SCHEMA_VERSION,
  checksReportPath,
  featureChecksPath,
  readChecksReport,
  readFeatureChecks,
  writeChecksReport,
  writeFeatureChecks,
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

  // Issue #528 — the per-feature bundle writer/reader (checks.json inside the bundle dir).
  describe('feature bundle checks.json (#528)', () => {
    const dirName = '528-x-01M1SSERFEHGNJZ35W8BF9J8SZ';

    it('round-trips a report through the bundle write then read', () => {
      const target = writeFeatureChecks(root, dirName, {
        schema_version: CHECKS_REPORT_SCHEMA_VERSION,
        generated_at: '2026-01-01T00:00:00.000Z',
        passed: true,
        ran: true,
        results: [],
      });
      expect(target).toBe(featureChecksPath(root, dirName));
      expect(target).toContain(`ledger/feature-evidence/${dirName}/checks.json`);
      const read = readFeatureChecks(root, dirName);
      expect(read?.passed).toBe(true);
      expect(read?.ran).toBe(true);
    });

    it('returns null when the bundle carries no report', () => {
      expect(readFeatureChecks(root, dirName)).toBeNull();
    });

    it('returns null (Inconclusive, never a false pass) on a corrupt bundle report', () => {
      const target = featureChecksPath(root, dirName);
      mkdirSync(join(target, '..'), { recursive: true });
      writeFileSync(target, '{ not valid json');
      expect(readFeatureChecks(root, dirName)).toBeNull();
    });

    it('does not write to the global path', () => {
      writeFeatureChecks(root, dirName, {
        schema_version: CHECKS_REPORT_SCHEMA_VERSION,
        generated_at: '2026-01-01T00:00:00.000Z',
        passed: false,
        ran: true,
        results: [],
      });
      expect(readChecksReport(root)).toBeNull();
    });
  });
});
