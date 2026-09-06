import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  CHECKS_REPORT_SCHEMA_VERSION,
  readChecksReport,
  readFeatureChecks,
  writeChecksReport,
  writeFeatureChecks,
  type ChecksReport,
} from '@/checks/report-store.js';
import {
  activeFeatureDirOrNull,
  readChecksReportForFeature,
  writeChecksReportForFeature,
} from '@/checks/report-target.js';
import { resolveActiveFeature } from '@/feature-evidence/stage-ledger.js';

// Issue #528 — the bundle-vs-global fallback resolution shared by the check writer and both
// readers. A feature-development session writes/reads the per-feature bundle; a session with
// no active feature bundle falls back to the global path.
describe('checks report target (#528)', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-checks-target-'));
  });

  afterEach(() => {
    delete process.env.CLAUDE_SESSION_ID;
    rmSync(root, { recursive: true, force: true });
  });

  function report(passed: boolean): ChecksReport {
    return {
      schema_version: CHECKS_REPORT_SCHEMA_VERSION,
      generated_at: '2026-01-01T00:00:00.000Z',
      passed,
      ran: true,
      results: [],
    };
  }

  describe('activeFeatureDirOrNull', () => {
    it('returns null when no feature bundle is active (non-feature-dev / chat)', () => {
      process.env.CLAUDE_SESSION_ID = 'ses-none';
      expect(activeFeatureDirOrNull(root)).toBeNull();
    });

    it('returns the active bundle dir when one is open', () => {
      process.env.CLAUDE_SESSION_ID = 'ses-active';
      const dir = resolveActiveFeature(root, 'ses-active', { title: 'thing', issue: '528' });
      expect(activeFeatureDirOrNull(root)).toBe(dir);
    });
  });

  describe('writeChecksReportForFeature', () => {
    it('writes into the bundle when a feature is active, not the global path', () => {
      const dir = resolveActiveFeature(root, 'ses-w', { title: 'thing', issue: '528' });
      writeChecksReportForFeature(root, dir, report(true));
      expect(readFeatureChecks(root, dir)?.passed).toBe(true);
      expect(readChecksReport(root)).toBeNull();
    });

    it('writes to the global fallback path when no feature is active', () => {
      writeChecksReportForFeature(root, null, report(false));
      expect(readChecksReport(root)?.passed).toBe(false);
    });
  });

  describe('readChecksReportForFeature', () => {
    it('reads from the bundle when the active feature carries a report', () => {
      const dir = resolveActiveFeature(root, 'ses-r', { title: 'thing', issue: '528' });
      writeFeatureChecks(root, dir, report(true));
      expect(readChecksReportForFeature(root, dir)?.passed).toBe(true);
    });

    it('falls back to the global path when the active bundle carries no report', () => {
      const dir = resolveActiveFeature(root, 'ses-r2', { title: 'thing', issue: '528' });
      writeChecksReport(root, report(false));
      expect(readChecksReportForFeature(root, dir)?.passed).toBe(false);
    });

    it('reads the global path when no feature is active', () => {
      writeChecksReport(root, report(true));
      expect(readChecksReportForFeature(root, null)?.passed).toBe(true);
    });

    it('returns null when nothing is on record anywhere', () => {
      expect(readChecksReportForFeature(root, null)).toBeNull();
    });
  });
});
