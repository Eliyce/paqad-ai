import { describe, expect, it } from 'vitest';

import { overlapScore } from '@/authoring/overlap';
import { STAGE_ORDER } from '@/pipeline/feature-development-policy';
import { renderStageAgentFiles } from '@/stage-isolation/agent-writer';
import {
  HIGH_TABLE_AGENTS,
  MANDATORY_STAGE_AGENTS,
  readStageReportStatus,
  REPORT_MAX_TOKENS,
  STAGE_REPORT_STATUSES,
  STAGE_AGENT_STAGES,
  agentNameForStage,
  AGENT_ENTRY_MARKER_FALLBACK,
  buildStageAgentBody,
  DEVELOPMENT_RESUME_LINE,
  SPEC_FOREGROUND_START_LINE,
  STAGE_AGENT_HARD_RULES,
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
    const body = buildStageAgentBody(MANDATORY_STAGE_AGENTS[0]!, 'codex-cli');
    expect(body).toContain('framework-path.txt');
    expect(body).toContain('SE_SESSION');
    expect(body).toContain('stage start planning');
    expect(body).toContain('Never ask the human');
    expect(body).toContain('paused: D-<id>');
  });

  it('the claude-code body leaves the hard rules to the SubagentStart brief, codex keeps them', () => {
    for (const def of MANDATORY_STAGE_AGENTS) {
      const claude = buildStageAgentBody(def, 'claude-code');
      expect(claude).toContain('framework-path.txt');
      expect(claude).toContain(`stage start ${def.ledgerStage}`);
      expect(claude).not.toContain('## Hard rules');
      expect(claude).not.toContain(STAGE_AGENT_HARD_RULES[0]);
      const codex = buildStageAgentBody(def, 'codex-cli');
      expect(codex).toContain('## Hard rules');
      for (const line of STAGE_AGENT_HARD_RULES) expect(codex).toContain(line);
    }
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

  it('only the development body says it may be resumed with a follow-up task', () => {
    expect(DEVELOPMENT_RESUME_LINE).toBe(
      "You may be resumed with a follow-up task for the same change. Keep working from what you already know; don't re-read files you have read unless they changed.",
    );
    for (const def of MANDATORY_STAGE_AGENTS) {
      for (const host of ['claude-code', 'codex-cli']) {
        expect(buildStageAgentBody(def, host).includes(DEVELOPMENT_RESUME_LINE)).toBe(
          def.ledgerStage === 'development',
        );
      }
    }
  });

  it('says the orchestrator resumes a paused stage agent with the answer', () => {
    const rules = STAGE_AGENT_HARD_RULES.join('\n');
    expect(rules).toContain('orchestrator asks the human and then resumes you with the answer.');
    expect(rules).not.toContain('re-dispatches you');
  });

  it('AC-45: only the specification body says to run spec pipeline start in the foreground', () => {
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

describe('stage-agent turn limits and Report sections', () => {
  const TURNS: Record<string, number> = {
    'paqad-planning': 60,
    'paqad-specification': 60,
    'paqad-development': 150,
    'paqad-review': 60,
    'paqad-checks': 60,
    'paqad-documentation-sync': 60,
    'paqad-expert': 20,
    'paqad-chief-architect': 30,
  };

  it('sets maxTurns per the issue table on every stage and High Table agent', () => {
    const defs = [...MANDATORY_STAGE_AGENTS, ...HIGH_TABLE_AGENTS];
    expect(Object.fromEntries(defs.map((def) => [def.agentName, def.maxTurns]))).toEqual(TURNS);
  });

  it('AC-9: every rendered agent carries maxTurns, a token maximum, the artifact and a Status line', () => {
    for (const agent of renderStageAgentFiles('claude-code')) {
      const name = agent.name.replace(/\.md$/u, '');
      expect(agent.content).toContain(`\nmaxTurns: ${TURNS[name]}\n`);
      const report = agent.content.slice(agent.content.indexOf('\n## Report\n'));
      expect(report).toContain(`under ${REPORT_MAX_TOKENS.toLocaleString('en-US')} tokens`);
      for (const status of STAGE_REPORT_STATUSES) expect(report).toContain(`\`Status: ${status}\``);
      expect(report).toContain('Leave ');
      expect(agent.content).not.toContain('—');
    }
  });

  it('AC-33: the Codex render keeps the must-not rules and states the turn limit in the Report', () => {
    for (const agent of renderStageAgentFiles('codex-cli')) {
      const name = agent.name.replace(/\.toml$/u, '');
      expect(agent.content).toContain('Never ask the human');
      expect(agent.content).toContain('Never write into a feature bundle directory');
      expect(agent.content).toContain(`finish in at most ${TURNS[name]} turns`);
      expect(agent.content).toContain('## Report');
      expect(agent.content).not.toContain('—');
    }
  });

  it('FR-30: each stage description names its own stage and artifact and stays dispatched-only', () => {
    for (const def of MANDATORY_STAGE_AGENTS) {
      expect(def.description).toContain(`paqad ${def.ledgerStage.replace(/_/g, ' ')} stage:`);
      expect(def.description.endsWith('Dispatched by the paqad orchestrator only.')).toBe(true);
    }
    const all = [...MANDATORY_STAGE_AGENTS, ...HIGH_TABLE_AGENTS];
    for (const left of all) {
      for (const right of all) {
        if (left === right) continue;
        expect(overlapScore(left.description, right.description)).toBeLessThan(0.4);
      }
    }
  });
});

describe('readStageReportStatus (AC-32)', () => {
  it('advances only on DONE or DONE_WITH_CONCERNS', () => {
    expect(readStageReportStatus('plan.json\nStatus: DONE').advance).toBe(true);
    expect(readStageReportStatus('Status: DONE_WITH_CONCERNS').advance).toBe(true);
    expect(readStageReportStatus('Status: NEEDS_CONTEXT').advance).toBe(false);
    expect(readStageReportStatus('paused: D-01ABC\nStatus: BLOCKED')).toEqual({
      status: 'BLOCKED',
      advance: false,
      decision: 'D-01ABC',
      stated: true,
    });
  });

  it('reads a return with no Status line as BLOCKED, never DONE', () => {
    expect(readStageReportStatus('I ran out of turns.')).toEqual({
      status: 'BLOCKED',
      advance: false,
      decision: null,
      stated: false,
    });
  });
});
