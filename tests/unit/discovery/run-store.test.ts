import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { discoveryRunFilePath, isDiscoveryRunDirName } from '@/discovery/paths.js';
import {
  listDiscoveryRuns,
  openDiscoveryRun,
  readDiscoveryRun,
  resolveDiscoveryRunDir,
  updateDiscoveryRun,
} from '@/discovery/run-store.js';

const roots: string[] = [];
function tempRoot(): string {
  const r = mkdtempSync(join(tmpdir(), 'paqad-discovery-run-'));
  roots.push(r);
  return r;
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('discovery run store', () => {
  it('opens a run with an active, revision-1, outcome-null record', () => {
    const root = tempRoot();
    const { dirName, record } = openDiscoveryRun(root, {
      sessionId: 'sess-A',
      title: 'Bulk invoice export #597',
      adapter: 'claude-code',
    });
    expect(isDiscoveryRunDirName(dirName)).toBe(true);
    expect(record.workflow).toBe('discovery');
    expect(record.status).toBe('active');
    expect(record.revision).toBe(1);
    expect(record.outcome).toBeNull();
    expect(record.session_id).toBe('sess-A');
    expect(record.issue).toBe('597');
    // recorded_at equals opened_at (writer clock pinned).
    expect(record.recorded_at).toBe(record.opened_at);
    // On disk and readable back.
    expect(readDiscoveryRun(root, dirName)).toEqual(record);
  });

  it('reads null for an absent or malformed run', () => {
    const root = tempRoot();
    expect(readDiscoveryRun(root, `missing-01M3RWNS7194V0PV2RX340VM50`)).toBeNull();
    const { dirName } = openDiscoveryRun(root, {
      sessionId: 's',
      title: 'idea',
      adapter: 'claude-code',
    });
    // Corrupt the file → tolerant read returns null.
    const path = join(root, discoveryRunFilePath(dirName, 'run'));
    rmSync(path);
    expect(readDiscoveryRun(root, dirName)).toBeNull();
  });

  it('updates status/outcome and bumps revision while preserving owner + opened_at', () => {
    const root = tempRoot();
    const opened = openDiscoveryRun(root, {
      sessionId: 'sess-A',
      title: 'idea',
      adapter: 'claude-code',
      now: () => new Date('2026-09-30T10:00:00.000Z'),
    });
    const updated = updateDiscoveryRun(root, opened.dirName, {
      status: 'completed',
      outcome: 'experiment',
      bumpRevision: true,
      now: () => new Date('2026-09-30T11:00:00.000Z'),
    });
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe('completed');
    expect(updated!.outcome).toBe('experiment');
    expect(updated!.revision).toBe(2);
    expect(updated!.session_id).toBe('sess-A');
    expect(updated!.opened_at).toBe('2026-09-30T10:00:00.000Z');
    expect(updated!.updated_at).toBe('2026-09-30T11:00:00.000Z');
  });

  it('applies a bare patch with default clock, no revision bump, and preserved outcome', () => {
    const root = tempRoot();
    const opened = openDiscoveryRun(root, { sessionId: 's', title: 'idea', adapter: 'x' });
    // First set an outcome, then a bare status-only patch must preserve it and not bump revision.
    updateDiscoveryRun(root, opened.dirName, { outcome: 'deferred', now: () => new Date() });
    const updated = updateDiscoveryRun(root, opened.dirName, { status: 'paused' });
    expect(updated!.status).toBe('paused');
    expect(updated!.outcome).toBe('deferred');
    expect(updated!.revision).toBe(1);
  });

  it('can clear an outcome back to null explicitly', () => {
    const root = tempRoot();
    const opened = openDiscoveryRun(root, { sessionId: 's', title: 'idea', adapter: 'x' });
    updateDiscoveryRun(root, opened.dirName, { outcome: 'experiment' });
    const cleared = updateDiscoveryRun(root, opened.dirName, { outcome: null });
    expect(cleared!.outcome).toBeNull();
  });

  it('update on a missing run writes nothing and returns null', () => {
    const root = tempRoot();
    expect(
      updateDiscoveryRun(root, 'idea-01M3RWNS7194V0PV2RX340VM50', { status: 'blocked' }),
    ).toBeNull();
  });

  it('lists only well-formed run dirs, sorted', () => {
    const root = tempRoot();
    const a = openDiscoveryRun(root, { sessionId: 's', title: 'alpha', adapter: 'x' });
    const b = openDiscoveryRun(root, { sessionId: 's', title: 'beta', adapter: 'x' });
    const runs = listDiscoveryRuns(root);
    expect(runs).toContain(a.dirName);
    expect(runs).toContain(b.dirName);
    expect([...runs].sort()).toEqual(runs);
  });

  it('lists empty for a project with no delivery dir', () => {
    expect(listDiscoveryRuns(tempRoot())).toEqual([]);
  });

  it('resolves a numeric-leading slug via the authoritative run.json (m5)', () => {
    const root = tempRoot();
    // issue:null but a title that slugs to a numeric-leading slug → dir "597-fix-<ULID>", whose
    // dir-name parse reads "597" as an issue and "fix" as the slug (the shared tie-break). The run's
    // own run.json carries the true slug "597-fix", so resolving by it must still find the run.
    const { dirName, record } = openDiscoveryRun(root, {
      sessionId: 's',
      title: '597 fix',
      issue: null,
      adapter: 'x',
      ulid: '01M3RWNS7194V0PV2RX340VM50',
    });
    expect(record.slug).toBe('597-fix');
    expect(resolveDiscoveryRunDir(root, '597-fix')).toBe(dirName);
  });

  it('resolves a run by exact dir name, ULID, and slug; null for empty/unknown', () => {
    const root = tempRoot();
    const { dirName } = openDiscoveryRun(root, {
      sessionId: 's',
      title: 'bulk export',
      adapter: 'x',
      ulid: '01M3RWNS7194V0PV2RX340VM50',
    });
    expect(resolveDiscoveryRunDir(root, dirName)).toBe(dirName);
    expect(resolveDiscoveryRunDir(root, '01M3RWNS7194V0PV2RX340VM50')).toBe(dirName);
    expect(resolveDiscoveryRunDir(root, 'bulk-export')).toBe(dirName);
    expect(resolveDiscoveryRunDir(root, '   ')).toBeNull();
    expect(resolveDiscoveryRunDir(root, 'nope')).toBeNull();
  });
});
