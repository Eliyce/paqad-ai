const MAX_SLUG_LENGTH = 80;

export function deriveSlug(featureId: string, requestText?: string | null): string {
  const source = [featureId, requestText].filter(Boolean).join(' ');
  const normalized = source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');

  if (!normalized) {
    return 'planning-manifest';
  }

  /* c8 ignore next */
  return normalized.slice(0, MAX_SLUG_LENGTH).replace(/-+$/g, '') || 'planning-manifest';
}

export function isSlugSafe(slug: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
}
