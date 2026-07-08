import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// codex-rollout.mjs backs finding 1 of issue #313: the record-only completion hook
// must read Codex's own rollout jsonl (where the mid-run `paqad:stage` markers live)
// because the Stop payload has no readable transcript_path and its inline final
// message is marker-less. These cover the file discovery + selection logic directly
// (the mjs is outside the src coverage denominator, so correctness is proven here).
import {
  codexSessionsDir,
  collectRolloutFiles,
  resolveCodexRolloutText,
} from '../../../runtime/hooks/lib/codex-rollout.mjs';

function writeRollout(dir: string, name: string, body: string, mtimeMs: number): string {
  mkdirSync(dir, { recursive: true });
  const full = join(dir, name);
  writeFileSync(full, body, 'utf8');
  const seconds = mtimeMs / 1000;
  utimesSync(full, seconds, seconds);
  return full;
}

describe('runtime/hooks/lib/codex-rollout.mjs', () => {
  let home: string;
  let sessionsDir: string;
  const savedCodexHome = process.env.CODEX_HOME;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'paqad-codex-'));
    process.env.CODEX_HOME = home;
    sessionsDir = join(home, 'sessions');
  });
  afterEach(() => {
    if (savedCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = savedCodexHome;
    rmSync(home, { recursive: true, force: true });
  });

  describe('codexSessionsDir', () => {
    it('honors a non-blank CODEX_HOME', () => {
      expect(codexSessionsDir()).toBe(join(home, 'sessions'));
    });

    it('falls back to ~/.codex/sessions when CODEX_HOME is unset', () => {
      delete process.env.CODEX_HOME;
      expect(codexSessionsDir()).toBe(join(homedir(), '.codex', 'sessions'));
    });

    it('falls back when CODEX_HOME is blank', () => {
      process.env.CODEX_HOME = '   ';
      expect(codexSessionsDir()).toBe(join(homedir(), '.codex', 'sessions'));
    });
  });

  describe('resolveCodexRolloutText', () => {
    it("returns '' when the sessions tree does not exist", () => {
      expect(resolveCodexRolloutText('abc')).toBe('');
    });

    it("returns '' when no rollout files are present", () => {
      const day = join(sessionsDir, '2026', '07', '08');
      mkdirSync(day, { recursive: true });
      writeFileSync(join(day, 'notes.txt'), 'not a rollout', 'utf8');
      expect(resolveCodexRolloutText(undefined)).toBe('');
    });

    it('prefers the rollout whose filename carries the session id', () => {
      const day = join(sessionsDir, '2026', '07', '08');
      writeRollout(day, 'rollout-2026-07-08T10-00-00-newest.jsonl', 'NEWEST no id', 5_000_000);
      writeRollout(day, 'rollout-2026-07-08T09-00-00-019f420f.jsonl', 'MATCH id', 1_000_000);
      expect(resolveCodexRolloutText('019f420f')).toBe('MATCH id');
    });

    it('falls back to the newest rollout by mtime when no id matches', () => {
      const day = join(sessionsDir, '2026', '07', '08');
      writeRollout(day, 'rollout-a.jsonl', 'OLD', 1_000_000);
      writeRollout(day, 'rollout-b.jsonl', 'NEW', 9_000_000);
      writeRollout(day, 'rollout-c.jsonl', 'MID', 5_000_000);
      expect(resolveCodexRolloutText('no-such-session')).toBe('NEW');
      expect(resolveCodexRolloutText(undefined)).toBe('NEW');
      expect(resolveCodexRolloutText('   ')).toBe('NEW');
    });
  });

  describe('collectRolloutFiles', () => {
    it('recurses dated subdirs and ignores non-rollout files', () => {
      const day = join(sessionsDir, '2026', '07', '08');
      writeRollout(day, 'rollout-x.jsonl', 'x', 1_000_000);
      writeFileSync(join(day, 'rollout-x.txt'), 'wrong ext', 'utf8');
      writeFileSync(join(day, 'other.jsonl'), 'wrong prefix', 'utf8');
      const found = collectRolloutFiles(sessionsDir);
      expect(found.map((f) => f.name)).toEqual(['rollout-x.jsonl']);
    });

    it('returns [] for an unreadable / missing root', () => {
      expect(collectRolloutFiles(join(home, 'does-not-exist'))).toEqual([]);
    });

    it('honors the depth guard', () => {
      let deep = sessionsDir;
      for (let i = 0; i < 8; i += 1) deep = join(deep, `d${i}`);
      writeRollout(deep, 'rollout-deep.jsonl', 'deep', 1_000_000);
      // Starting the walk at depth 7 (past the guard) yields nothing.
      expect(collectRolloutFiles(sessionsDir, 7)).toEqual([]);
    });
  });
});
