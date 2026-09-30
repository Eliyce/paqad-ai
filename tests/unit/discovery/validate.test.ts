import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { discoveryRunFilePath } from '@/discovery/paths.js';
import { openDiscoveryRun } from '@/discovery/run-store.js';
import { DISCOVERY_DOC_TYPES } from '@/discovery/types.js';
import { validateDiscoveryArtifact } from '@/discovery/validate.js';
import { writeBrief, type DiscoveryWriteContext } from '@/discovery/writers.js';

const roots: string[] = [];
function setup(): { root: string; dirName: string; ctx: DiscoveryWriteContext } {
  const root = mkdtempSync(join(tmpdir(), 'paqad-discovery-val-'));
  roots.push(root);
  const { dirName } = openDiscoveryRun(root, {
    sessionId: 'sess-A',
    title: 'idea',
    adapter: 'x',
  });
  const ctx: DiscoveryWriteContext = { projectRoot: root, dirName, sessionId: 'sess-A' };
  writeBrief(ctx, {
    revision: 1,
    intent: 'i',
    facts: [],
    interpretations: [],
    success: [],
    constraints: [],
    open_questions: [],
    assignments: [],
  });
  return { root, dirName, ctx };
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('discovery validate', () => {
  it('accepts a freshly-written brief for its owner + expected doc type', () => {
    const { root, dirName } = setup();
    const res = validateDiscoveryArtifact(
      root,
      dirName,
      'sess-A',
      discoveryRunFilePath(dirName, 'brief'),
      DISCOVERY_DOC_TYPES.brief,
    );
    expect(res).toEqual({ ok: true, reason: 'ok', detail: expect.any(String) });
  });

  it('rejects a path outside the run dir', () => {
    const { root, dirName } = setup();
    const res = validateDiscoveryArtifact(root, dirName, 'sess-A', '.paqad/elsewhere/brief.json');
    expect(res.reason).toBe('wrong-path');
  });

  it('rejects a missing artifact', () => {
    const { root, dirName } = setup();
    const res = validateDiscoveryArtifact(
      root,
      dirName,
      'sess-A',
      discoveryRunFilePath(dirName, 'synthesis'),
    );
    expect(res.reason).toBe('missing');
  });

  it('rejects a malformed artifact', () => {
    const { root, dirName } = setup();
    const p = discoveryRunFilePath(dirName, 'readiness');
    writeFileSync(join(root, p), '{ not json', 'utf8');
    expect(validateDiscoveryArtifact(root, dirName, 'sess-A', p).reason).toBe('malformed');
    writeFileSync(join(root, p), '[]', 'utf8');
    expect(validateDiscoveryArtifact(root, dirName, 'sess-A', p).reason).toBe('malformed');
  });

  it('rejects a stale (hand-edited) artifact', () => {
    const { root, dirName } = setup();
    const p = discoveryRunFilePath(dirName, 'brief');
    const doc = JSON.parse(readFileSync(join(root, p), 'utf8')) as Record<string, unknown>;
    doc.intent = 'tampered';
    writeFileSync(join(root, p), JSON.stringify(doc), 'utf8');
    expect(validateDiscoveryArtifact(root, dirName, 'sess-A', p).reason).toBe('stale');
  });

  it('rejects a foreign-run artifact (wrong change key)', () => {
    const { root, dirName } = setup();
    const p = discoveryRunFilePath(dirName, 'brief');
    const doc = JSON.parse(readFileSync(join(root, p), 'utf8')) as Record<string, unknown>;
    doc.change = 'SOME-OTHER-RUN';
    writeFileSync(join(root, p), JSON.stringify(doc), 'utf8');
    expect(validateDiscoveryArtifact(root, dirName, 'sess-A', p).reason).toBe('foreign-run');
  });

  it('rejects a foreign-owner session', () => {
    const { root, dirName } = setup();
    const res = validateDiscoveryArtifact(
      root,
      dirName,
      'sess-B',
      discoveryRunFilePath(dirName, 'brief'),
    );
    expect(res.reason).toBe('foreign-owner');
  });

  it('rejects the wrong artifact for the stage', () => {
    const { root, dirName } = setup();
    const res = validateDiscoveryArtifact(
      root,
      dirName,
      'sess-A',
      discoveryRunFilePath(dirName, 'brief'),
      DISCOVERY_DOC_TYPES.synthesis,
    );
    expect(res.reason).toBe('wrong-artifact');
  });
});
