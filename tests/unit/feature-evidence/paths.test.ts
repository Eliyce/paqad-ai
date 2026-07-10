import { describe, expect, it } from 'vitest';

import {
  FEATURE_BUNDLE_FILES,
  chatDir,
  chatRagPath,
  featureDir,
  featureEvidenceDir,
  featureFilePath,
  featureSessionControlPath,
  formatFeatureDirName,
  isFeatureDirName,
  parseFeatureDirName,
} from '@/feature-evidence/paths.js';

// A valid 26-char Crockford-base32 ULID body.
const ULID = '01JABCDEFGHJKMNPQRSTVWXYZ0';

describe('feature-evidence path layer', () => {
  it('resolves the container, feature dir, and bundle files', () => {
    expect(featureEvidenceDir()).toBe('.paqad/ledger/feature-evidence');
    expect(featureDir('339-x-' + ULID)).toBe(`.paqad/ledger/feature-evidence/339-x-${ULID}`);
    expect(featureFilePath('339-x-' + ULID, 'feature')).toBe(
      `.paqad/ledger/feature-evidence/339-x-${ULID}/feature.json`,
    );
    expect(featureFilePath('339-x-' + ULID, 'stageEvidence')).toBe(
      `.paqad/ledger/feature-evidence/339-x-${ULID}/stage-evidence.jsonl`,
    );
    expect(FEATURE_BUNDLE_FILES.rag).toBe('rag.jsonl');
  });

  it('resolves the session control and chat homes', () => {
    expect(featureSessionControlPath('ses_1')).toBe(
      '.paqad/ledger/feature-evidence/_session/ses_1.json',
    );
    expect(chatDir('ses_1')).toBe('.paqad/ledger/_chat/ses_1');
    expect(chatRagPath('ses_1')).toBe('.paqad/ledger/_chat/ses_1/rag.jsonl');
  });

  it('formats a name with a github issue and round-trips it', () => {
    const name = formatFeatureDirName({ issue: '339', slug: 'route-first-workflows', ulid: ULID });
    expect(name).toBe(`339-route-first-workflows-${ULID}`);
    expect(parseFeatureDirName(name)).toEqual({
      issue: '339',
      slug: 'route-first-workflows',
      ulid: ULID,
    });
    expect(isFeatureDirName(name)).toBe(true);
  });

  it('formats a name with a jira issue and round-trips it', () => {
    const name = formatFeatureDirName({ issue: 'PQD-123', slug: 'add-thing', ulid: ULID });
    expect(name).toBe(`PQD-123-add-thing-${ULID}`);
    expect(parseFeatureDirName(name)).toEqual({ issue: 'PQD-123', slug: 'add-thing', ulid: ULID });
  });

  it('formats a name with no issue and round-trips it', () => {
    const name = formatFeatureDirName({ issue: null, slug: 'just-a-slug', ulid: ULID });
    expect(name).toBe(`just-a-slug-${ULID}`);
    expect(parseFeatureDirName(name)).toEqual({ issue: null, slug: 'just-a-slug', ulid: ULID });
  });

  it('rejects an unsafe slug and a malformed ULID', () => {
    expect(() => formatFeatureDirName({ issue: null, slug: 'Bad Slug', ulid: ULID })).toThrow(
      /Unsafe feature slug/,
    );
    expect(() => formatFeatureDirName({ issue: null, slug: 'ok', ulid: 'too-short' })).toThrow(
      /Malformed feature ULID/,
    );
  });

  it('rejects an issue ref that would not round-trip', () => {
    expect(() => formatFeatureDirName({ issue: '#45', slug: 'ok', ulid: ULID })).toThrow(
      /Malformed feature issue ref/,
    );
    expect(() => formatFeatureDirName({ issue: 'not an issue', slug: 'ok', ulid: ULID })).toThrow(
      /Malformed feature issue ref/,
    );
  });

  it('returns null / false for a non-feature dir name', () => {
    expect(parseFeatureDirName('not a feature dir')).toBeNull();
    expect(parseFeatureDirName('missing-ulid')).toBeNull();
    expect(isFeatureDirName('_session')).toBe(false);
  });
});
