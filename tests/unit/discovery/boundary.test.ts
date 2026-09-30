import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { openDiscoveryRun } from '@/discovery/run-store.js';
import {
  activeDiscoveryRunForSession,
  discoveryBoundaryVerdict,
  isDiscoverySession,
  ownsDiscoveryRun,
} from '@/discovery/boundary.js';
import { writeWorkflowState } from '@/pipeline/workflow-state.js';

const roots: string[] = [];
function tempRoot(): string {
  const r = mkdtempSync(join(tmpdir(), 'paqad-discovery-boundary-'));
  roots.push(r);
  return r;
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

/** Put `sessionId` on an active Discovery run, returning the run dir name. */
function onDiscoveryRun(root: string, sessionId: string): string {
  const { dirName } = openDiscoveryRun(root, { sessionId, title: 'idea', adapter: 'x' });
  writeWorkflowState(root, sessionId, {
    active: { workflow: 'discovery', discoveryRunId: dirName },
    paused: [],
  });
  return dirName;
}

describe('discovery boundary — isolation (DW-09/DW-10)', () => {
  it('is not-applicable for a non-Discovery session (AC-6)', () => {
    const root = tempRoot();
    writeWorkflowState(root, 'sess-fd', {
      active: { workflow: 'feature-development', changeKey: 'k' },
      paused: [],
    });
    const v = discoveryBoundaryVerdict({
      projectRoot: root,
      sessionId: 'sess-fd',
      action: 'source-mutation',
    });
    expect(v.applicable).toBe(false);
    expect(v.block).toBe(false);
    expect(v.reason).toBe('not-discovery-session');
    expect(isDiscoverySession(root, 'sess-fd')).toBe(false);
    expect(activeDiscoveryRunForSession(root, 'sess-fd')).toBeNull();
  });

  it('blocks a source mutation during Discovery, scoped to this session (DW-10/AC-21)', () => {
    const root = tempRoot();
    onDiscoveryRun(root, 'sess-C');
    const v = discoveryBoundaryVerdict({
      projectRoot: root,
      sessionId: 'sess-C',
      action: 'source-mutation',
    });
    expect(v.applicable).toBe(true);
    expect(v.block).toBe(true);
    expect(v.reason).toBe('source-mutation-blocked');
  });

  it('allows a read even during Discovery', () => {
    const root = tempRoot();
    onDiscoveryRun(root, 'sess-C');
    const v = discoveryBoundaryVerdict({ projectRoot: root, sessionId: 'sess-C', action: 'read' });
    expect(v.applicable).toBe(true);
    expect(v.block).toBe(false);
  });

  it('allows a stage action on the owned run and blocks a foreign run', () => {
    const root = tempRoot();
    const run = onDiscoveryRun(root, 'sess-C');
    const ok = discoveryBoundaryVerdict({
      projectRoot: root,
      sessionId: 'sess-C',
      action: 'stage',
      runDirName: run,
      stage: 'understand',
    });
    expect(ok.block).toBe(false);
    const foreign = discoveryBoundaryVerdict({
      projectRoot: root,
      sessionId: 'sess-C',
      action: 'artifact',
      runDirName: 'someone-else-01M3RWNS7194V0PV2RX340VM50',
    });
    expect(foreign.block).toBe(true);
    expect(foreign.reason).toBe('foreign-run');
  });

  it('blocks an unknown (feature-dev) stage', () => {
    const root = tempRoot();
    const run = onDiscoveryRun(root, 'sess-C');
    const v = discoveryBoundaryVerdict({
      projectRoot: root,
      sessionId: 'sess-C',
      action: 'stage',
      runDirName: run,
      stage: 'development',
    });
    expect(v.block).toBe(true);
    expect(v.reason).toBe('unknown-stage');
  });

  it('blocks a stage action when the Discovery session has no active run', () => {
    const root = tempRoot();
    writeWorkflowState(root, 'sess-C', { active: { workflow: 'discovery' }, paused: [] });
    const v = discoveryBoundaryVerdict({
      projectRoot: root,
      sessionId: 'sess-C',
      action: 'stage',
      stage: 'understand',
    });
    expect(v.block).toBe(true);
    expect(v.reason).toBe('no-active-run');
  });
});

describe('discovery ownership (INV-5)', () => {
  it('owns a run only when actively on it AND the run owner matches', () => {
    const root = tempRoot();
    const run = onDiscoveryRun(root, 'sess-C');
    expect(ownsDiscoveryRun(root, 'sess-C', run)).toBe(true);
    // A different session, even pointed at the same run in its own state, is not the run owner.
    writeWorkflowState(root, 'sess-D', {
      active: { workflow: 'discovery', discoveryRunId: run },
      paused: [],
    });
    expect(ownsDiscoveryRun(root, 'sess-D', run)).toBe(false);
  });

  it('does not own a run it is not actively on', () => {
    const root = tempRoot();
    const run = onDiscoveryRun(root, 'sess-C');
    writeWorkflowState(root, 'sess-C', { active: { workflow: 'discovery' }, paused: [] });
    expect(ownsDiscoveryRun(root, 'sess-C', run)).toBe(false);
  });
});
