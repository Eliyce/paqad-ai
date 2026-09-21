import { describe, expect, it } from 'vitest';

import { STAGE_ORDER } from '@/pipeline/feature-development-policy';
import {
  MANDATORY_STAGE_AGENTS,
  STAGE_AGENT_STAGES,
  agentNameForStage,
  buildStageAgentBody,
} from '@/stage-isolation/stage-agents';

describe('stage-agent definitions (issue #567)', () => {
  it('defines exactly the six mandatory stages, excluding ticket_intake and delivery', () => {
    expect(STAGE_AGENT_STAGES).toEqual([
      'planning',
      'specification',
      'development',
      'review',
      'checks',
      'documentation_sync',
    ]);
    expect(STAGE_AGENT_STAGES).not.toContain('ticket_intake');
    expect(STAGE_AGENT_STAGES).not.toContain('delivery');
  });

  it('every stage agent maps to a real STAGE_ORDER stage', () => {
    for (const def of MANDATORY_STAGE_AGENTS) {
      expect(STAGE_ORDER).toContain(def.ledgerStage);
    }
    expect(MANDATORY_STAGE_AGENTS).toHaveLength(6);
  });

  it('names agents paqad-<stage> with hyphens', () => {
    expect(agentNameForStage('development')).toBe('paqad-development');
    expect(agentNameForStage('documentation_sync')).toBe('paqad-documentation-sync');
    expect(MANDATORY_STAGE_AGENTS.map((d) => d.agentName)).toContain('paqad-documentation-sync');
  });

  it('scopes tools per stage — development can edit, read-only stages cannot', () => {
    const dev = MANDATORY_STAGE_AGENTS.find((d) => d.ledgerStage === 'development')!;
    const review = MANDATORY_STAGE_AGENTS.find((d) => d.ledgerStage === 'review')!;
    expect(dev.claudeTools).toContain('Edit');
    expect(dev.claudeTools).toContain('Write');
    expect(review.claudeTools).not.toContain('Edit');
    // Every stage needs Bash to run the paqad-ai stage verbs.
    for (const def of MANDATORY_STAGE_AGENTS) {
      expect(def.claudeTools).toContain('Bash');
    }
  });

  it('the cold-brief body carries the load steps, the stage verbs, and the hard rules', () => {
    const body = buildStageAgentBody(MANDATORY_STAGE_AGENTS[0]!);
    expect(body).toContain('framework-path.txt');
    expect(body).toContain('SE_SESSION');
    expect(body).toContain('stage start planning');
    expect(body).toContain('Never ask the human');
    expect(body).toContain('paused: D-<id>');
  });
});
