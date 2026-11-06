import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { defaultDesignSignOff } from '@/git-workflow/defaults.js';
import type { ResolvedDesignSignOff } from '@/git-workflow/types.js';
import {
  decideApproval,
  parseRepliesFile,
  RepliesInputError,
  type HldReply,
} from '@/hld/approval.js';
import { DESTINATION_PROFILES } from '@/hld/destination.js';
import { authorDigest } from '@/hld/store.js';

const POST_AT = '2026-10-30T09:00:00Z';
const DEV = 'dev-account';

function reply(text: string, extra: Partial<HldReply> = {}): HldReply {
  return {
    author_id: 'mate-account',
    is_change_author: false,
    text,
    reaction: null,
    at: '2026-10-30T12:00:00Z',
    ...extra,
  };
}

function decide(
  replies: HldReply[],
  options: {
    status?: string | null;
    config?: Partial<ResolvedDesignSignOff>;
    postAt?: string;
    failed?: boolean;
  } = {},
) {
  return decideApproval({
    read: { replies, failed: options.failed ?? false },
    status: options.status ?? null,
    config: { ...defaultDesignSignOff(), ...options.config },
    latestPostAt: options.postAt ?? POST_AT,
    developerDigest: authorDigest(DEV),
  });
}

describe('replies file', () => {
  it('AC-28: each reply carries author_id, is_change_author, text, reaction and an ISO-8601 at', () => {
    const read = parseRepliesFile(
      JSON.stringify([
        {
          author_id: 'a',
          is_change_author: false,
          text: 'ok',
          reaction: null,
          at: '2026-10-30T10:00:00Z',
        },
        {
          author_id: 'b',
          is_change_author: false,
          text: '',
          reaction: '✅',
          at: '2026-10-30T10:00:00+02:00',
        },
      ]),
    );
    expect(read.failed).toBe(false);
    expect(read.replies).toHaveLength(2);
    expect(() =>
      parseRepliesFile(
        JSON.stringify([
          { author_id: 'a', is_change_author: false, text: 'ok', reaction: null, at: '30 Oct' },
        ]),
      ),
    ).toThrow(RepliesInputError);
    expect(() =>
      parseRepliesFile(
        JSON.stringify([{ author_id: 'a', text: 'ok', reaction: null, at: POST_AT }]),
      ),
    ).toThrow(/is_change_author/);
  });

  it('AC-43: a malformed file or a reply missing author_id or at fails with a plain message', () => {
    expect(() => parseRepliesFile('{nope')).toThrow("The replies file isn't valid JSON.");
    expect(() => parseRepliesFile('"text"')).toThrow(
      'The replies file must hold a list of replies.',
    );
    expect(() =>
      parseRepliesFile(
        JSON.stringify([{ is_change_author: false, text: 'ok', reaction: null, at: POST_AT }]),
      ),
    ).toThrow('Reply 1 has no author_id.');
    expect(() =>
      parseRepliesFile(
        JSON.stringify([{ author_id: 'a', is_change_author: false, text: 'ok', reaction: null }]),
      ),
    ).toThrow(/Reply 1 needs an at time/);
  });
});

describe('approval rule', () => {
  it('AC-29: a failed or empty read never approves or requests changes', () => {
    expect(
      decide([reply('approved')], {
        failed: true,
        status: 'Ready',
        config: { approved_status: 'Ready' },
      }),
    ).toEqual({
      outcome: 'waiting',
      shown: [],
    });
    expect(decide([])).toEqual({ outcome: 'waiting', shown: [] });
    expect(parseRepliesFile(JSON.stringify({ error: 'timeout', replies: [] })).failed).toBe(true);
  });

  it('AC-30: not approved, cannot sign off and a questioning approved never approve', () => {
    expect(decide([reply('not approved')]).outcome).toBe('changes_requested');
    expect(decide([reply("can't sign off yet")]).outcome).toBe('changes_requested');
    expect(decide([reply('approved?')]).outcome).toBe('waiting');
    expect(decide([reply('unapproved draft')]).outcome).toBe('waiting');
    expect(decide([reply('No problem, approved')]).outcome).toBe('approved');
  });

  it('AC-31: with approve_by either and approved_status empty, a status never approves', () => {
    expect(decide([], { status: '' }).outcome).toBe('waiting');
    expect(decide([], { status: null }).outcome).toBe('waiting');
    expect(decide([], { status: 'Done' }).outcome).toBe('waiting');
  });

  it('AC-32: only replies after the recorded latest post count', () => {
    const early = reply('approved', { at: '2026-10-30T08:59:59Z' });
    expect(decide([early]).outcome).toBe('waiting');
    expect(decide([reply('approved', { at: '2026-10-30T09:00:01Z' })]).outcome).toBe('approved');
  });

  it('AC-33: an approval at or before the v2 time does not approve, with zoned timestamps', () => {
    const v2At = '2026-10-31T10:00:00+02:00';
    expect(
      decide([reply('approved', { at: '2026-10-31T08:00:00Z' })], { postAt: v2At }).outcome,
    ).toBe('waiting');
    expect(
      decide([reply('approved', { at: '2026-10-31T07:59:00Z' })], { postAt: v2At }).outcome,
    ).toBe('waiting');
    expect(
      decide([reply('approved', { at: '2026-10-31T10:00:01+02:00' })], { postAt: v2At }).outcome,
    ).toBe('approved');
  });

  it('AC-35: a teammate approved after the post approves with its time', () => {
    expect(decide([reply('LGTM, ship it')])).toEqual({
      outcome: 'approved',
      via: 'reply',
      at: '2026-10-30T12:00:00Z',
    });
    expect(decide([reply('approved')], { config: { approvers: ['lead-account'] } }).outcome).toBe(
      'waiting',
    );
    expect(
      decide([reply('approved', { author_id: 'lead-account' })], {
        config: { approvers: ['lead-account'] },
      }).outcome,
    ).toBe('approved');
  });

  it('AC-36: approve_by status with --status equal to approved_status approves', () => {
    expect(
      decide([], {
        status: 'ready to build',
        config: { approve_by: 'status', approved_status: 'Ready to build' },
      }),
    ).toEqual({ outcome: 'approved', via: 'status', at: null });
  });

  it('AC-37: approve_by reply ignores status; approve_by status ignores an approved reply', () => {
    expect(
      decide([], { status: 'Ready', config: { approve_by: 'reply', approved_status: 'Ready' } })
        .outcome,
    ).toBe('waiting');
    expect(
      decide([reply('approved')], { config: { approve_by: 'status', approved_status: 'Ready' } })
        .outcome,
    ).toBe('waiting');
  });

  it('AC-38: with a Jira tracker and a Teams or Slack post, either the status or a channel reply approves', () => {
    const config = { approve_by: 'either' as const, approved_status: 'Ready to build' };
    expect(decide([], { status: 'Ready to build', config }).outcome).toBe('approved');
    expect(
      decide([reply('approved', { author_id: 'U02MATE567' })], { status: 'In design', config })
        .outcome,
    ).toBe('approved');
  });

  it('AC-39: a later look or a plain question keeps waiting and is shown', () => {
    expect(decide([reply('will look tomorrow'), reply('Why the new step?')])).toEqual({
      outcome: 'waiting',
      shown: ['will look tomorrow', 'Why the new step?'],
    });
  });

  it('AC-40: a reply that clearly asks for changes is changes_requested with its text', () => {
    expect(decide([reply('Please change the guest flow first')])).toEqual({
      outcome: 'changes_requested',
      replies: ['Please change the guest flow first'],
    });
    expect(decide([reply('this needs a rework')]).outcome).toBe('changes_requested');
  });

  it('AC-41: bot replies and reactions never approve or request changes', () => {
    expect(decide([reply('', { reaction: '✅', is_bot: true })]).outcome).toBe('waiting');
    expect(decide([reply('rejected', { is_bot: true })]).outcome).toBe('waiting');
  });
});

describe.each(DESTINATION_PROFILES.map((name) => [name]))('AC-54: recorded %s replies', (name) => {
  const fixture = JSON.parse(
    readFileSync(join(__dirname, '../../fixtures/hld', `${name}.json`), 'utf8'),
  ) as { developer: string; post_at: string; replies: Record<string, HldReply> };
  const run = (
    keys: string[],
    config: Partial<ResolvedDesignSignOff> = {},
    status: string | null = null,
  ) =>
    decideApproval({
      read: parseRepliesFile(JSON.stringify(keys.map((key) => fixture.replies[key]))),
      status,
      config: { ...defaultDesignSignOff(), approved_status: 'Ready to build', ...config },
      latestPostAt: fixture.post_at,
      developerDigest: authorDigest(fixture.developer),
    }).outcome;

  it.each([['reply'], ['status'], ['either']] as const)(
    'AC-34: the developer approved reply or reaction never approves with approve_by %s',
    (approveBy) => {
      expect(
        run(['developer_approved', 'developer_unflagged', 'developer_reaction'], {
          approve_by: approveBy,
        }),
      ).toBe('waiting');
    },
  );

  it('AC-35: a teammate reply or a check or thumbs reaction approves', () => {
    expect(run(['teammate_approved'])).toBe('approved');
    expect(run(['teammate_reaction'])).toBe('approved');
    expect(run(['teammate_thumbs'])).toBe('approved');
  });

  it('AC-41: a bot reaction does not count', () => {
    expect(run(['bot_reaction'])).toBe('waiting');
  });

  it('AC-39: a question keeps waiting and AC-40: a change request sends it back', () => {
    expect(run(['teammate_question'])).toBe('waiting');
    expect(run(['teammate_changes'])).toBe('changes_requested');
  });
});
