import type { ResolvedDesignSignOff } from '@/git-workflow/types.js';

import { authorDigest } from './store.js';

export interface HldReply {
  author_id: string;
  is_change_author: boolean;
  text: string;
  reaction: string | null;
  at: string;
  is_bot?: boolean;
}

export interface RepliesRead {
  replies: HldReply[];
  failed: boolean;
}

export type ApprovalDecision =
  | { outcome: 'approved'; via: 'reply' | 'status'; at: string | null }
  | { outcome: 'changes_requested'; replies: string[] }
  | { outcome: 'waiting'; shown: string[] };

export class RepliesInputError extends Error {}

const REACTION_MODIFIERS = /\u{FE0F}|\u{1F3FB}|\u{1F3FC}|\u{1F3FD}|\u{1F3FE}|\u{1F3FF}/gu;
const APPROVE_REACTIONS = new Set(['✅', '👍']);
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/u;
const CHANGE_PHRASES = [
  'please change',
  'not approved',
  'needs changes',
  'need changes',
  'needs work',
  'rework',
  'changes requested',
  'request changes',
  'requesting changes',
  'rejected',
  'reject',
  'not ok',
  'not okay',
  'do not approve',
  "don't approve",
];
const NEGATION =
  /(?<![\p{L}'])(?:not|never|no|cannot|can't|cant|won't|wont|don't|dont|isn't|isnt)\s+(?:[\p{L}']+\s+)?$/iu;

const SENTENCE_NEGATION =
  /(?<![\p{L}'])(?:not|never|cannot|can't|cant|won't|wont|don't|dont|isn't|isnt|wouldn't|wouldnt|haven't|havent|hasn't|hasnt|didn't|didnt|shouldn't|shouldnt|couldn't|couldnt|aren't|arent|wasn't|wasnt)(?![\p{L}'])/iu;
const SENTENCE_END = /[.!?;\n]/u;

function sentenceBefore(text: string, index: number): string {
  const before = text.slice(0, index);
  const parts = before.split(SENTENCE_END);
  return parts[parts.length - 1]!;
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function phrase(word: string): RegExp {
  return new RegExp(
    `(?<![\\p{L}\\p{N}_])${escape(word).replace(/\s+/gu, '\\s+')}(?![\\p{L}\\p{N}_])`,
    'iu',
  );
}

function normalizeReaction(reaction: string | null): string {
  return (reaction ?? '').replace(REACTION_MODIFIERS, '').trim();
}

function isQuestion(text: string): boolean {
  return text.trim().endsWith('?');
}

function asksForChanges(text: string, approveWords: readonly string[]): boolean {
  if (CHANGE_PHRASES.some((p) => phrase(p).test(text))) return true;
  for (const word of approveWords) {
    const match = phrase(word).exec(text);
    if (!match) continue;
    const before = text.slice(0, match.index);
    if (NEGATION.test(before) || SENTENCE_NEGATION.test(sentenceBefore(text, match.index))) {
      return true;
    }
  }
  return false;
}

function approvesByText(text: string, approveWords: readonly string[]): boolean {
  return approveWords.some((word) => phrase(word).test(text));
}

function time(at: string): number {
  return Date.parse(at);
}

export function parseRepliesFile(text: string): RepliesRead {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new RepliesInputError(
      "The replies file isn't valid JSON. Save the replies as a JSON list and run this again.",
    );
  }
  let list: unknown = parsed;
  let failed = false;
  if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
    const object = parsed as Record<string, unknown>;
    failed = object.error !== undefined && object.error !== null && object.error !== '';
    list = object.replies ?? [];
  }
  if (!Array.isArray(list)) {
    throw new RepliesInputError('The replies file must hold a list of replies.');
  }
  const replies = list.map((entry, index) => validateReply(entry, index));
  return { replies, failed };
}

function validateReply(entry: unknown, index: number): HldReply {
  const where = `Reply ${index + 1}`;
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    throw new RepliesInputError(`${where} isn't a reply.`);
  }
  const reply = entry as Record<string, unknown>;
  if (typeof reply.author_id !== 'string' || reply.author_id.trim() === '') {
    throw new RepliesInputError(`${where} has no author_id.`);
  }
  if (typeof reply.at !== 'string' || !ISO_UTC.test(reply.at) || Number.isNaN(time(reply.at))) {
    throw new RepliesInputError(
      `${where} needs an at time from the destination, like 2026-10-31T09:30:00Z.`,
    );
  }
  if (typeof reply.is_change_author !== 'boolean') {
    throw new RepliesInputError(`${where} needs is_change_author as true or false.`);
  }
  if (typeof reply.text !== 'string') {
    throw new RepliesInputError(`${where} needs text, even if it's empty.`);
  }
  if (
    reply.reaction !== null &&
    reply.reaction !== undefined &&
    typeof reply.reaction !== 'string'
  ) {
    throw new RepliesInputError(`${where} needs reaction as text or null.`);
  }
  return {
    author_id: reply.author_id,
    is_change_author: reply.is_change_author,
    text: reply.text,
    reaction: typeof reply.reaction === 'string' ? reply.reaction : null,
    at: reply.at,
    is_bot: reply.is_bot === true,
  };
}

export interface DecideApprovalInput {
  read: RepliesRead;
  status: string | null;
  config: ResolvedDesignSignOff;
  latestPostAt: string;
  developerDigest: string;
}

export function decideApproval(input: DecideApprovalInput): ApprovalDecision {
  const { read, config } = input;
  if (read.failed) return { outcome: 'waiting', shown: [] };
  const after = time(input.latestPostAt);
  const approvers = config.approvers.map((id) => id.trim().toLowerCase());
  const counted = read.replies.filter(
    (reply) =>
      reply.is_bot !== true &&
      !reply.is_change_author &&
      authorDigest(reply.author_id) !== input.developerDigest &&
      time(reply.at) > after,
  );

  const changes = counted.filter((reply) => asksForChanges(reply.text, config.approve_words));
  if (changes.length > 0) {
    return { outcome: 'changes_requested', replies: changes.map((reply) => reply.text) };
  }

  if (config.approve_by !== 'status') {
    const approving = counted.find(
      (reply) =>
        (approvers.length === 0 || approvers.includes(reply.author_id.trim().toLowerCase())) &&
        (APPROVE_REACTIONS.has(normalizeReaction(reply.reaction)) ||
          (!isQuestion(reply.text) && approvesByText(reply.text, config.approve_words))),
    );
    if (approving) return { outcome: 'approved', via: 'reply', at: approving.at };
  }

  const status = input.status?.trim().toLowerCase() ?? '';
  const wanted = config.approved_status.trim().toLowerCase();
  if (config.approve_by !== 'reply' && wanted !== '' && status === wanted) {
    return { outcome: 'approved', via: 'status', at: null };
  }

  return {
    outcome: 'waiting',
    shown: counted.map((reply) => reply.text).filter((text) => text.trim() !== ''),
  };
}
