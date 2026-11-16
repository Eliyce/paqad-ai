import { afterEach, describe, expect, it } from 'vitest';

import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import { qualifyHudChange } from '@/hud/change-scope.js';
import { writeRouteCorrection } from '@/pipeline/route-switch.js';
import { appendRouteTurn, episodeStart, readRouteTurns } from '@/pipeline/route-turns.js';
import { readWorkflowState, writeWorkflowState } from '@/pipeline/workflow-state.js';
import { persistLedgerSessionId } from '@/rag-ledger/session.js';
import { endStage, startStage } from '@/stage-evidence/recorder.js';
import { cleanupScopeFixtures, repoRoot } from '../hud/scope-fixtures.js';

const SES = 'ses_route_switch';

afterEach(cleanupScopeFixtures);

describe('a route correction appends a route turn (B1)', () => {
  it('AC-15: a project-question turn corrected to feature-development keeps the change qualified on the next prompt', () => {
    const root = repoRoot('fix/x');
    const turn = new Date(Date.now() - 60_000).toISOString();
    writeWorkflowState(root, SES, {
      active: { workflow: 'project-question' },
      paused: [],
      turn_started_at: turn,
    });
    appendRouteTurn(root, SES, { at: turn, workflow: 'project-question' });

    writeRouteCorrection(root, SES, 'feature-development', { source: 'route-set' });

    expect(readRouteTurns(root, SES).at(-1)).toEqual({ at: turn, workflow: 'feature-development' });
    expect(episodeStart(readRouteTurns(root, SES), 'feature-development')).toBe(turn);

    openFeatureChange(root, SES, { adapter: 'claude-code', title: 'B1 change', lane: 'full' });
    persistLedgerSessionId(root, SES);
    startStage(root, 'planning', { sessionId: SES, adapter: 'claude-code' });
    endStage(root, 'planning', { artifactPaths: [] }, { sessionId: SES, adapter: 'claude-code' });
    expect(qualifyHudChange(root, SES).reason).toBe('qualified');

    const next = new Date(Date.now() + 1_000).toISOString();
    writeWorkflowState(root, SES, {
      ...readWorkflowState(root, SES),
      turn_started_at: next,
    });
    appendRouteTurn(root, SES, { at: next, workflow: 'feature-development' });
    expect(qualifyHudChange(root, SES).reason).toBe('qualified');
  });

  it('AC-15: logs a failed append to hooks.log and still corrects the route', () => {
    const root = repoRoot('fix/x');
    writeWorkflowState(root, SES, { active: { workflow: 'project-question' }, paused: [] });
    expect(() =>
      writeRouteCorrection(root, SES, 'feature-development', {}, () => new Date(Number.NaN)),
    ).not.toThrow();
    expect(readWorkflowState(root, SES).active?.workflow).toBe('feature-development');
  });
});
