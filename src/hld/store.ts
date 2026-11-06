import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

import { dirname, join } from 'pathe';

import { PATHS } from '@/core/constants/paths.js';
import { stampFeatureDocument } from '@/feature-evidence/bundle-document.js';
import { featureFilePath } from '@/feature-evidence/paths.js';

export const HLD_DOC_TYPE = 'paqad.hld';
export const HLD_SCHEMA_VERSION = 1;

export const HLD_STATES = [
  'awaiting_sign_off',
  'approved',
  'changes_requested',
  'skipped',
  'not_posted',
] as const;
export type HldState = (typeof HLD_STATES)[number];

export interface HldPost {
  target: string;
  link: string;
  id: string;
  at: string;
  version: number;
  digest: string;
  author_digest: string;
  detail_posted: boolean;
  move_failed: boolean;
}

export interface HldRecord {
  state: HldState;
  ref: string;
  version: number;
  digest: string;
  posts: HldPost[];
  approved_at: string | null;
  approval_link: string | null;
  skip_reason: string | null;
}

export interface WaitingEntry {
  dir: string;
  ref: string;
  posted_at: string;
}

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function digestDesign(text: string): string {
  return sha256(text.replace(/\r\n/gu, '\n').trim());
}

export function authorDigest(authorId: string): string {
  return sha256(authorId.trim());
}

export function emptyHldRecord(ref: string): HldRecord {
  return {
    state: 'awaiting_sign_off',
    ref,
    version: 0,
    digest: '',
    posts: [],
    approved_at: null,
    approval_link: null,
    skip_reason: null,
  };
}

export function hldPath(projectRoot: string, dirName: string): string {
  return join(projectRoot, featureFilePath(dirName, 'hld'));
}

export function hldMarkdownPath(projectRoot: string, dirName: string): string {
  return join(projectRoot, featureFilePath(dirName, 'hldMd'));
}

export function readHld(projectRoot: string, dirName: string): HldRecord | null {
  try {
    const parsed = JSON.parse(readFileSync(hldPath(projectRoot, dirName), 'utf8')) as Record<
      string,
      unknown
    >;
    if (!HLD_STATES.includes(parsed.state as HldState)) return null;
    return {
      state: parsed.state as HldState,
      ref: typeof parsed.ref === 'string' ? parsed.ref : '',
      version: typeof parsed.version === 'number' ? parsed.version : 0,
      digest: typeof parsed.digest === 'string' ? parsed.digest : '',
      posts: Array.isArray(parsed.posts) ? (parsed.posts as HldPost[]) : [],
      approved_at: typeof parsed.approved_at === 'string' ? parsed.approved_at : null,
      approval_link: typeof parsed.approval_link === 'string' ? parsed.approval_link : null,
      skip_reason: typeof parsed.skip_reason === 'string' ? parsed.skip_reason : null,
    };
  } catch {
    return null;
  }
}

function writeAtomic(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, text, 'utf8');
  renameSync(tmp, path);
}

export interface WriteHldOptions {
  sessionId?: string | null;
  now?: () => Date;
  waits?: boolean;
}

export function writeHld(
  projectRoot: string,
  dirName: string,
  record: HldRecord,
  options: WriteHldOptions = {},
): string {
  const doc = stampFeatureDocument({
    projectRoot,
    dirName,
    docType: HLD_DOC_TYPE,
    schemaVersion: HLD_SCHEMA_VERSION,
    sessionId: options.sessionId,
    now: options.now,
    body: { ...record },
  });
  const path = hldPath(projectRoot, dirName);
  writeAtomic(path, `${JSON.stringify(doc, null, 2)}\n`);
  updateWaitingIndex(projectRoot, dirName, record, options.waits ?? true);
  return path;
}

export function writeHldMarkdown(projectRoot: string, dirName: string, text: string): string {
  const path = hldMarkdownPath(projectRoot, dirName);
  writeAtomic(path, text.endsWith('\n') ? text : `${text}\n`);
  return path;
}

export function latestPost(record: HldRecord): HldPost | null {
  return record.posts.at(-1) ?? null;
}

function waitingIndexPath(projectRoot: string): string {
  return join(projectRoot, PATHS.HLD_WAITING_INDEX);
}

export function readWaitingIndex(projectRoot: string): WaitingEntry[] {
  try {
    const parsed = JSON.parse(readFileSync(waitingIndexPath(projectRoot), 'utf8')) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is WaitingEntry =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as WaitingEntry).dir === 'string' &&
        typeof (entry as WaitingEntry).ref === 'string' &&
        typeof (entry as WaitingEntry).posted_at === 'string',
    );
  } catch {
    return [];
  }
}

function updateWaitingIndex(
  projectRoot: string,
  dirName: string,
  record: HldRecord,
  waits: boolean,
): void {
  const rest = readWaitingIndex(projectRoot).filter((entry) => entry.dir !== dirName);
  const post = latestPost(record);
  const next =
    waits && record.state === 'awaiting_sign_off' && post
      ? [...rest, { dir: dirName, ref: record.ref, posted_at: post.at }]
      : rest;
  writeAtomic(waitingIndexPath(projectRoot), `${JSON.stringify(next, null, 2)}\n`);
}
