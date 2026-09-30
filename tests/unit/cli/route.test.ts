import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createRouteCommand } from '@/cli/commands/route.js';
import { routeIsAffirmativelyNonFeature } from '@/pipeline/route-gate.js';
import { readRouteOverrides } from '@/pipeline/route-override-log.js';
import { readWorkflowState, writeWorkflowState } from '@/pipeline/workflow-state.js';
import { resolveSessionId } from '@/rag-ledger/session.js';
import { readPendingLane, writePendingLane } from '@/stage-evidence/pending-lane.js';

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

  it('refuses to leave feature-development once source files were edited this turn (AC-5)', async () => {
    const sessionId = resolveSessionId(root, SES);
    writeWorkflowState(root, sessionId, {
      active: { workflow: 'feature-development', lane: 'fast' },
      paused: [],
    });
    // A real source edit this turn.
    mkdirSync(join(root, '.paqad/session'), { recursive: true });
    writeFileSync(join(root, '.paqad/session/changed-files.json'), JSON.stringify(['src/app.ts']));

    await routeSet('project-question');

    expect(process.exitCode).toBe(1);
    // The route is unchanged and no override was written.
    expect(readWorkflowState(root, sessionId).active?.workflow).toBe('feature-development');
    expect(readRouteOverrides(root, sessionId)).toHaveLength(0);
  });

  it('rejects an unknown workflow', async () => {
    await routeSet('not-a-workflow');
    expect(process.exitCode).toBe(1);
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
