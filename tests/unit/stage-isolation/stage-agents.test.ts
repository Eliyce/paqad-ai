import { describe, expect, it } from 'vitest';

import { STAGE_ORDER } from '@/pipeline/feature-development-policy';
import {
  MANDATORY_STAGE_AGENTS,
  STAGE_AGENT_STAGES,
  agentNameForStage,
  AGENT_ENTRY_MARKER_FALLBACK,
  buildStageAgentBody,
  SPEC_FOREGROUND_START_LINE,
  STAGE_BRIEF_FALLBACK_LINE,
  WORK_QUICKLY_LINE,
} from '@/stage-isolation/stage-agents';
import { stageFromAgentType } from '@/stage-isolation/subagent-completion';

describe('stage-agent definitions', () => {
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

  it('the claude-code body points at the stage brief and keeps the fallback and marker sentence', () => {
    for (const def of MANDATORY_STAGE_AGENTS) {
      const body = buildStageAgentBody(def, 'claude-code');
      expect(body).toContain('## Your stage brief');
      expect(body).toContain(STAGE_BRIEF_FALLBACK_LINE);
      expect(body).toContain(AGENT_ENTRY_MARKER_FALLBACK.join('\n'));
      expect(body).not.toContain('## Load the framework first');
      expect(buildStageAgentBody(def)).toBe(body);
    }
  });

  it('the codex-cli body keeps the load-the-framework section', () => {
    for (const def of MANDATORY_STAGE_AGENTS) {
      const body = buildStageAgentBody(def, 'codex-cli');
      expect(body).toContain('## Load the framework first');
      expect(body).not.toContain('## Your stage brief');
    }
  });

  it('only checks and documentation_sync carry the work-quickly line, on both hosts', () => {
    for (const def of MANDATORY_STAGE_AGENTS) {
      const quick = def.ledgerStage === 'checks' || def.ledgerStage === 'documentation_sync';
      for (const host of ['claude-code', 'codex-cli']) {
        expect(buildStageAgentBody(def, host).includes(WORK_QUICKLY_LINE)).toBe(quick);
      }
    }
  });

  it('only the specification body says to run spec pipeline start in the foreground', () => {
    expect(SPEC_FOREGROUND_START_LINE).toBe(
      'Run `spec pipeline start` in the foreground. It returns within 20 seconds. Never background it and never poll `status`.',
    );
    for (const def of MANDATORY_STAGE_AGENTS) {
      for (const host of ['claude-code', 'codex-cli']) {
        expect(buildStageAgentBody(def, host).includes(SPEC_FOREGROUND_START_LINE)).toBe(
          def.ledgerStage === 'specification',
        );
      }
    }
  });

  it.each([
    'paqad-expert',
    'paqad:paqad-chief-architect',
    'paqad-foo',
    'paqad-documentation_sync',
    'xpaqad-planning',
  ])('stageFromAgentType returns null for %s', (agentType) => {
    expect(stageFromAgentType(agentType)).toBeNull();
  });
});
