import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import { bundleWriterFor } from '@/feature-evidence/manifest.js';
import {
  authorDigest,
  emptyHldRecord,
  hldMarkdownPath,
  readHld,
  readWaitingIndex,
  writeHld,
  writeHldMarkdown,
  type HldRecord,
} from '@/hld/store.js';

const DIR = 'add-checkout-01M6QK5T2B678P4DRW3T7FPYQB';
const REF = ['PQD', '123'].join('-');
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-hld-store-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function posted(state: HldRecord['state']): HldRecord {
  return {
    ...emptyHldRecord(REF),
    state,
    version: 1,
    digest: 'abc',
    posts: [
      {
        target: 'jira',
        link: 'https://example.com/c/1',
        id: 'c1',
        at: '2026-10-30T09:00:00Z',
        version: 1,
        digest: 'abc',
        author_digest: authorDigest('dev-account'),
        detail_posted: true,
        move_failed: false,
      },
    ],
  };
}

describe('hld store', () => {
  it('writes hld.json with the envelope and only the known fields, and reads it back', () => {
    const record = posted('awaiting_sign_off');
    writeHld(root, DIR, record, { sessionId: 's1', now: () => new Date('2026-10-30T09:00:00Z') });
    const raw = JSON.parse(
      readFileSync(join(root, PATHS.FEATURE_EVIDENCE_DIR, DIR, 'hld.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(raw.doc_type).toBe('paqad.hld');
    expect(
      Object.keys(raw).filter(
        (key) =>
          ![
            'schema_version',
            'doc_type',
            'change',
            'session_id',
            'recorded_at',
            'content_hash',
          ].includes(key),
      ),
    ).toEqual([
      'state',
      'ref',
      'version',
      'digest',
      'posts',
      'approved_at',
      'approval_link',
      'skip_reason',
    ]);
    expect(JSON.stringify(raw)).not.toContain('dev-account');
    expect(readHld(root, DIR)).toEqual(record);
  });

  it('keeps one small index of waiting refs that follows the state', () => {
    writeHld(root, DIR, posted('awaiting_sign_off'));
    expect(readWaitingIndex(root)).toEqual([
      { dir: DIR, ref: REF, posted_at: '2026-10-30T09:00:00Z' },
    ]);
    writeHld(root, DIR, posted('approved'));
    expect(readWaitingIndex(root)).toEqual([]);
  });

  it('AC-19: the bundle write guard names the hld verbs for hld.json and hld.md', () => {
    expect(bundleWriterFor('hld.json')).toBe(
      'paqad-ai hld posted, not-posted, check-approval or skip',
    );
    expect(bundleWriterFor('hld.md')).toBe('paqad-ai hld not-posted or hld posted --file');
  });

  it('reads a missing or broken hld.json as none', () => {
    expect(readHld(root, DIR)).toBeNull();
    const path = join(root, PATHS.FEATURE_EVIDENCE_DIR, DIR, 'hld.json');
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, JSON.stringify({ state: 'lost' }));
    expect(readHld(root, DIR)).toBeNull();
  });

  it('fills fields a hand-edited hld.json lost with empty values', () => {
    const path = join(root, PATHS.FEATURE_EVIDENCE_DIR, DIR, 'hld.json');
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, JSON.stringify({ state: 'not_posted', ref: 7, posts: 'none' }));
    expect(readHld(root, DIR)).toEqual({
      state: 'not_posted',
      ref: '',
      version: 0,
      digest: '',
      posts: [],
      approved_at: null,
      approval_link: null,
      skip_reason: null,
    });
  });

  it('saves hld.md ending with one newline', () => {
    writeHldMarkdown(root, DIR, 'line one');
    expect(readFileSync(hldMarkdownPath(root, DIR), 'utf8')).toBe('line one\n');
    writeHldMarkdown(root, DIR, 'line two\n');
    expect(readFileSync(hldMarkdownPath(root, DIR), 'utf8')).toBe('line two\n');
  });

  it('reads a waiting index that is not a list as empty and rebuilds it on the next write', () => {
    mkdirSync(join(root, PATHS.HLD_WAITING_INDEX, '..'), { recursive: true });
    writeFileSync(join(root, PATHS.HLD_WAITING_INDEX), JSON.stringify({ dir: DIR }));
    expect(readWaitingIndex(root)).toEqual([]);
    writeHld(root, DIR, posted('awaiting_sign_off'));
    expect(readWaitingIndex(root)).toHaveLength(1);
  });
});
