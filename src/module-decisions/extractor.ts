import { isValidSlug, levenshtein, normaliseSlug } from './schema.js';

export type ExtractorHitKind = 'exact-match' | 'near-collision' | 'unknown';

export interface ExtractedCandidate {
  slug: string;
  display_name: string;
  kind: ExtractorHitKind;
  collision_with: string | null;
  pattern: string;
  excerpt: string;
}

export interface ExtractorOptions {
  prompt: string;
  existingSlugs: string[];
  nearCollisionDistance?: number;
}

interface PatternDef {
  label: string;
  re: RegExp;
}

const PATTERNS: PatternDef[] = [
  {
    label: 'ticket-header-module',
    re: /(?:^|\n)\s*Module:\s*([A-Za-z0-9][A-Za-z0-9 _-]{0,40})\s*(?:\n|$)/g,
  },
  {
    label: 'ticket-header-component',
    re: /(?:^|\n)\s*Component:\s*([A-Za-z0-9][A-Za-z0-9 _-]{0,40})\s*(?:\n|$)/g,
  },
  {
    label: 'ticket-header-area',
    re: /(?:^|\n)\s*Area:\s*([A-Za-z0-9][A-Za-z0-9 _-]{0,40})\s*(?:\n|$)/g,
  },
  {
    label: 'ticket-header-subsystem',
    re: /(?:^|\n)\s*Subsystem:\s*([A-Za-z0-9][A-Za-z0-9 _-]{0,40})\s*(?:\n|$)/g,
  },
  { label: 'inline-module-slug', re: /\bmodule:\s*([a-z0-9][a-z0-9-]{0,40})\b/g },
  {
    label: 'new-module-name',
    re: /\bnew module\s+([A-Z][A-Za-z0-9_-]*(?:\s+[A-Z][A-Za-z0-9_-]*){0,4})\b/g,
  },
  { label: 'in-the-module', re: /\bin the\s+([A-Za-z0-9][A-Za-z0-9 _-]{0,30}?)\s+module\b/g },
];

function deriveDisplayName(slug: string, raw: string): string {
  const cleaned = raw.trim();
  if (cleaned.length > 0 && cleaned.length <= 60) {
    return cleaned;
  }
  return slug
    .split('-')
    .map((p) => (p.length === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(' ');
}

function findNearCollision(slug: string, existing: string[], bound: number): string | null {
  let bestSlug: string | null = null;
  let bestDist = bound + 1;
  for (const cand of existing) {
    if (cand === slug) continue;
    const d = levenshtein(slug, cand, bound);
    if (d <= bound && d < bestDist) {
      bestDist = d;
      bestSlug = cand;
    }
  }
  return bestSlug;
}

function classify(
  slug: string,
  existing: Set<string>,
  bound: number,
): { kind: ExtractorHitKind; collision_with: string | null } {
  if (existing.has(slug)) {
    return { kind: 'exact-match', collision_with: slug };
  }
  const near = findNearCollision(slug, Array.from(existing), bound);
  if (near !== null) {
    return { kind: 'near-collision', collision_with: near };
  }
  return { kind: 'unknown', collision_with: null };
}

export function extractCandidates(opts: ExtractorOptions): ExtractedCandidate[] {
  const { prompt, existingSlugs } = opts;
  const bound = opts.nearCollisionDistance ?? 2;
  const existing = new Set(existingSlugs);
  const seenSlugs = new Set<string>();
  const out: ExtractedCandidate[] = [];

  for (const { label, re } of PATTERNS) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(prompt)) !== null) {
      const raw = match[1];
      if (raw === undefined) continue;
      const slug = normaliseSlug(raw);
      if (slug === null || !isValidSlug(slug)) continue;
      if (seenSlugs.has(slug)) continue;
      seenSlugs.add(slug);
      const { kind, collision_with } = classify(slug, existing, bound);
      out.push({
        slug,
        display_name: deriveDisplayName(slug, raw),
        kind,
        collision_with,
        pattern: label,
        excerpt: match[0].trim().slice(0, 200),
      });
    }
  }

  return out;
}

export function candidatesNeedingDecision(candidates: ExtractedCandidate[]): ExtractedCandidate[] {
  return candidates.filter((c) => c.kind !== 'exact-match');
}
