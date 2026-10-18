import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UNRESOLVED_SESSION_REASON, createRouteCommand } from '@/cli/commands/route.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import { routeIsAffirmativelyNonFeature } from '@/pipeline/route-gate.js';
import { readSessionRoute, writeSessionRoute } from '@/pipeline/session-route.js';
import { readRouteOverrides } from '@/pipeline/route-override-log.js';
import {
  readWorkflowState,
  writeWorkflowState,
  type WorkflowState,
} from '@/pipeline/workflow-state.js';
import { resolveSessionId } from '@/rag-ledger/session.js';
import { readPendingLane, writePendingLane } from '@/stage-evidence/pending-lane.js';
import { startStage } from '@/stage-evidence/recorder.js';
import { seedGitChangedFiles } from '../pipeline/changed-files.fixture.js';

// `paqad-ai route set <workflow>` — let the agent correct the hook's deterministic label (#580).
describe('paqad-ai route set command', () => {
  let root: string;
  const SES = 'ses_cli_route';

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-cli-route-'));
    mkdirSync(join(root, '.paqad'), { recursive: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    process.exitCode = undefined;
    rmSync(root, { recursive: true, force: true });
  });

  async function routeSet(...args: string[]): Promise<string[]> {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: string) => lines.push(String(line)));
    vi.spyOn(console, 'error').mockImplementation((line: string) => lines.push(String(line)));
    await createRouteCommand().parseAsync(
      ['set', ...args, '--project-root', root, '--session', SES],
      { from: 'user' },
    );
    return lines;
  }

  it('flips enforcement off and records an audit row on a mislabelled question (AC-4)', async () => {
    const sessionId = resolveSessionId(root, SES);
    // The hook mislabelled a question as feature-development, and stashed a lane.
    writeWorkflowState(root, sessionId, {
      active: { workflow: 'feature-development', lane: 'fast' },
      paused: [],
    });
    writePendingLane(root, sessionId, 'fast');
    expect(routeIsAffirmativelyNonFeature(root, sessionId)).toBe(false);

    await routeSet('project-question', '--reason', 'this is a question');

    expect(process.exitCode).toBeUndefined();
    expect(readWorkflowState(root, sessionId).active?.workflow).toBe('project-question');
    expect(routeIsAffirmativelyNonFeature(root, sessionId)).toBe(true);
    // The stashed lane is cleared so it cannot leak onto a later change.
    expect(readPendingLane(root, sessionId)).toBeNull();

    const overrides = readRouteOverrides(root, sessionId);
    expect(overrides).toHaveLength(1);
    expect(overrides[0]).toMatchObject({
      source: 'agent-override',
      hook_label: 'feature-development',
      agent_label: 'project-question',
      reason: 'this is a question',
    });
  });

  describe('session-scoped refusal (#623)', () => {
    const OTHER = 'ses_cli_route_other';
    const TURN = '2026-03-01T10:00:00.000Z';
    const BEFORE = () => new Date('2026-03-01T09:00:00.000Z');
    const AFTER = () => new Date('2026-03-01T10:05:00.000Z');

    /** `session` opens an in-flight bundle and live-marks a development edit at `now`. */
    function editSource(session: string, now: () => Date): void {
      const dirName = openFeatureChange(root, session, {
        adapter: 'claude-code',
        title: `change by ${session}`,
        issue: null,
        now,
      });
      startStage(root, 'development', { sessionId: session, dirName, adapter: 'claude-code', now });
    }

    function onFeatureDev(session: string, extra: Partial<WorkflowState> = {}): void {
      writeWorkflowState(root, session, {
        active: { workflow: 'feature-development', lane: 'fast' },
        paused: [],
        turn_started_at: TURN,
        ...extra,
      });
    }

    it('refuses to leave feature-development once this session edited source this turn (AC-11)', async () => {
      onFeatureDev(SES);
      editSource(SES, AFTER);

      const lines = await routeSet('project-question');

      expect(process.exitCode).toBe(1);
      expect(lines.join('\n')).toContain(
        'cannot leave feature-development: source files were edited this turn.',
      );
      // The route is unchanged and no override was written.
      expect(readWorkflowState(root, SES).active?.workflow).toBe('feature-development');
      expect(readRouteOverrides(root, SES)).toHaveLength(0);
    });

    it('lets session B correct its route while session A edits the same checkout (AC-10)', async () => {
      onFeatureDev(OTHER);
      editSource(OTHER, AFTER);
      onFeatureDev(SES);

      await routeSet('project-question');

      expect(process.exitCode).toBeUndefined();
      expect(readWorkflowState(root, SES).active?.workflow).toBe('project-question');
    });

    it('does not refuse for a development row written before this turn started', async () => {
      onFeatureDev(SES);
      editSource(SES, BEFORE);

      await routeSet('project-question');

      expect(process.exitCode).toBeUndefined();
      expect(readWorkflowState(root, SES).active?.workflow).toBe('project-question');
    });

    it('refuses on an owned development row when the turn was never stamped', async () => {
      writeWorkflowState(root, SES, {
        active: { workflow: 'feature-development', lane: 'fast' },
        paused: [],
      });
      editSource(SES, BEFORE);

      await routeSet('project-question');

      expect(process.exitCode).toBe(1);
    });

    it('no longer refuses for a dirty git tree alone', async () => {
      onFeatureDev(SES);
      seedGitChangedFiles(root, ['src/app.ts']);

      await routeSet('project-question');

      expect(process.exitCode).toBeUndefined();
      expect(readWorkflowState(root, SES).active?.workflow).toBe('project-question');
    });

    it('allows the correction and logs why when no session id is given (AC-12)', async () => {
      vi.stubEnv('SE_SESSION', '');
      vi.stubEnv('CLAUDE_SESSION_ID', '');
      // The shared cache names a session that did edit this turn: it must not be trusted.
      const cached = resolveSessionId(root, SES);
      onFeatureDev(cached);
      editSource(cached, AFTER);
      vi.spyOn(console, 'log').mockImplementation(() => undefined);
      vi.spyOn(console, 'error').mockImplementation(() => undefined);

      await createRouteCommand().parseAsync(
        ['set', 'project-question', '--project-root', root, '--reason', 'a question'],
        { from: 'user' },
      );

      expect(process.exitCode).toBeUndefined();
      expect(readWorkflowState(root, cached).active?.workflow).toBe('project-question');
      const overrides = readRouteOverrides(root, cached);
      expect(overrides).toHaveLength(1);
      expect(overrides[0]?.reason).toBe(`a question; ${UNRESOLVED_SESSION_REASON}`);
    });

    it('takes the session from SE_SESSION when --session is not given', async () => {
      vi.stubEnv('SE_SESSION', SES);
      onFeatureDev(SES);
      editSource(SES, AFTER);
      vi.spyOn(console, 'log').mockImplementation(() => undefined);
      vi.spyOn(console, 'error').mockImplementation(() => undefined);

      await createRouteCommand().parseAsync(['set', 'project-question', '--project-root', root], {
        from: 'user',
      });

      expect(process.exitCode).toBe(1);
    });
  });

  it('rejects an unknown workflow', async () => {
    await routeSet('not-a-workflow');
    expect(process.exitCode).toBe(1);
  });

  it('reads the hook label from the route pointer and keeps its query and adapter', async () => {
    writeSessionRoute(
      root,
      { workflow: 'pentest', query: 'run a pentest', adapter: 'claude-code' },
      SES,
    );

    await routeSet('project-question');

    expect(readSessionRoute(root, SES)).toEqual({
      workflow: 'project-question',
      query: 'run a pentest',
      adapter: 'claude-code',
    });
    expect(readRouteOverrides(root, SES)[0]?.hook_label).toBe('pentest');
  });

  it('preserves the paused stack (rewrites the active entry, does not pause)', async () => {
    const sessionId = resolveSessionId(root, SES);
    writeWorkflowState(root, sessionId, {
      active: { workflow: 'feature-development', lane: 'fast' },
      paused: [{ workflow: 'documentation-update' }],
    });
    await routeSet('project-question');
    const state = readWorkflowState(root, sessionId);
    expect(state.active?.workflow).toBe('project-question');
    expect(state.paused).toEqual([{ workflow: 'documentation-update' }]);
  });
});
