import { currentFeature, resumeFeatureByRef } from '@/feature-evidence/stage-ledger.js';
import { loadGitWorkflow } from '@/git-workflow/load.js';
import { detectTicketLinks, detectTicketRefs } from '@/planning/ticket-ref-detect.js';

import { formatAge, resumeLine, sessionWaitingLine } from './copy.js';
import { readHld, readWaitingIndex, type WaitingEntry } from './store.js';

function stillWaiting(projectRoot: string, entry: WaitingEntry): boolean {
  return readHld(projectRoot, entry.dir)?.state === 'awaiting_sign_off';
}

export function waitingSignOffLines(projectRoot: string, now: Date = new Date()): string[] {
  return readWaitingIndex(projectRoot)
    .filter((entry) => stillWaiting(projectRoot, entry))
    .map((entry) => sessionWaitingLine(entry.ref, formatAge(entry.posted_at, now)));
}

export function waitingSignOffText(projectRoot: string, now: Date = new Date()): string | null {
  const lines = waitingSignOffLines(projectRoot, now);
  return lines.length === 0 ? null : lines.join('\n');
}

function sourceRefs(projectRoot: string, prompt: string): string[] {
  const refs: string[] = [];
  for (const source of Object.values(loadGitWorkflow(projectRoot).config.tickets.sources)) {
    try {
      for (const match of prompt.matchAll(new RegExp(source.pattern, 'g'))) refs.push(match[0]);
    } catch {
      continue;
    }
  }
  return refs;
}

function names(entry: WaitingEntry, candidates: readonly string[]): boolean {
  const ref = entry.ref.toLowerCase();
  return candidates.some((candidate) => {
    const value = candidate.toLowerCase();
    return value === ref || (value.startsWith('#') && ref.endsWith(value));
  });
}

export function resumeWaitingByPrompt(
  projectRoot: string,
  sessionId: string,
  prompt: string,
  now?: () => Date,
): string | null {
  const waiting = readWaitingIndex(projectRoot);
  if (waiting.length === 0) return null;
  const candidates = [
    ...detectTicketRefs(prompt, 'generic'),
    ...detectTicketLinks(prompt).map((link) => link.ref),
    ...sourceRefs(projectRoot, prompt),
  ];
  if (candidates.length === 0) return null;
  const active = currentFeature(projectRoot, sessionId, now);
  const entry = waiting.find(
    (item) => item.dir !== active && names(item, candidates) && stillWaiting(projectRoot, item),
  );
  if (!entry) return null;
  const resumed = resumeFeatureByRef(projectRoot, sessionId, entry.dir, now);
  return resumed === null ? null : resumeLine(entry.ref);
}
