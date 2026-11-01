import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { appendFeatureStageRow, openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import { persistLedgerSessionId } from '@/rag-ledger/session.js';
import { isStageAgent } from '@/stage-evidence/agent-identity.js';
import {
  deferCompletionForBackgroundStage,
  stageAgentTaskCount,
} from '@/stage-evidence/completion-deferred.js';
import { STAGE_AGENT_KIND } from '@/stage-evidence/types.js';
import {
  hasStageAgentEvidence,
  readStageAgentRows,
  summarizeStageIsolation,
} from '@/stage-isolation/isolation-summary.js';
import {
  buildChiefArchitectAgentBody,
  buildExpertAgentBody,
  CHIEF_ARCHITECT_AGENT_NAME,
  EXPERT_AGENT_NAME,
  HIGH_TABLE_AGENTS,
  isHighTableAgent,
  MANDATORY_STAGE_AGENTS,
  STAGE_AGENT_STAGES,
  stageForAgentName,
} from '@/stage-isolation/stage-agents.js';
import { stageFromAgentType } from '@/stage-isolation/subagent-completion.js';

const STAGE_AGENTS = MANDATORY_STAGE_AGENTS.map((def) => def.agentName);
const NOT_STAGES = ['paqad-expert', 'paqad-chief-architect', 'paqad-helper', 'paqad-', 'paqad-x'];

const roots: string[] = [];
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('the High Table agents are never a stage (AC-42)', () => {
  it('AC-42: stageFromAgentType derives a stage only for the six stage agents', () => {
    expect(STAGE_AGENTS).toHaveLength(6);
    for (const name of STAGE_AGENTS) {
      expect(stageFromAgentType(name)).not.toBeNull();
      expect(stageFromAgentType(`paqad:${name}`)).toBe(stageFromAgentType(name));
    }
    expect(stageFromAgentType('paqad-documentation-sync')).toBe('documentation_sync');
    for (const name of NOT_STAGES) {
      expect(stageFromAgentType(name)).toBeNull();
      expect(stageFromAgentType(`paqad:${name}`)).toBeNull();
    }
    expect(stageFromAgentType(undefined)).toBeNull();
    expect(stageForAgentName(' paqad-review ')).toBe('review');
  });

  it('AC-42: the stage agent check is true only for the six', () => {
    for (const name of STAGE_AGENTS) expect(isStageAgent(name)).toBe(true);
    for (const name of NOT_STAGES) expect(isStageAgent(name)).toBe(false);
    expect(isStageAgent('orchestrator')).toBe(false);
    expect(isStageAgent(null)).toBe(false);
  });

  it('AC-42 / INV-2: completion-deferred stays as at HEAD: a Stop with a High Table seat in the background still defers, and the seat is never recorded as a stage-agent row', () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-ht-defer-'));
    roots.push(root);
    const seats = [{ agent_type: 'paqad-expert' }, { agent_type: 'paqad-chief-architect' }];
    expect(stageAgentTaskCount(seats)).toBe(2);
    const result = deferCompletionForBackgroundStage({
      projectRoot: root,
      backgroundTasks: seats,
      sessionId: 'ses_defer',
      adapter: 'claude-code',
    });
    expect(result.deferred).toBe(true);
    for (const name of [EXPERT_AGENT_NAME, CHIEF_ARCHITECT_AGENT_NAME, 'paqad:paqad-expert']) {
      expect(stageFromAgentType(name)).toBeNull();
      expect(isStageAgent(name)).toBe(false);
    }
  });

  it('AC-42: the isolation summary counts only the six stages', () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-ht-iso-'));
    roots.push(root);
    const dir = openFeatureChange(root, 'ses_iso', {
      adapter: 'claude-code',
      title: 'ORD-501 csv export',
      issue: 'ORD-501',
      lane: 'full',
    });
    persistLedgerSessionId(root, 'ses_iso');
    appendFeatureStageRow(root, 'ses_iso', dir, {
      kind: STAGE_AGENT_KIND,
      stage: 'expert',
      agent: 'paqad-expert',
      tokens_used: 900,
      tokens_not_recarried: 900,
      estimate: true,
    });
    expect(readStageAgentRows(root, dir)).toEqual([]);
    expect(hasStageAgentEvidence(root, dir)).toBe(false);
    expect(summarizeStageIsolation(root, dir)).toBeNull();

    appendFeatureStageRow(root, 'ses_iso', dir, {
      kind: STAGE_AGENT_KIND,
      stage: 'development',
      agent: 'paqad-development',
      tokens_used: 1200,
      tokens_not_recarried: 1200,
      estimate: true,
    });
    expect(readStageAgentRows(root, dir).map((row) => row.stage)).toEqual(['development']);
    expect(hasStageAgentEvidence(root, dir)).toBe(true);
    expect(summarizeStageIsolation(root, dir)?.stages).toBe(1);
  });

  it('keeps the two High Table agents out of the stage lists', () => {
    expect(STAGE_AGENT_STAGES).not.toContain('expert');
    expect(STAGE_AGENT_STAGES).not.toContain('chief_architect');
    expect(STAGE_AGENTS).not.toContain(EXPERT_AGENT_NAME);
    expect(STAGE_AGENTS).not.toContain(CHIEF_ARCHITECT_AGENT_NAME);
    expect(HIGH_TABLE_AGENTS.map((def) => def.agentName)).toEqual([
      'paqad-expert',
      'paqad-chief-architect',
    ]);
  });

  it('isHighTableAgent names the two seats, with or without the plugin namespace', () => {
    expect(isHighTableAgent('paqad-expert')).toBe(true);
    expect(isHighTableAgent(' paqad:paqad-chief-architect ')).toBe(true);
    expect(isHighTableAgent('paqad-development')).toBe(false);
    expect(isHighTableAgent('paqad-helper')).toBe(false);
    expect(isHighTableAgent(undefined)).toBe(false);
  });
});

describe('the High Table agent bodies', () => {
  it('the expert runs its brief first, writes one note for its role, records it and never edits source', () => {
    const body = buildExpertAgentBody();
    const brief = body.indexOf('paqad-ai spec pipeline experts brief <role>');
    const notes = body.indexOf('paqad-ai spec pipeline experts notes');
    expect(brief).toBeGreaterThan(-1);
    expect(notes).toBeGreaterThan(brief);
    expect(body).toContain('Write one note for your role');
    expect(body).toContain('expert-notes');
    expect(body).toContain('Never edit source');
    expect(body).toContain('SE_SESSION');
    expect(body).toMatch(/Return one line/);
    expect(body).not.toContain('\u2014');
  });

  it('the chief reads the context, writes the synthesis and records it', () => {
    const body = buildChiefArchitectAgentBody();
    const context = body.indexOf('paqad-ai spec pipeline experts context');
    const synthesis = body.indexOf('paqad-ai spec pipeline experts synthesis');
    expect(context).toBeGreaterThan(-1);
    expect(synthesis).toBeGreaterThan(context);
    expect(body).toContain('expert-synthesis');
    expect(body).toContain('SE_SESSION');
    expect(body).toContain('Never edit source');
    expect(body).not.toContain('\u2014');
  });
});
