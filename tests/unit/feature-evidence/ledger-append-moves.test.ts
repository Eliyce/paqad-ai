import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  appendChainedStageRow,
  bundleLockPath,
  LOCK_TIMEOUT_NOTE,
} from '@/feature-evidence/ledger-append.js';
import { featureDir, featureFilePath } from '@/feature-evidence/paths.js';

const SESSION = 'ses_moves';
const ULID = '01JABCDEFGHJKMNPQRSTVWXY60';
const OLD = `old-name-${ULID}`;
const NEW = `new-name-${ULID}`;

const notRoot = process.getuid?.() !== 0 && process.platform !== 'win32';

describe('appending when the bundle moves or the disk refuses', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-append-moves-'));
    mkdirSync(join(root, featureDir(OLD)), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const ledgerPath = (dir: string) => join(root, featureFilePath(dir, 'stageEvidence'));
  const rows = (dir: string): Array<Record<string, unknown>> =>
    readFileSync(ledgerPath(dir), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  const append = (dirName: string, row: Record<string, unknown>, now?: () => Date) =>
    appendChainedStageRow({ projectRoot: root, sessionId: SESSION, dirName, row, now });
  const start = { kind: 'stage_start', stage: 'planning' };
  const moveBundle = () => renameSync(join(root, featureDir(OLD)), join(root, featureDir(NEW)));
  const onceThen = (action: () => void): (() => Date) => {
    let done = false;
    return () => {
      if (!done) {
        done = true;
        action();
      }
      return new Date();
    };
  };

  it('follows a bundle that was renamed before the append', () => {
    append(OLD, start);
    moveBundle();
    append(OLD, { kind: 'stage_end', stage: 'planning' });
    expect(existsSync(ledgerPath(OLD))).toBe(false);
    expect(rows(NEW).map((row) => row.kind)).toEqual(['stage_start', 'stage_end']);
  });

  it('follows a bundle renamed under it while it holds the lock', () => {
    append(OLD, start);
    append(OLD, { kind: 'stage_end', stage: 'planning' }, onceThen(moveBundle));
    expect(rows(NEW).map((row) => row.kind)).toEqual(['stage_start', 'stage_end']);
    expect(existsSync(ledgerPath(OLD))).toBe(false);
  });

  it('retries in place when its lock was lost with no rename', () => {
    append(OLD, start);
    const dropLock = () => rmSync(bundleLockPath(root, OLD), { recursive: true, force: true });
    append(OLD, { kind: 'stage_end', stage: 'planning' }, onceThen(dropLock));
    const written = rows(OLD);
    expect(written.map((row) => row.kind)).toEqual(['stage_start', 'stage_end']);
    expect(written[1]!.prev_hash).toBe(written[0]!.content_hash);
  });

  it('writes outside the lock, marked as such, when the lock is held by someone else', () => {
    append(OLD, start);
    mkdirSync(bundleLockPath(root, OLD));
    const row = append(OLD, { kind: 'stage_end', stage: 'planning' });
    expect(row.chain_note).toBe(LOCK_TIMEOUT_NOTE);
    expect(row.prev_hash).toBeNull();
    expect(rows(OLD)).toHaveLength(2);
  });

  it('follows a rename outside the lock too, when the lock travels with the old name', () => {
    append(OLD, start);
    mkdirSync(bundleLockPath(root, OLD));
    append(OLD, { kind: 'stage_end', stage: 'planning' }, onceThen(moveBundle));
    expect(rows(NEW).map((row) => row.kind)).toEqual(['stage_start', 'stage_end']);
  });

  it('prefers the sibling holding a ledger over one holding only a record', () => {
    append(OLD, start);
    const other = `other-name-${ULID}`;
    mkdirSync(join(root, featureDir(other)), { recursive: true });
    writeFileSync(join(root, featureFilePath(other, 'feature')), '---\n---\n');
    moveBundle();
    append(OLD, { kind: 'stage_end', stage: 'planning' });
    expect(rows(NEW)).toHaveLength(2);
    expect(existsSync(ledgerPath(other))).toBe(false);
  });

  it('takes the sibling holding the record when none holds a ledger', () => {
    const other = `other-name-${ULID}`;
    mkdirSync(join(root, featureDir(other)), { recursive: true });
    writeFileSync(join(root, featureFilePath(other, 'feature')), '---\n---\n');
    rmSync(join(root, featureDir(OLD)), { recursive: true, force: true });
    append(OLD, start);
    expect(rows(other)).toHaveLength(1);
  });

  it('takes the first sibling when none holds anything', () => {
    const first = `a-first-${ULID}`;
    const second = `b-second-${ULID}`;
    mkdirSync(join(root, featureDir(second)), { recursive: true });
    mkdirSync(join(root, featureDir(first)), { recursive: true });
    rmSync(join(root, featureDir(OLD)), { recursive: true, force: true });
    append(OLD, start);
    expect(rows(first)).toHaveLength(1);
  });

  it('refuses a name with no ULID: there is nothing to follow and no change to stamp', () => {
    const plain = 'no-ulid-here';
    expect(() => append(plain, start)).toThrow(/must match pattern/u);
    expect(existsSync(ledgerPath(plain))).toBe(false);
  });

  it('creates the bundle when its parent folder is gone', () => {
    rmSync(join(root, '.paqad'), { recursive: true, force: true });
    append(OLD, start);
    expect(rows(OLD)).toHaveLength(1);
  });

  it('throws when a path segment is a file, rather than dropping the row', () => {
    rmSync(join(root, featureDir(OLD)), { recursive: true, force: true });
    writeFileSync(join(root, featureDir(OLD)), 'not a folder');
    expect(() => append(OLD, start)).toThrow();
  });

  it.runIf(notRoot)('throws when the ledger cannot be opened for appending', () => {
    append(OLD, start);
    chmodSync(ledgerPath(OLD), 0o444);
    expect(() => append(OLD, { kind: 'stage_end', stage: 'planning' })).toThrow(/EACCES|EPERM/u);
    chmodSync(ledgerPath(OLD), 0o644);
    expect(rows(OLD)).toHaveLength(1);
  });

  it('writes the row again when the same row on disk has no readable time', () => {
    append(OLD, start);
    const [first] = rows(OLD);
    delete first!.recorded_at;
    writeFileSync(ledgerPath(OLD), `${JSON.stringify(first)}\n`);
    append(OLD, start);
    expect(rows(OLD)).toHaveLength(2);
  });

  it('dedupes the same tool use however long ago it was written', () => {
    const row = { ...start, tool_use_id: 'toolu_1' };
    const first = append(OLD, row);
    const later = () => new Date(Date.now() + 3_600_000);
    const second = append(OLD, row, later);
    expect(second.content_hash).toBe(first.content_hash);
    expect(rows(OLD)).toHaveLength(1);
  });
});
