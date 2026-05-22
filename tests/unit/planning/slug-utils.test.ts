import { deriveSlug, isSlugSafe } from '@/planning/slug-utils.js';

describe('slug-utils', () => {
  it('derives safe slugs from feature and request text', () => {
    expect(deriveSlug('Feature 123', 'Add YAML manifest!')).toBe('feature-123-add-yaml-manifest');
    expect(deriveSlug('', '')).toBe('planning-manifest');
    expect(deriveSlug('a'.repeat(120))).toHaveLength(80);
  });

  it('validates slug safety', () => {
    expect(isSlugSafe('planning-manifest')).toBe(true);
    expect(isSlugSafe('Planning Manifest')).toBe(false);
    expect(isSlugSafe('../escape')).toBe(false);
  });
});
