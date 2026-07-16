import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { featureFilePath } from '@/feature-evidence/paths.js';
import { setActiveFeature } from '@/feature-evidence/session-control.js';
import {
  bundleArtifactFile,
  bundleArtifactVerb,
  checkBundleArtifacts,
} from '@/stage-evidence/bundle-artifact.js';

// Issue #394 — the rigid-bundle-artifact partition. planning/specification prove
// themselves ONLY with the active bundle's plan.json / specification.json; everything
// else (review, mutation stages) passes through unchanged.
describe('bundle-artifact', () => {
  let root: string;
  const SES = 'ses_bundle';
  const DIR = 'x-01JABCDEFGHJKMNPQRSTVWXYZ0';

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-bundle-artifact-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  describe('bundleArtifactFile', () => {
    it('maps planning → plan and specification → specification', () => {
      expect(bundleArtifactFile('planning')).toBe('plan');
      expect(bundleArtifactFile('specification')).toBe('specification');
    });

    it('returns null for review and the mutation stages (no rigid file)', () => {
      for (const stage of ['review', 'development', 'checks', 'documentation_sync']) {
        expect(bundleArtifactFile(stage)).toBeNull();
      }
    });
  });

  describe('bundleArtifactVerb', () => {
    it('names the compile/freeze verb per rigid file', () => {
      expect(bundleArtifactVerb('plan')).toBe('paqad-ai plan compile');
      expect(bundleArtifactVerb('specification')).toBe('paqad-ai spec freeze');
    });
  });

  describe('checkBundleArtifacts', () => {
    it('passes every path through for a non-rigid stage', () => {
      const paths = ['findings.md', 'notes/other.md'];
      const check = checkBundleArtifacts(root, SES, 'review', paths);
      expect(check.rigid).toBe(false);
      expect(check.accepted).toEqual(paths);
      expect(check.rejected).toEqual([]);
      expect(check.verb).toBeNull();
    });

    it('accepts ONLY the active bundle plan.json for planning', () => {
      setActiveFeature(root, SES, DIR);
      const planRel = featureFilePath(DIR, 'plan');
      const check = checkBundleArtifacts(root, SES, 'planning', [planRel, 'notes.md']);
      expect(check.rigid).toBe(true);
      expect(check.expected).toBe(planRel);
      expect(check.accepted).toEqual([planRel]);
      expect(check.rejected).toEqual(['notes.md']);
      expect(check.verb).toBe('paqad-ai plan compile');
    });

    it('accepts ONLY the active bundle specification.json for specification', () => {
      setActiveFeature(root, SES, DIR);
      const specRel = featureFilePath(DIR, 'specification');
      const check = checkBundleArtifacts(root, SES, 'specification', [specRel]);
      expect(check.accepted).toEqual([specRel]);
      expect(check.rejected).toEqual([]);
      expect(check.verb).toBe('paqad-ai spec freeze');
    });

    it('rejects everything for a rigid stage when no feature is active (expected null)', () => {
      const check = checkBundleArtifacts(root, SES, 'planning', ['plan.json']);
      expect(check.rigid).toBe(true);
      expect(check.expected).toBeNull();
      expect(check.accepted).toEqual([]);
      expect(check.rejected).toEqual(['plan.json']);
    });
  });
});
