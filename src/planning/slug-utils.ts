import { slugifyAscii, trimTrailingChar } from '@/core/text/trim-char.js';

const MAX_SLUG_LENGTH = 80;

export function deriveSlug(featureId: string, requestText?: string | null): string {
  const source = [featureId, requestText].filter(Boolean).join(' ');
  const normalized = slugifyAscii(source);

  if (!normalized) {
    return 'planning-manifest';
  }

  /* c8 ignore next */
  return trimTrailingChar(normalized.slice(0, MAX_SLUG_LENGTH), '-') || 'planning-manifest';
}

export function isSlugSafe(slug: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
}
