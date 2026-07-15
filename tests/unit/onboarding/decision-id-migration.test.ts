import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import { isStrictDecisionId } from '@/planning/decision-packet.js';
import { migrateLegacyDecisionIds } from '@/onboarding/decision-id-migration.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-decision-migration-'));
  mkdirSync(join(root, PATHS.DECISIONS_PENDING_DIR), { recursive: true });
  mkdirSync(join(root, PATHS.DECISIONS_RESOLVED_DIR), { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writePacket(dir: string, id: string, extra: Record<string, unknown> = {}): void {
  writeFileSync(join(root, dir, `${id}.json`), JSON.stringify({ id, ...extra }, null, 2));
}

describe('migrateLegacyDecisionIds', () => {
  it('renames a legacy D-{N}.json to a D-<ULID>.json and updates the in-file id (AC-3)', () => {
    writePacket(PATHS.DECISIONS_RESOLVED_DIR, 'D-2', { title: 'keep me' });

    const migrations = migrateLegacyDecisionIds(root);

    expect(migrations).toHaveLength(1);
    const { from, to, dir } = migrations[0]!;
    expect(from).toBe('D-2');
    expect(isStrictDecisionId(to)).toBe(true);
    expect(dir).toBe(PATHS.DECISIONS_RESOLVED_DIR);

    // Old file gone, new file present, in-file id updated, rest preserved.
    expect(existsSync(join(root, PATHS.DECISIONS_RESOLVED_DIR, 'D-2.json'))).toBe(false);
    const migrated = JSON.parse(
      readFileSync(join(root, PATHS.DECISIONS_RESOLVED_DIR, `${to}.json`), 'utf8'),
    ) as { id: string; title: string };
    expect(migrated.id).toBe(to);
    expect(migrated.title).toBe('keep me');
  });

  it('migrates the decision_id field of the automated packet shape too', () => {
    writeFileSync(
      join(root, PATHS.DECISIONS_PENDING_DIR, 'D-5.json'),
      JSON.stringify({ decision_id: 'D-5', question: 'q' }),
    );

    const [migration] = migrateLegacyDecisionIds(root);

    const migrated = JSON.parse(
      readFileSync(join(root, PATHS.DECISIONS_PENDING_DIR, `${migration!.to}.json`), 'utf8'),
    ) as { decision_id: string };
    expect(migrated.decision_id).toBe(migration!.to);
  });

  it('leaves already-ULID packets untouched — idempotent (AC-4)', () => {
    const ulidId = 'D-01J000000000000000000000A1';
    writePacket(PATHS.DECISIONS_RESOLVED_DIR, ulidId, { title: 'already good' });

    const migrations = migrateLegacyDecisionIds(root);

    expect(migrations).toEqual([]);
    expect(existsSync(join(root, PATHS.DECISIONS_RESOLVED_DIR, `${ulidId}.json`))).toBe(true);
    // A second run still does nothing.
    expect(migrateLegacyDecisionIds(root)).toEqual([]);
  });

  it('remaps an index.json reference from the legacy id to the minted id', () => {
    writePacket(PATHS.DECISIONS_RESOLVED_DIR, 'D-3');
    writeFileSync(
      join(root, PATHS.DECISIONS_INDEX),
      JSON.stringify({
        fingerprints: { 'sha256:x': 'D-3' },
        decisions: { 'D-3': { decision_id: 'D-3' } },
      }),
    );

    const [migration] = migrateLegacyDecisionIds(root);
    const index = JSON.parse(readFileSync(join(root, PATHS.DECISIONS_INDEX), 'utf8')) as {
      fingerprints: Record<string, string>;
      decisions: Record<string, unknown>;
    };

    expect(index.fingerprints['sha256:x']).toBe(migration!.to);
    expect(index.decisions[migration!.to]).toBeDefined();
    expect(index.decisions['D-3']).toBeUndefined();
  });

  it('still migrates the packet when index.json is malformed (index left alone)', () => {
    writePacket(PATHS.DECISIONS_RESOLVED_DIR, 'D-3');
    writeFileSync(join(root, PATHS.DECISIONS_INDEX), '{ not json');

    const migrations = migrateLegacyDecisionIds(root);

    expect(migrations).toHaveLength(1);
    expect(isStrictDecisionId(migrations[0]!.to)).toBe(true);
    // The malformed index is untouched, never rewritten into a broken half-state.
    expect(readFileSync(join(root, PATHS.DECISIONS_INDEX), 'utf8')).toBe('{ not json');
  });

  it('is best-effort: a malformed packet is left in place, not dropped', () => {
    writeFileSync(join(root, PATHS.DECISIONS_RESOLVED_DIR, 'D-9.json'), '{ not json');

    const migrations = migrateLegacyDecisionIds(root);

    expect(migrations).toEqual([]);
    // The unreadable file survives (never silently lost).
    expect(readdirSync(join(root, PATHS.DECISIONS_RESOLVED_DIR))).toContain('D-9.json');
  });

  it('no-ops on a project with no decisions directory', () => {
    const bare = mkdtempSync(join(tmpdir(), 'paqad-decision-migration-bare-'));
    try {
      expect(migrateLegacyDecisionIds(bare)).toEqual([]);
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });
});
