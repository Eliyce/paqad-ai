// Module attribution extractor. Issue #80, Phase 1 §4.3.a.
//
// Applies a finite, framework-owned pattern set to a prompt and returns draft
// MD-XXXX candidates. Pattern set is intentionally small and deterministic —
// no LLM, no free-form NER. Extending the set is a framework PR.

import { isValidSlug, levenshtein, normaliseSlug } from './schema.js';

export type ExtractorHitKind = 'exact-match' | 'near-collision' | 'unknown';

export interface ExtractedCandidate {
  slug: string;
  display_name: string;
  kind: ExtractorHitKind;
  // For near-collision: the existing slug it's close to.
  collision_with: string | null;
  // The pattern label that fired (useful for tests + reasoning fields).
  pattern: string;
  // The substring of the prompt that produced the hit.
  excerpt: string;
}

export interface ExtractorOptions {
  prompt: string;
  // Slugs already declared in module-map.yml. Used for collision detection.
  existingSlugs: string[];
  // Levenshtein bound for near-collision. Defaults to 2 per issue §4.7.2.
  nearCollisionDistance?: number;
}

interface PatternDef {
  label: string;
  // Each pattern is a RegExp with a single capturing group: the module name.
  re: RegExp;
}

// Finite pattern set per issue §4.3.a. Each entry MUST capture the candidate
// name in group 1. Patterns are tried in order; first hit per (start,end)
// span wins. Ordering matters when patterns overlap — header patterns are
// listed first so "Module: foo" wins over "in the foo module".
const PATTERNS: PatternDef[] = [
  { label: 'ticket-header-module', re: /(?:^|\n)\s*Module:\s*([A-Za-z0-9][A-Za-z0-9 _-]{0,40})\s*(?:\n|$)/g },
  { label: 'ticket-header-component', re: /(?:^|\n)\s*Component:\s*([A-Za-z0-9][A-Za-z0-9 _-]{0,40})\s*(?:\n|$)/g },
  { label: 'ticket-header-area', re: /(?:^|\n)\s*Area:\s*([A-Za-z0-9][A-Za-z0-9 _-]{0,40})\s*(?:\n|$)/g },
  { label: 'ticket-header-subsystem', re: /(?:^|\n)\s*Subsystem:\s*([A-Za-z0-9][A-Za-z0-9 _-]{0,40})\s*(?:\n|$)/g },
  { label: 'inline-module-slug', re: /\bmodule:\s*([a-z0-9][a-z0-9-]{0,40})\b/g },
  // Title-case sequence: stops at the first lowercase/non-letter word, which
  // is how "new module Stripe Connect for payouts" yields "Stripe Connect".
  { label: 'new-module-name', re: /\bnew module\s+([A-Z][A-Za-z0-9_-]*(?:\s+[A-Z][A-Za-z0-9_-]*){0,4})\b/g },
  { label: 'in-the-module', re: /\bin the\s+([A-Za-z0-9][A-Za-z0-9 _-]{0,30}?)\s+module\b/g },
];

function deriveDisplayName(slug: string, raw: string): string {
  // Prefer the raw match when it looks human-friendly; otherwise title-case
  // the slug. "Auth" beats "auth" for display purposes.
  const cleaned = raw.trim();
  if (cleaned.length > 0 && cleaned.length <= 60) {
    return cleaned;
  }
  return slug
    .split('-')
    .map((p) => (p.length === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(' ');
}

function findNearCollision(
  slug: string,
  existing: string[],
  bound: number,
): string | null {
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
    // Reset lastIndex defensively since we're reusing module-level regexes.
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

// Convenience: filter to only the candidates that need a Decision Pause
// packet. Exact matches don't (already known); near-collision and unknown do.
export function candidatesNeedingDecision(
  candidates: ExtractedCandidate[],
): ExtractedCandidate[] {
  return candidates.filter((c) => c.kind !== 'exact-match');
}
