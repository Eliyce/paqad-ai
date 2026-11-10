import { createHash } from 'node:crypto';

const HTML_COMMENT_RE = /<!--[\s\S]*?(?:--!?>|$)/g;
const STRAY_MARKER_RE = /@rule\s+RL-[0-9a-f]+(?:\s+discovered:\S+)?/gi;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function cleanDiscoveredText(input: string): string {
  return input
    .replace(HTML_COMMENT_RE, ' ')
    .replace(/--!?>/g, ' ')
    .replace(STRAY_MARKER_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[-*]\s+/, '');
}

export function capLine(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

export function normalizeForMatch(text: string): string {
  return cleanDiscoveredText(text)
    .toLowerCase()
    .replace(/[`*_"'.,;:!?()]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isSlug(value: string): boolean {
  return SLUG_RE.test(value) && value.length <= 64;
}

export function sha256Text(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
