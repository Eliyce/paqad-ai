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
// themselves ONLY with the active bundle's plan.json / specification.json.
//
// Issue #402 extends it twice: `review` joins them as a rigid stage (review.json), and a
// non-rigid stage may no longer prove itself with a file written INSIDE a bundle dir —
// the bundle holds only rigid artifacts. An artifact anywhere else still passes through.
describe('bundle-artifact', () => {
  let root: string;
  const SES = 'ses_bundle';
  const DIR = 'x-01JABCDEFGHJKMNPQRSTVWXYZ0';

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-bundle-artifact-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  describe('bundleArtifactFile', () => {
    it('maps planning → plan, specification → specification, review → review', () => {
      expect(bundleArtifactFile('planning')).toBe('plan');
      expect(bundleArtifactFile('specification')).toBe('specification');
      expect(bundleArtifactFile('review')).toBe('review');
    });

    it('returns null for the mutation stages (no rigid file)', () => {
      for (const stage of ['development', 'checks', 'documentation_sync']) {
        expect(bundleArtifactFile(stage)).toBeNull();
      }
    });
  });

  describe('bundleArtifactVerb', () => {
    it('names the compile/freeze/record verb per rigid file', () => {
      expect(bundleArtifactVerb('plan')).toBe('paqad-ai plan compile');
      expect(bundleArtifactVerb('specification')).toBe('paqad-ai spec freeze');
      expect(bundleArtifactVerb('review')).toBe('paqad-ai review record');
    });
  });

  describe('checkBundleArtifacts', () => {
    it('passes an out-of-bundle path through for a non-rigid stage', () => {
      const paths = ['findings.md', 'notes/other.md'];
      const check = checkBundleArtifacts(root, SES, 'development', paths);
      expect(check.rigid).toBe(false);
      expect(check.accepted).toEqual(paths);
      expect(check.rejected).toEqual([]);
      expect(check.verb).toBeNull();
    });

    // AC-1/AC-2 (issue #402): review is rigid now, so only the bundle's review.json proves it.
    it('accepts ONLY the active bundle review.json for review', () => {
      setActiveFeature(root, SES, DIR);
      const reviewRel = featureFilePath(DIR, 'review');
      const check = checkBundleArtifacts(root, SES, 'review', [reviewRel, 'review-notes.md']);
      expect(check.rigid).toBe(true);
      expect(check.expected).toBe(reviewRel);
      expect(check.accepted).toEqual([reviewRel]);
      expect(check.rejected).toEqual(['review-notes.md']);
      expect(check.verb).toBe('paqad-ai review record');
    });

    // AC-4: the wider hole — a non-rigid stage pointing INTO a bundle dir.
    it('rejects a non-rigid stage artifact written inside a bundle dir', () => {
      const stray = `.paqad/ledger/feature-evidence/${DIR}/scratch-notes.md`;
      const check = checkBundleArtifacts(root, SES, 'development', [stray, 'docs/notes.md']);
      expect(check.rigid).toBe(false);
      expect(check.accepted).toEqual(['docs/notes.md']);
      expect(check.rejected).toEqual([stray]);
    });

    it('still accepts a rigid bundle file named by a non-rigid stage', () => {
      const check = checkBundleArtifacts(root, SES, 'development', [featureFilePath(DIR, 'plan')]);
      expect(check.accepted).toEqual([featureFilePath(DIR, 'plan')]);
      expect(check.rejected).toEqual([]);
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
