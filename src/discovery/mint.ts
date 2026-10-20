import { ulid as mintUlid } from '@/core/ids/ulid.js';
import type { TicketProviderKind } from '@/core/types/project-profile.js';
import { deriveSlug } from '@/planning/slug-utils.js';
import { detectTicketRefs } from '@/planning/ticket-ref-detect.js';

import { formatDiscoveryRunDirName, type DiscoveryRunDirName } from './paths.js';

export const UNTITLED_DISCOVERY_TITLE = 'discovery';

export interface MintDiscoveryRunInput {
  title: string;
  issue?: string | null;
  trackerKind?: TicketProviderKind;
  ulid?: string;
  ulidSeed?: number;
}

export interface MintedDiscoveryRun extends DiscoveryRunDirName {
  dirName: string;
}

export function mintDiscoveryRunDirName(input: MintDiscoveryRunInput): MintedDiscoveryRun {
  const issue = resolveIssue(input);
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

function normalizeIssue(issue: string | null): string | null {
  if (issue === null) {
    return null;
  }
  const stripped = issue.replace(/^#/, '').trim();
  return stripped.length > 0 ? stripped : null;
}
