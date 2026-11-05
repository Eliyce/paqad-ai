import { resolveRecipe } from '@/stage-isolation/recipes.js';
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
  SPEC_HIGH_TABLE_HANDBACK_LINE,
  STAGE_AGENT_HARD_RULES,
  stageNoteLines,
  stageBriefFallbackLine,
  READ_ONLY_DO_NOT,
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
    expect(body).toContain('stage begin planning');
    expect(body).toContain('Do not ask the human');
    expect(body).toContain('paused: D-<id>');
  });

  it('every body uses the authoring headings in order and carries the BLOCKED report shape', () => {
    for (const def of MANDATORY_STAGE_AGENTS) {
      for (const host of ['claude-code', 'codex-cli']) {
        const body = buildStageAgentBody(def, host);
        const headings = body.split('\n').filter((line) => line.startsWith('## '));
        expect(headings).toEqual([
          '## Objective',
          '## Procedure',
          '## Report',
          '## Stop when',
          '## Do not',
          '## Example',
        ]);
        for (const line of ['Status: BLOCKED', 'Decision needed:', 'Options:']) {
          expect(body).toContain(line);
        }
      }
    }
  });

  it('the claude-code Do not section names what enforces each line, codex keeps the hard rules', () => {
    for (const def of MANDATORY_STAGE_AGENTS) {
      const claude = buildStageAgentBody(def, 'claude-code');
      expect(claude).toContain(`stage begin ${def.ledgerStage}`);
      const doNot = claude.slice(claude.indexOf('## Do not'), claude.indexOf('## Example'));
      expect(doNot).toContain('the AskUserQuestion tool is not available to you');
      expect(doNot).toContain('the capability gate blocks it');
      expect(doNot).toContain('`stage-agent-handback.mjs` refuses it');
      expect(doNot).not.toContain('holds a stage');
      const codex = buildStageAgentBody(def, 'codex-cli');
      for (const line of STAGE_AGENT_HARD_RULES) expect(codex).toContain(line);
      expect(codex).not.toContain('AskUserQuestion');
      expect(codex).not.toContain('.mjs');
    }
  });

  it('the claude-code body points at the stage brief and keeps the fallback and marker sentence', () => {
    for (const def of MANDATORY_STAGE_AGENTS) {
      const body = buildStageAgentBody(def, 'claude-code');
      expect(body).toContain(stageBriefFallbackLine(def.ledgerStage));
      expect(body).toContain(`run \`paqad-ai stage brief ${def.ledgerStage} --full\``);
      expect(body).not.toContain('docs/instructions/workflows/feature-development.yaml');
      expect(body).toContain(AGENT_ENTRY_MARKER_FALLBACK.join(' '));
      expect(body).toContain('No `## Your recipe` heading? Run the brief;');
      expect(body).toContain('still none, continue, reporting its repair');
      expect(body).not.toContain('reporting `paqad-ai update`');
      expect(body).not.toContain('heading in your context, return');
    }
  });

  it('the codex-cli body loads the framework itself instead of pointing at a stage brief', () => {
    for (const def of MANDATORY_STAGE_AGENTS) {
      const body = buildStageAgentBody(def, 'codex-cli');
      expect(body).toContain('Load `AGENT-ROUTER.md`');
      expect(body).toContain('.paqad/session/agent-entry/');
      expect(body).not.toContain(stageBriefFallbackLine(def.ledgerStage));
      expect(body).not.toContain('docs/instructions/workflows/feature-development.yaml');
    }
  });

  it('lets a read-only stage write only its stage input under .paqad/tmp/ with a heredoc', () => {
    expect(READ_ONLY_DO_NOT).toContain('`stage-agent-write-guard.mjs` blocks it');
    expect(READ_ONLY_DO_NOT).toContain('`.paqad/tmp/`, written with a shell heredoc');
    expect(READ_ONLY_DO_NOT).not.toContain('Do not edit or write files');
  });

  it('starts each stage through one command, on both hosts', () => {
    for (const def of MANDATORY_STAGE_AGENTS) {
      for (const host of ['claude-code', 'codex-cli']) {
        expect(buildStageAgentBody(def, host)).toContain(
          `4. \`paqad-ai stage begin ${def.ledgerStage} --agent ${def.agentName}\`.`,
        );
      }
    }
  });

  it('names the stage verb and the stage end command of each stage', () => {
    const verbs: Record<string, string> = {
      planning: 'paqad-ai plan compile',
      specification: 'paqad-ai spec freeze',
      development: 'paqad-ai stage begin development',
      review: 'paqad-ai review record',
      checks: 'paqad-ai checks run',
      documentation_sync: 'paqad-ai stage end documentation_sync',
    };
    for (const def of MANDATORY_STAGE_AGENTS) {
      const body = buildStageAgentBody(def, 'claude-code');
      expect(body).toContain(verbs[def.ledgerStage]);
      expect(body).toContain(`paqad-ai stage end ${def.ledgerStage}`);
    }
  });

  it('moved the work-quickly line into the two recipes that need it', () => {
    for (const def of MANDATORY_STAGE_AGENTS) {
      for (const host of ['claude-code', 'codex-cli']) {
        expect(buildStageAgentBody(def, host)).not.toContain(WORK_QUICKLY_LINE);
      }
    }
    for (const stage of ['checks', 'documentation_sync']) {
      expect(resolveRecipe(stage).body).toContain(WORK_QUICKLY_LINE.replace("doesn't", "doesn't"));
    }
  });

  it('moved the resume line into the development recipe', () => {
    for (const def of MANDATORY_STAGE_AGENTS) {
      expect(buildStageAgentBody(def, 'claude-code')).not.toContain(DEVELOPMENT_RESUME_LINE);
    }
    expect(resolveRecipe('development').body).toContain('You may be resumed');
  });

  it('says the orchestrator resumes a paused stage agent with the answer', () => {
    const rules = STAGE_AGENT_HARD_RULES.join('\n');
    expect(rules).toContain('orchestrator asks and resumes you');
    expect(rules).not.toContain('re-dispatches you');
  });

  it('the foreground line is in the specification brief, the body leaves it to the brief', () => {
    expect(SPEC_FOREGROUND_START_LINE).toBe(
      'Run `spec pipeline start` in the foreground. It returns within 20 seconds. Never background it and never poll `status`.',
    );
    for (const def of MANDATORY_STAGE_AGENTS) {
      expect(buildStageAgentBody(def, 'claude-code')).not.toContain(SPEC_FOREGROUND_START_LINE);
    }
    expect(stageNoteLines('specification')).toContain(SPEC_FOREGROUND_START_LINE);
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
    'paqad-planning': 100,
    'paqad-specification': 60,
    'paqad-development': 170,
    'paqad-review': 70,
    'paqad-checks': 20,
    'paqad-documentation-sync': 30,
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
      expect(agent.content).toMatch(/(Do not|Never) ask the human/u);
      expect(agent.content).toMatch(/(Do not|Never) write into a feature bundle directory/u);
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

describe('stage agent returns the orchestrator can act on', () => {
  function renderedClaude(name: string): string {
    const file = renderStageAgentFiles('claude-code').find((agent) => agent.name === `${name}.md`);
    return file!.content;
  }

  it('AC-10: the checks example returns DONE_WITH_CONCERNS for failing checks', () => {
    const checks = renderedClaude('paqad-checks');
    expect(checks).toContain('one line per failing check and `Status: DONE_WITH_CONCERNS`');
    expect(checks).toContain('return `Status: DONE` only when every check is green');
    expect(checks).not.toMatch(/one line per failing check, and `Status: DONE`\./u);
  });

  it('AC-11: the specification agent hands the seated roles back with NEEDS_CONTEXT', () => {
    const spec = renderedClaude('paqad-specification');
    expect(stageNoteLines('specification')).toContain(SPEC_HIGH_TABLE_HANDBACK_LINE);
    expect(SPEC_HIGH_TABLE_HANDBACK_LINE).toContain(
      'return at once with `Status: NEEDS_CONTEXT` naming every seated role',
    );
    expect(spec).toContain('or you returned the seated experts');
  });
});
