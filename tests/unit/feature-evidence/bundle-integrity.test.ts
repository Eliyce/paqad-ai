import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ALLOWED_BUNDLE_FILENAMES,
  classifyBundlePath,
  strayBundleFiles,
} from '@/feature-evidence/bundle-integrity.js';
import { FEATURE_BUNDLE_FILES, featureDir } from '@/feature-evidence/paths.js';

// Issue #402 — the feature bundle holds ONLY rigid, script-owned artifacts plus the
// derived report.html. This module makes that invariant checkable in both directions:
// classifyBundlePath judges a path at the stage-end boundary, strayBundleFiles reads a
// bundle dir so the exporter can flag pollution.
describe('bundle-integrity', () => {
  let root: string;
  const DIR = '402-rigid-bundle-01JABCDEFGHJKMNPQRSTVWXYZ0';

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-bundle-integrity-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function bundle(): string {
    const abs = join(root, featureDir(DIR));
    mkdirSync(abs, { recursive: true });
    return abs;
  }

  describe('ALLOWED_BUNDLE_FILENAMES', () => {
    it('is exactly the rigid set plus report.html', () => {
      for (const filename of Object.values(FEATURE_BUNDLE_FILES)) {
        expect(ALLOWED_BUNDLE_FILENAMES.has(filename)).toBe(true);
      }
      expect(ALLOWED_BUNDLE_FILENAMES.has('report.html')).toBe(true);
      expect(ALLOWED_BUNDLE_FILENAMES.size).toBe(Object.keys(FEATURE_BUNDLE_FILES).length + 1);
    });

    it('includes review.json, the artifact this issue added', () => {
      expect(ALLOWED_BUNDLE_FILENAMES.has('review.json')).toBe(true);
    });
  });

  describe('classifyBundlePath', () => {
    it('returns null for a path outside the feature-evidence tree', () => {
      expect(classifyBundlePath('docs/notes.md')).toBeNull();
      expect(classifyBundlePath('src/index.ts')).toBeNull();
    });

    it('returns null for a file directly under the container (not in a bundle)', () => {
      expect(classifyBundlePath('.paqad/ledger/feature-evidence/loose.md')).toBeNull();
    });

    it('returns null for the _session control dir (not a feature bundle)', () => {
      expect(classifyBundlePath('.paqad/ledger/feature-evidence/_session/abc.json')).toBeNull();
    });

    it('allows every rigid file and report.html', () => {
      for (const filename of [...Object.values(FEATURE_BUNDLE_FILES), 'report.html']) {
        const result = classifyBundlePath(`.paqad/ledger/feature-evidence/${DIR}/${filename}`);
        expect(result).not.toBeNull();
        expect(result!.allowed).toBe(true);
        expect(result!.dirName).toBe(DIR);
        expect(result!.filename).toBe(filename);
      }
    });

    // Transience is a reason not to REPORT a file as a stray, never a reason to accept it
    // as a stage artifact — otherwise `.tmp` is a bypass that is also invisible to
    // strayBundleFiles.
    it('does not accept an atomic-write temp file as an artifact', () => {
      expect(
        classifyBundlePath(`.paqad/ledger/feature-evidence/${DIR}/plan.json.tmp`)!.allowed,
      ).toBe(false);
      expect(
        classifyBundlePath(`.paqad/ledger/feature-evidence/${DIR}/report.html.tmp-4242`)!.allowed,
      ).toBe(false);
    });

    // The two files from the incident this issue reports.
    it('rejects a stray markdown file inside a bundle dir', () => {
      for (const stray of ['river-agent-spec.md', 'review-notes.md']) {
        const result = classifyBundlePath(`.paqad/ledger/feature-evidence/${DIR}/${stray}`);
        expect(result).not.toBeNull();
        expect(result!.allowed).toBe(false);
      }
    });

    // The classifier decides whether a write is inside a bundle, so an unrecognized
    // spelling must never fail OPEN into "not in a bundle".
    it('normalizes a ./ prefix and Windows backslashes rather than failing open', () => {
      const dotSlash = classifyBundlePath(`./.paqad/ledger/feature-evidence/${DIR}/stray.md`);
      expect(dotSlash?.allowed).toBe(false);
      expect(dotSlash?.filename).toBe('stray.md');
      const backslash = classifyBundlePath(
        `.paqad\\ledger\\feature-evidence\\${DIR}\\stray.md`.replace(/\\/g, '\\'),
      );
      expect(backslash?.allowed).toBe(false);
    });

    it('rejects a nested path — the bundle is a flat rigid set', () => {
      const result = classifyBundlePath(`.paqad/ledger/feature-evidence/${DIR}/sub/plan.json`);
      expect(result).not.toBeNull();
      expect(result!.allowed).toBe(false);
      expect(result!.filename).toBe('sub/plan.json');
    });
  });

  describe('strayBundleFiles', () => {
    it('returns [] for a missing bundle dir — absence is not pollution', () => {
      expect(strayBundleFiles(root, DIR)).toEqual([]);
    });

    it('returns [] for a clean bundle of rigid files plus report.html', () => {
      const abs = bundle();
      for (const filename of [...Object.values(FEATURE_BUNDLE_FILES), 'report.html']) {
        writeFileSync(join(abs, filename), 'x', 'utf8');
      }
      expect(strayBundleFiles(root, DIR)).toEqual([]);
    });

    // AC-3: the incident's exact shape.
    it('reports stray markdown, sorted, and nothing that belongs', () => {
      const abs = bundle();
      writeFileSync(join(abs, 'plan.json'), '{}', 'utf8');
      writeFileSync(join(abs, 'review.json'), '{}', 'utf8');
      writeFileSync(join(abs, 'report.html'), '<p>', 'utf8');
      writeFileSync(join(abs, 'plan.json.tmp-99'), '{}', 'utf8');
      writeFileSync(join(abs, 'river-agent-spec.md'), '# spec', 'utf8');
      writeFileSync(join(abs, 'review-notes.md'), '# notes', 'utf8');
      expect(strayBundleFiles(root, DIR)).toEqual(['review-notes.md', 'river-agent-spec.md']);
    });

    it('reports a stray subdirectory too', () => {
      const abs = bundle();
      mkdirSync(join(abs, 'scratch'), { recursive: true });
      expect(strayBundleFiles(root, DIR)).toEqual(['scratch']);
    });
  });
});
