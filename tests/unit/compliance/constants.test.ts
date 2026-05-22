import { describe, expect, it } from 'vitest';

import {
  slugifySpec,
  specIndexPath,
  specReportPath,
  specReviewPath,
} from '@/compliance/constants.js';

describe('slugifySpec', () => {
  it('strips extension and lowercases', () => {
    expect(slugifySpec('docs/My-Spec.md')).toBe('my-spec');
  });

  it('converts non-alphanumeric runs to single hyphens', () => {
    expect(slugifySpec('spec compliance verification.md')).toBe('spec-compliance-verification');
  });

  it('trims leading and trailing hyphens', () => {
    expect(slugifySpec('---spec---.md')).toBe('spec');
  });

  it('handles paths without extension', () => {
    expect(slugifySpec('docs/my-spec')).toBe('my-spec');
  });

  it('handles a bare filename with no directory', () => {
    expect(slugifySpec('spec.md')).toBe('spec');
  });
});

describe('specIndexPath', () => {
  it('returns per-spec slug path for the obligation index (FR-2.1)', () => {
    expect(specIndexPath('docs/my-spec.md')).toBe('.paqad/compliance/my-spec/obligations.json');
  });

  it('produces different paths for different spec files', () => {
    expect(specIndexPath('docs/spec-a.md')).not.toBe(specIndexPath('docs/spec-b.md'));
  });
});

describe('specReportPath', () => {
  it('returns per-spec slug path for the compliance report (FR-3.5)', () => {
    expect(specReportPath('docs/my-spec.md')).toBe('.paqad/compliance/my-spec/report.json');
  });

  it('shares the same slug directory as specIndexPath', () => {
    const indexP = specIndexPath('docs/my-spec.md');
    const reportP = specReportPath('docs/my-spec.md');
    // Same directory, different filenames
    expect(indexP.split('/').slice(0, -1).join('/')).toBe(
      reportP.split('/').slice(0, -1).join('/'),
    );
  });
});

describe('specReviewPath', () => {
  it('returns per-spec slug path for the spec review report', () => {
    expect(specReviewPath('docs/my-spec.md')).toBe('.paqad/compliance/my-spec/spec-review.json');
  });
});
