import { describe, expect, it } from 'vitest';

import { STAGE_ORDER } from '@/pipeline/feature-development-policy.js';
import {
  DISCOVERY_STAGE_ORDER,
  MANDATORY_DISCOVERY_STAGES,
  discoveryStageArtifactDocType,
  discoveryStageArtifactFile,
  discoveryStageIndex,
  isKnownDiscoveryStage,
  isMandatoryDiscoveryStage,
} from '@/discovery/stages.js';
import { DISCOVERY_DOC_TYPES } from '@/discovery/types.js';

describe('discovery stages', () => {
  it('has the six Discovery stages in canonical order', () => {
    expect([...DISCOVERY_STAGE_ORDER]).toEqual([
      'understand',
      'investigate',
      'refine',
      'decide',
      'check_readiness',
      'hand_off',
    ]);
  });

  it('shares no stage id with the feature-development stage order (INV-1)', () => {
    for (const stage of DISCOVERY_STAGE_ORDER) {
      expect(STAGE_ORDER as readonly string[]).not.toContain(stage);
    }
  });

  it('treats all six stages as mandatory', () => {
    expect([...MANDATORY_DISCOVERY_STAGES]).toEqual([...DISCOVERY_STAGE_ORDER]);
    expect(isMandatoryDiscoveryStage('understand')).toBe(true);
    expect(isMandatoryDiscoveryStage('planning')).toBe(false);
  });

  it('recognises only known stages', () => {
    expect(isKnownDiscoveryStage('refine')).toBe(true);
    expect(isKnownDiscoveryStage('development')).toBe(false);
    expect(discoveryStageIndex('decide')).toBe(3);
    expect(discoveryStageIndex('nope')).toBe(-1);
  });

  it('maps each stage to the doc type of the artifact its end must reference', () => {
    expect(discoveryStageArtifactDocType('understand')).toBe(DISCOVERY_DOC_TYPES.brief);
    expect(discoveryStageArtifactDocType('investigate')).toBe(DISCOVERY_DOC_TYPES.source);
    expect(discoveryStageArtifactDocType('refine')).toBe(DISCOVERY_DOC_TYPES.synthesis);
    expect(discoveryStageArtifactDocType('decide')).toBe(DISCOVERY_DOC_TYPES.decisions);
    expect(discoveryStageArtifactDocType('check_readiness')).toBe(DISCOVERY_DOC_TYPES.readiness);
    expect(discoveryStageArtifactDocType('hand_off')).toBe(DISCOVERY_DOC_TYPES.handoff);
    expect(discoveryStageArtifactDocType('nope')).toBeNull();
  });

  it('maps each stage to its canonical run file (m3)', () => {
    expect(discoveryStageArtifactFile('understand')).toBe('brief');
    expect(discoveryStageArtifactFile('investigate')).toBe('sources');
    expect(discoveryStageArtifactFile('refine')).toBe('synthesis');
    expect(discoveryStageArtifactFile('decide')).toBe('decisions');
    expect(discoveryStageArtifactFile('check_readiness')).toBe('readiness');
    expect(discoveryStageArtifactFile('hand_off')).toBe('handoff');
    expect(discoveryStageArtifactFile('nope')).toBeNull();
  });
});
