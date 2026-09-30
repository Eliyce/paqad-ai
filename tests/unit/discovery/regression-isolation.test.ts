// Regression guard (#597, DW-15/INV-1/INV-2): Discovery must not disturb feature-development or the
// other flows. These assertions fail loudly if a future change lets Discovery bleed into the
// feature stage order, the feature-evidence tree, or the feature-dev routing decision.

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { discoveryBoundaryVerdict } from '@/discovery/boundary.js';
import { discoveryDir } from '@/discovery/paths.js';
import { recordDiscoveryStage } from '@/discovery/recorder.js';
import { openDiscoveryRun } from '@/discovery/run-store.js';
import { DISCOVERY_EVIDENCE_DOC_TYPE, DISCOVERY_STAGE_ORDER } from '@/discovery/index.js';
import { PATHS } from '@/core/constants/paths.js';
import { STAGE_ORDER } from '@/pipeline/feature-development-policy.js';
import { isFeatureDevelopmentRoute } from '@/pipeline/routed-workflow.js';
import { STAGE_EVIDENCE_DOC_TYPE } from '@/stage-evidence/types.js';
import { writeWorkflowState } from '@/pipeline/workflow-state.js';

const roots: string[] = [];
function tempRoot(): string {
  const r = mkdtempSync(join(tmpdir(), 'paqad-discovery-iso-'));
  roots.push(r);
  return r;
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('Discovery does not disturb feature-development (INV-1/INV-2)', () => {
  it('adds no stage to the feature-development stage order', () => {
    for (const stage of DISCOVERY_STAGE_ORDER) {
      expect(STAGE_ORDER as readonly string[]).not.toContain(stage);
    }
    // The feature order is exactly its eight known stages, unchanged by #597.
    expect([...STAGE_ORDER]).toEqual([
      'ticket_intake',
      'planning',
      'specification',
      'development',
      'review',
      'checks',
      'documentation_sync',
      'delivery',
    ]);
  });

  it('rides a different evidence doc type than feature-development', () => {
    expect(DISCOVERY_EVIDENCE_DOC_TYPE).not.toBe(STAGE_EVIDENCE_DOC_TYPE);
  });

  it('keeps discovery out of the feature-development route', () => {
    expect(isFeatureDevelopmentRoute('discovery')).toBe(false);
    expect(isFeatureDevelopmentRoute('feature-development')).toBe(true);
  });

  it('writes only under .paqad/ledger/delivery, never the feature-evidence tree', () => {
    const root = tempRoot();
    const { dirName } = openDiscoveryRun(root, { sessionId: 's', title: 'idea', adapter: 'x' });
    recordDiscoveryStage(root, dirName, {
      sessionId: 's',
      stage: 'understand',
      phase: 'start',
      revision: 1,
    });
    expect(existsSync(join(root, discoveryDir(), dirName))).toBe(true);
    // No feature bundle was created by any Discovery write.
    expect(existsSync(join(root, PATHS.FEATURE_EVIDENCE_DIR))).toBe(false);
  });

  it('a Discovery session never enforces on a feature-development session (DW-AC11)', () => {
    const root = tempRoot();
    // Session A is building a feature; session C is running Discovery in the same checkout.
    writeWorkflowState(root, 'A', {
      active: { workflow: 'feature-development', changeKey: 'k' },
      paused: [],
    });
    writeWorkflowState(root, 'C', { active: { workflow: 'discovery' }, paused: [] });
    // The Discovery gate does not apply to A's actions at all.
    const forA = discoveryBoundaryVerdict({
      projectRoot: root,
      sessionId: 'A',
      action: 'source-mutation',
    });
    expect(forA.applicable).toBe(false);
    expect(forA.block).toBe(false);
  });
});
