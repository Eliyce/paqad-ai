// MD-XXXX prospective module decisions — schema, state machine, slug helpers.
// Issue #80, Phase 1. Stored under .paqad/decisions/module-decisions/<id>.yml.

export type ModuleDecisionState =
  | 'draft'
  | 'proposed'
  | 'accepted'
  | 'rejected'
  | 'expired'
  | 'superseded';

export type ModuleDecisionLayer = 'cli-commands' | 'agent-workflows' | 'framework-internals';

export type ModuleDecisionConfidence = 'low' | 'medium' | 'high';

export type ModuleDecisionSourceType =
  | 'pasted-ticket'
  | 'inferred-from-prompt'
  | 'explicit-user-name';

export interface ModuleDecisionFeatureDraft {
  slug: string;
  name: string;
  sources_hint: string[];
}

export interface ModuleDecisionSource {
  type: ModuleDecisionSourceType;
  prompt_excerpt: string;
  detected_at: string;
}

export interface ModuleDecisionDisposition {
  collision_with: string | null;
  alternatives_offered: string[];
}

export interface ModuleDecision {
  id: string;
  state: ModuleDecisionState;
  proposed_slug: string;
  proposed_name: string;
  proposed_layer: ModuleDecisionLayer | null;
  proposed_features: ModuleDecisionFeatureDraft[];
  source_of_decision: ModuleDecisionSource;
  confidence: ModuleDecisionConfidence;
  reasoning: string;
  disposition: ModuleDecisionDisposition;
  created_at: string;
  updated_at: string;
  expires_at: string;
  approved_by: string | null;
  applied_to_map_at: string | null;
  applied_to_map_commit: string | null;
  events_log_ref: string | null;
}

export const DEFAULT_PROPOSED_TTL_DAYS = 7;

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ID_RE = /^MD-\d{4,}$/;

export function isValidSlug(value: string): boolean {
  return SLUG_RE.test(value);
}

export function isValidDecisionId(value: string): boolean {
  return ID_RE.test(value);
}

export function formatDecisionId(n: number): string {
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`Invalid MD ordinal: ${n}`);
  }
  return `MD-${String(n).padStart(4, '0')}`;
}

export function parseDecisionId(id: string): number {
  if (!isValidDecisionId(id)) {
    throw new Error(`Invalid MD-XXXX id: ${id}`);
  }
  return Number(id.slice(3));
}

// Normalise an arbitrary user-supplied name to a kebab-case slug. Strips
// non-alphanumerics, collapses runs of dashes, lowercases. Returns null if
// the result is empty or would otherwise fail isValidSlug.
export function normaliseSlug(input: string): string | null {
  const trimmed = input.trim().toLowerCase();
  if (trimmed.length === 0) return null;
  const slug = trimmed.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (slug.length === 0) return null;
  return isValidSlug(slug) ? slug : null;
}

// Levenshtein distance — used for near-collision detection (issue §4.7.2).
// Bounded by `max` for early exit on long strings.
export function levenshtein(a: string, b: string, max = 2): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const al = a.length;
  const bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;
  let prev = new Array<number>(bl + 1);
  let curr = new Array<number>(bl + 1);
  for (let j = 0; j <= bl; j++) prev[j] = j;
  for (let i = 1; i <= al; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= bl; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1, // insertion
        (prev[j] ?? 0) + 1, // deletion
        (prev[j - 1] ?? 0) + cost, // substitution
      );
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > max) return max + 1;
    [prev, curr] = [curr, prev];
  }
  return prev[bl] ?? 0;
}

// Allowed transitions. `accepted` is terminal-ish (only superseded can follow).
// `rejected`, `expired`, `superseded` are terminal.
const TRANSITIONS: Record<ModuleDecisionState, ModuleDecisionState[]> = {
  draft: ['proposed', 'rejected'],
  proposed: ['accepted', 'rejected', 'expired', 'superseded'],
  accepted: ['superseded'],
  rejected: [],
  expired: ['superseded'],
  superseded: [],
};

export function canTransition(from: ModuleDecisionState, to: ModuleDecisionState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: ModuleDecisionState, to: ModuleDecisionState): void {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal MD state transition: ${from} → ${to}`);
  }
}

export function ttlExpiresAt(createdAt: Date, days = DEFAULT_PROPOSED_TTL_DAYS): string {
  const ms = createdAt.getTime() + days * 24 * 60 * 60 * 1000;
  return new Date(ms).toISOString();
}

export function isExpired(decision: ModuleDecision, now: Date = new Date()): boolean {
  if (decision.state !== 'proposed') return false;
  return now.getTime() >= Date.parse(decision.expires_at);
}
