// Discovery run dir-name mint (issue #597).
//
// The run dir name is the immutable change key: `[<issue>-]<slug>-<ULID>`. Minted once, at run
// birth, from the title + optional ticket ref — reusing the same slug, ticket-detect, and ULID
// primitives feature-evidence/mint.ts uses, so a Discovery run id is minted identically on every
// platform (posix, colon-free — NFR-1).

import { ulid as mintUlid } from '@/core/ids/ulid.js';
import type { TicketProviderKind } from '@/core/types/project-profile.js';
import { deriveSlug } from '@/planning/slug-utils.js';
import { detectTicketRefs } from '@/planning/ticket-ref-detect.js';

import { formatDiscoveryRunDirName, type DiscoveryRunDirName } from './paths.js';

/** The literal title an untitled run is minted with, producing a generic `discovery-<ULID>` dir. */
export const UNTITLED_DISCOVERY_TITLE = 'discovery';

export interface MintDiscoveryRunInput {
  /** Human title of the run; the slug is derived from it. */
  title: string;
  /**
   * Explicit ticket/issue ref (`597`, `PQD-123`). `undefined` ⇒ detect from the title; `null` ⇒
   * force no issue. A detected ref is used verbatim.
   */
  issue?: string | null;
  /** Tracker kind for detection; defaults to `generic` (matches both shapes). */
  trackerKind?: TicketProviderKind;
  /** Deterministic ULID seam for tests (a fixed ULID or a seed time). */
  ulid?: string;
  ulidSeed?: number;
}

export interface MintedDiscoveryRun extends DiscoveryRunDirName {
  dirName: string;
}

/**
 * Mint a Discovery run dir name from a title + optional issue. When `issue` is omitted, the first
 * ticket ref in the title is detected and used; when it is `null`, no issue prefix is emitted. A
 * title with no slug-worthy characters falls back to {@link UNTITLED_DISCOVERY_TITLE}.
 */
export function mintDiscoveryRunDirName(input: MintDiscoveryRunInput): MintedDiscoveryRun {
  const issue = resolveIssue(input);
  // deriveSlug always returns a non-empty, slug-safe string (it falls back internally), so an
  // empty/whitespace title is mapped to the untitled slug before slugging.
  const slug = deriveSlug(input.title.trim().length > 0 ? input.title : UNTITLED_DISCOVERY_TITLE);
  const ulid = input.ulid ?? mintUlid(input.ulidSeed);
  const dirName = formatDiscoveryRunDirName({ issue, slug, ulid });
  return { dirName, issue, slug, ulid };
}

function resolveIssue(input: MintDiscoveryRunInput): string | null {
  if (input.issue !== undefined) {
    return normalizeIssue(input.issue);
  }
  const refs = detectTicketRefs(input.title, input.trackerKind ?? 'generic');
  return normalizeIssue(refs[0] ?? null);
}

/**
 * Normalise a ticket ref into a dir-name-safe token. `detectTicketRefs` returns a github ref as
 * `#45`, but the dir name carries the bare number so it stays parseable; a ref that empties out
 * (e.g. a lone `#`) becomes null.
 */
function normalizeIssue(issue: string | null): string | null {
  if (issue === null) {
    return null;
  }
  const stripped = issue.replace(/^#/, '').trim();
  return stripped.length > 0 ? stripped : null;
}
