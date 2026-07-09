// Ticket-reference detector (issue #322) — the deterministic prompt seam.
//
// Given a user prompt and the configured tracker kind, pull out any ticket refs so
// the framework can arm intake ("detected PQD-123 — run `paqad-ai intake fetch
// PQD-123`"). Pure and regex-only: no fetch here, so it is cheap enough to run on
// every prompt and trivially testable. Fetching is the explicit CLI verb the arming
// message names — never automatic.

import type { TicketProviderKind } from '@/core/types/project-profile.js';

/** Jira-style key: PROJECT-123 (uppercase project, at least two letters). */
const JIRA_REF = /\b[A-Z][A-Z0-9]+-\d+\b/g;
/** GitHub-style issue ref: #123. */
const GITHUB_REF = /(?<![\w/])#(\d+)\b/g;

/**
 * The ref shape(s) a tracker kind recognises. `generic` matches both so a project
 * that has not pinned a tracker still gets a nudge; `linear` uses the Jira-style key.
 */
function patternsFor(kind: TicketProviderKind): RegExp[] {
  switch (kind) {
    case 'github-issues':
      return [GITHUB_REF];
    case 'jira':
    case 'linear':
      return [JIRA_REF];
    default:
      return [JIRA_REF, GITHUB_REF];
  }
}

/**
 * All distinct ticket refs in `prompt` for the configured tracker, in first-seen
 * order. Refs are returned verbatim (`PQD-123`, `#45`) — exactly what `paqad-ai
 * intake fetch <ref>` accepts. Returns `[]` when nothing matches.
 */
export function detectTicketRefs(prompt: string, kind: TicketProviderKind): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const pattern of patternsFor(kind)) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(prompt)) !== null) {
      const ref = match[0];
      if (!seen.has(ref)) {
        seen.add(ref);
        out.push(ref);
      }
    }
  }
  return out;
}

/** The `▸ paqad` arming line for a detected ref, or '' when there is nothing to arm.
 *  Names the exact deterministic verb — the fetch is never automatic (#322). */
export function armIntakeNarration(refs: readonly string[]): string {
  if (refs.length === 0) return '';
  const first = refs[0];
  const list = refs.join(', ');
  return (
    `**▸ paqad** · detected a ticket reference (${list})\n` +
    `> Ground the work in the real ticket: run \`paqad-ai intake fetch ${first}\` ` +
    `so I build what it actually says, not a guess from the id.`
  );
}
