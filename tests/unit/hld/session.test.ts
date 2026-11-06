import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { currentFeature, openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import { authorDigest, emptyHldRecord, writeHld, type HldState } from '@/hld/store.js';
import { resumeWaitingByPrompt, waitingSignOffLines, waitingSignOffText } from '@/hld/session.js';

const REF = ['PQD', '123'].join('-');
const OTHER = ['PQD', '456'].join('-');
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-hld-session-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function waiting(
  session: string,
  ref: string,
  state: HldState = 'awaiting_sign_off',
  seed = 1,
): string {
  openFeatureChange(root, session, {
    adapter: 'claude-code',
    title: `change ${seed}`,
    ulidSeed: seed,
  });
  const dir = currentFeature(root, session)!;
  writeHld(root, dir, {
    ...emptyHldRecord(ref),
    state,
    version: 1,
    posts: [
      {
        target: 'jira',
        link: 'https://example.com/c/1',
        id: 'c1',
        at: '2026-10-30T09:00:00Z',
        version: 1,
        digest: 'd',
        author_digest: authorDigest('dev'),
        detail_posted: true,
        move_failed: false,
      },
    ],
  });
  return dir;
}

describe('waiting design sign-off across chats', () => {
  it('AC-50: a new session lists each waiting change once with its age', () => {
    waiting('ses_a', REF);
    waiting('ses_b', OTHER, 'awaiting_sign_off', 2);
    const now = new Date('2026-10-31T10:00:00Z');
    expect(waitingSignOffLines(root, now)).toEqual([
      `${REF} is waiting for high-level design sign-off (posted 1 day ago).`,
      `${OTHER} is waiting for high-level design sign-off (posted 1 day ago).`,
    ]);
    expect(waitingSignOffText(root, now)?.split('\n')).toHaveLength(2);
  });

  it('AC-50: approved changes and an empty index add nothing', () => {
    expect(waitingSignOffText(root)).toBeNull();
    waiting('ses_a', REF, 'approved');
    expect(waitingSignOffText(root)).toBeNull();
  });

  it('AC-52: a prompt naming a waiting ticket resumes that change and asks for check-approval first', () => {
    const dir = waiting('ses_old', REF);
    openFeatureChange(root, 'ses_new', {
      adapter: 'claude-code',
      title: 'other work',
      ulidSeed: 9,
    });
    expect(currentFeature(root, 'ses_new')).not.toBe(dir);
    const line = resumeWaitingByPrompt(root, 'ses_new', `any news on ${REF}?`);
    expect(line).toBe(
      `Resumed the change for ${REF}, which is waiting for high-level design sign-off. Run paqad-ai hld check-approval first.`,
    );
    expect(currentFeature(root, 'ses_new')).toBe(dir);
  });

  it('AC-52: an active change or a prompt with no waiting ref does nothing', () => {
    waiting('ses_old', REF);
    expect(resumeWaitingByPrompt(root, 'ses_old', `about ${REF}`)).toBeNull();
    expect(resumeWaitingByPrompt(root, 'ses_new', 'make the button blue')).toBeNull();
    expect(resumeWaitingByPrompt(root, 'ses_new', `about ${OTHER}`)).toBeNull();
  });
});
