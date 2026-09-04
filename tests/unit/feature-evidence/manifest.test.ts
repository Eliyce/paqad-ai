import { describe, expect, it } from 'vitest';

import {
  BUNDLE_MANIFEST,
  isBundleFileRequired,
  requiredBundleFiles,
  validateBundleFileContent,
  type BundleCompletenessConfig,
} from '@/feature-evidence/manifest.js';
import { FEATURE_BUNDLE_FILES } from '@/feature-evidence/paths.js';

/** All flags on — every predicate-required file is required. */
const ALL_ON: BundleCompletenessConfig = {
  ruleComplianceOn: true,
  metricsEnabled: true,
  duplicationOn: true,
  featureReport: true,
  ragEnabled: true,
  enterprise: true,
  evidenceLedger: true,
  aiBom: true,
};

/** All flags off — only the `always` files are required. */
const ALL_OFF: BundleCompletenessConfig = {
  ruleComplianceOn: false,
  metricsEnabled: false,
  duplicationOn: false,
  featureReport: false,
  ragEnabled: false,
  enterprise: false,
  evidenceLedger: false,
  aiBom: false,
};

describe('bundle manifest', () => {
  it('covers every FEATURE_BUNDLE_FILES key plus report (guard for future files)', () => {
    const covered = new Set(BUNDLE_MANIFEST.map((entry) => entry.key));
    for (const key of Object.keys(FEATURE_BUNDLE_FILES)) {
      expect(covered.has(key as never)).toBe(true);
    }
    expect(covered.has('report')).toBe(true);
    // No stray keys: every manifest entry maps to a real bundle file or report.html.
    const known = new Set<string>([...Object.keys(FEATURE_BUNDLE_FILES), 'report']);
    for (const entry of BUNDLE_MANIFEST) {
      expect(known.has(entry.key)).toBe(true);
    }
  });

  it('gives every entry a filename, writer and validator', () => {
    for (const entry of BUNDLE_MANIFEST) {
      expect(entry.file.length).toBeGreaterThan(0);
      expect(entry.writer.length).toBeGreaterThan(0);
      expect(['json', 'jsonl>=1', 'nonempty']).toContain(entry.validate);
    }
  });

  it('marks the always-on files required regardless of config', () => {
    const alwaysKeys = BUNDLE_MANIFEST.filter((entry) => entry.required === 'always').map(
      (entry) => entry.key,
    );
    expect(alwaysKeys).toEqual(
      expect.arrayContaining([
        'feature',
        'plan',
        'specification',
        'review',
        'stageEvidence',
        'delivery',
      ]),
    );
    for (const entry of BUNDLE_MANIFEST) {
      if (entry.required === 'always') {
        expect(isBundleFileRequired(entry, ALL_OFF)).toBe(true);
      }
    }
  });

  it('requires the flag-gated files only when their flag is on', () => {
    const onKeys = requiredBundleFiles(ALL_ON).map((entry) => entry.key);
    const offKeys = requiredBundleFiles(ALL_OFF).map((entry) => entry.key);
    for (const key of [
      'ruleRun',
      'changeMetrics',
      'duplication',
      'report',
      'rag',
      'receipt',
      'evidence',
      'aiBom',
    ]) {
      expect(onKeys).toContain(key);
      expect(offKeys).not.toContain(key);
    }
  });

  it('gates receipt/evidence on evidence_ledger and ai-bom on ai_bom (both need enterprise)', () => {
    const ledgerOnly: BundleCompletenessConfig = {
      ...ALL_OFF,
      enterprise: true,
      evidenceLedger: true,
    };
    const keys = requiredBundleFiles(ledgerOnly).map((entry) => entry.key);
    expect(keys).toContain('receipt');
    expect(keys).toContain('evidence');
    expect(keys).not.toContain('aiBom');

    const bomWithoutEnterprise: BundleCompletenessConfig = { ...ALL_OFF, aiBom: true };
    expect(requiredBundleFiles(bomWithoutEnterprise).map((e) => e.key)).not.toContain('aiBom');
  });

  it('flags rag as unrecoverable and nothing else', () => {
    for (const entry of BUNDLE_MANIFEST) {
      expect(Boolean(entry.unrecoverable)).toBe(entry.key === 'rag');
    }
  });
});

describe('validateBundleFileContent', () => {
  it('fails absent content for every validator', () => {
    expect(validateBundleFileContent('json', null)).toBe(false);
    expect(validateBundleFileContent('jsonl>=1', null)).toBe(false);
    expect(validateBundleFileContent('nonempty', null)).toBe(false);
  });

  it('json accepts parseable and rejects garbage', () => {
    expect(validateBundleFileContent('json', '{"a":1}')).toBe(true);
    expect(validateBundleFileContent('json', 'not json')).toBe(false);
  });

  it('jsonl>=1 needs at least one non-blank line', () => {
    expect(validateBundleFileContent('jsonl>=1', '{"row":1}\n')).toBe(true);
    expect(validateBundleFileContent('jsonl>=1', '\n  \n')).toBe(false);
    expect(validateBundleFileContent('jsonl>=1', '')).toBe(false);
  });

  it('nonempty needs any content', () => {
    expect(validateBundleFileContent('nonempty', '<html></html>')).toBe(true);
    expect(validateBundleFileContent('nonempty', '   ')).toBe(false);
  });
});
