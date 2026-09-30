import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { recordDiscoveryStage, readDiscoveryStageRows } from '@/discovery/recorder.js';
import { discoveryRunFilePath } from '@/discovery/paths.js';
import { openDiscoveryRun } from '@/discovery/run-store.js';
import { DISCOVERY_EVIDENCE_DOC_TYPE } from '@/discovery/types.js';

const roots: string[] = [];
function setup(): { root: string; dirName: string } {
  const root = mkdtempSync(join(tmpdir(), 'paqad-discovery-rec-'));
  roots.push(root);
  const { dirName } = openDiscoveryRun(root, { sessionId: 's', title: 'idea', adapter: 'x' });
  return { root, dirName };
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('discovery recorder', () => {
  it('records a start row under the discovery doc type in the run dir', () => {
    const { root, dirName } = setup();
    const row = recordDiscoveryStage(root, dirName, {
      sessionId: 's',
      stage: 'understand',
      phase: 'start',
      revision: 1,
    });
    expect(row).not.toBeNull();
    expect(row!.doc_type).toBe(DISCOVERY_EVIDENCE_DOC_TYPE);
    expect(row!.kind).toBe('stage_start');
    expect(row!.stage).toBe('understand');
    const rows = readDiscoveryStageRows(root, dirName);
    expect(rows).toHaveLength(1);
  });

  it('rejects an unknown (feature-dev) stage with null', () => {
    const { root, dirName } = setup();
    expect(
      recordDiscoveryStage(root, dirName, {
        sessionId: 's',
        stage: 'development',
        phase: 'start',
        revision: 1,
      }),
    ).toBeNull();
    expect(readDiscoveryStageRows(root, dirName)).toHaveLength(0);
  });

  it('hashes a real artifact into artifact_digest on end, null when empty/missing', () => {
    const { root, dirName } = setup();
    const artifact = discoveryRunFilePath(dirName, 'brief');
    writeFileSync(join(root, artifact), JSON.stringify({ x: 1 }), 'utf8');
    const withArtifact = recordDiscoveryStage(root, dirName, {
      sessionId: 's',
      stage: 'understand',
      phase: 'end',
      revision: 1,
      artifactPath: artifact,
    });
    expect(typeof withArtifact!.artifact_digest).toBe('string');

    // Empty artifact → null digest.
    writeFileSync(join(root, artifact), '', 'utf8');
    const empty = recordDiscoveryStage(root, dirName, {
      sessionId: 's',
      stage: 'refine',
      phase: 'end',
      revision: 1,
      artifactPath: artifact,
    });
    expect(empty!.artifact_digest).toBeNull();

    // Missing artifact → null digest, artifact_path preserved.
    const missing = recordDiscoveryStage(root, dirName, {
      sessionId: 's',
      stage: 'decide',
      phase: 'end',
      revision: 1,
      artifactPath: discoveryRunFilePath(dirName, 'synthesis'),
    });
    expect(missing!.artifact_digest).toBeNull();
    expect(missing!.artifact_path).toBe(discoveryRunFilePath(dirName, 'synthesis'));
  });

  it('records the recording agent when supplied', () => {
    const { root, dirName } = setup();
    const row = recordDiscoveryStage(root, dirName, {
      sessionId: 's',
      stage: 'understand',
      phase: 'start',
      revision: 1,
      agent: 'orchestrator',
    });
    expect(row!.agent).toBe('orchestrator');
  });

  it('reads empty for a run with no stage file', () => {
    const { root, dirName } = setup();
    expect(readDiscoveryStageRows(root, dirName)).toEqual([]);
  });
});
