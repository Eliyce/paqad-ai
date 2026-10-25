import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  CHECKS_RUNNING_CEILING_MS,
  checksRunningMarkerPath,
  clearChecksRunningMarker,
  liveChecksRunningMarker,
  readChecksRunningMarker,
  writeChecksRunningMarker,
  type ChecksRunningMarker,
} from '@/checks/running-marker.js';

const SESSION = 'ses-marker';
const STARTED = new Date('2026-10-25T10:00:00.000Z');
const at = (ms: number) => () => new Date(STARTED.getTime() + ms);

const alive = () => true;
const dead = () => false;
const checksCommand = () => 'node /usr/local/bin/paqad-ai checks run';

function marker(overrides: Partial<ChecksRunningMarker> = {}): ChecksRunningMarker {
  return {
    pid: 4242,
    session_id: SESSION,
    change: 'change-a',
    started_at: STARTED.toISOString(),
    ...overrides,
  };
}

describe('checks running marker', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-running-marker-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('writes and reads back the pid, session, change and start time', () => {
    writeChecksRunningMarker(root, marker());
    expect(readChecksRunningMarker(root, SESSION)).toEqual(marker());
  });

  it('keeps the marker file inside the checks dir whatever the session id holds', () => {
    expect(checksRunningMarkerPath(root, '../../etc/passwd')).toBe(
      join(root, '.paqad', 'checks', 'running', '__.._etc_passwd.json'),
    );
  });

  it('reads nothing for a missing or malformed marker', () => {
    expect(readChecksRunningMarker(root, SESSION)).toBeNull();
    const path = checksRunningMarkerPath(root, SESSION);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, '{"pid":"x"}');
    expect(readChecksRunningMarker(root, SESSION)).toBeNull();
    writeFileSync(path, 'not json');
    expect(readChecksRunningMarker(root, SESSION)).toBeNull();
  });

  it('clears only the marker its own process wrote', () => {
    writeChecksRunningMarker(root, marker());
    clearChecksRunningMarker(root, SESSION, 9999);
    expect(existsSync(checksRunningMarkerPath(root, SESSION))).toBe(true);
    clearChecksRunningMarker(root, SESSION, 4242);
    expect(existsSync(checksRunningMarkerPath(root, SESSION))).toBe(false);
    expect(() => clearChecksRunningMarker(root, SESSION, 4242)).not.toThrow();
  });

  describe('a live marker', () => {
    it('AC-21: counts while its checks run process is alive and young', () => {
      writeChecksRunningMarker(root, marker());
      expect(
        liveChecksRunningMarker(root, SESSION, {
          now: at(60_000),
          isAlive: alive,
          commandOf: checksCommand,
        }),
      ).toEqual(marker());
    });

    it('AC-21: does not count once its process is gone', () => {
      writeChecksRunningMarker(root, marker());
      expect(
        liveChecksRunningMarker(root, SESSION, {
          now: at(60_000),
          isAlive: dead,
          commandOf: checksCommand,
        }),
      ).toBeNull();
    });

    it('AC-22: does not count once it is older than 30 minutes', () => {
      writeChecksRunningMarker(root, marker());
      const probe = { isAlive: alive, commandOf: checksCommand };
      expect(
        liveChecksRunningMarker(root, SESSION, {
          ...probe,
          now: at(CHECKS_RUNNING_CEILING_MS - 1),
        }),
      ).not.toBeNull();
      expect(
        liveChecksRunningMarker(root, SESSION, { ...probe, now: at(CHECKS_RUNNING_CEILING_MS) }),
      ).toBeNull();
    });

    it('AC-39: does not count a forged marker whose process is not a checks run', () => {
      writeChecksRunningMarker(root, marker());
      expect(
        liveChecksRunningMarker(root, SESSION, {
          now: at(60_000),
          isAlive: alive,
          commandOf: () => 'sleep 99999',
        }),
      ).toBeNull();
      expect(
        liveChecksRunningMarker(root, SESSION, {
          now: at(60_000),
          isAlive: alive,
          commandOf: () => null,
        }),
      ).toBeNull();
    });

    it('does not count a marker that belongs to another session', () => {
      const path = checksRunningMarkerPath(root, SESSION);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify(marker({ session_id: 'ses-other' })));
      expect(
        liveChecksRunningMarker(root, SESSION, {
          now: at(60_000),
          isAlive: alive,
          commandOf: checksCommand,
        }),
      ).toBeNull();
    });

    it('does not count a marker that claims to start in the future', () => {
      writeChecksRunningMarker(root, marker());
      expect(
        liveChecksRunningMarker(root, SESSION, {
          now: at(-60_000),
          isAlive: alive,
          commandOf: checksCommand,
        }),
      ).toBeNull();
    });
  });
});
