import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createLaneCommand } from '@/cli/commands/lane.js';
import { createProgram } from '@/cli/program.js';
import { readChangeConstants, readFeatureRecord } from '@/feature-evidence/feature-record.js';
import { currentFeature, openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import { readRouteOverrides } from '@/pipeline/route-override-log.js';
import { ROUTE_SWITCHED_LINE } from '@/pipeline/route-switch.js';
import { readWorkflowState, writeWorkflowState } from '@/pipeline/workflow-state.js';
import { resolveSessionId } from '@/rag-ledger/session.js';

describe('paqad-ai lane command', () => {
  let root: string;
  const SES = 'ses_cli_lane';

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-cli-lane-'));
    mkdirSync(join(root, '.paqad'), { recursive: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
    rmSync(root, { recursive: true, force: true });
  });

  function openFast(): string {
    return openFeatureChange(root, SES, { adapter: 'claude-code', lane: 'fast' });
  }

  async function run(...args: string[]): Promise<{ lines: string[]; errors: string[] }> {
    const lines: string[] = [];
    const errors: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: string) => {
      lines.push(String(line));
    });
    vi.spyOn(console, 'error').mockImplementation((line: string) => {
      errors.push(String(line));
    });
    await createLaneCommand().parseAsync([...args, '--project-root', root, '--session', SES], {
      from: 'user',
    });
    return { lines, errors };
  }

  it('is registered on the program', () => {
    const names = createProgram().commands.map((command) => command.name());
    expect(names).toContain('lane');
  });

  it('raises the recorded lane the isolation check reads (FR-1, AC-2)', async () => {
    const dir = openFast();
    const { lines } = await run('set', 'full');
    expect(readChangeConstants(root, dir).lane).toBe('full');
    expect(lines.join('\n')).toContain('lane raised to full');
    const json = JSON.parse(lines.at(-1)!);
    expect(json).toMatchObject({ set: true, lane: 'full', requested: 'full', changed: true });
  });

  it('AC-9, AC-10: records a lane set by hand as manual, and still refuses to lower it', async () => {
    const dir = openFeatureChange(root, SES, { adapter: 'claude-code', lane: 'full' });
    expect(readFeatureRecord(root, dir)?.lane_source).toBe('classifier');
    const { lines } = await run('set', 'graduated');
    expect(readFeatureRecord(root, dir)).toMatchObject({ lane: 'full', lane_source: 'classifier' });
    expect(lines.join('\n')).toContain("won't be downgraded");
    await run('set', 'full');
    expect(readFeatureRecord(root, dir)).toMatchObject({ lane: 'full', lane_source: 'manual' });
  });

  it('refuses a downgrade and keeps the higher lane (FR-3, AC-3)', async () => {
    const dir = openFast();
    await run('set', 'full');
    const { lines } = await run('set', 'fast');
    expect(readChangeConstants(root, dir).lane).toBe('full');
    expect(lines.join('\n')).toContain("won't be downgraded");
    const json = JSON.parse(lines.at(-1)!);
    expect(json).toMatchObject({
      lane: 'full',
      requested: 'fast',
      changed: false,
      refused_downgrade: true,
    });
  });

  it('reports no-op when the lane already matches', async () => {
    openFast();
    const { lines } = await run('set', 'fast');
    const json = JSON.parse(lines.at(-1)!);
    expect(json).toMatchObject({ lane: 'fast', changed: false, refused_downgrade: false });
    expect(lines.join('\n')).toContain('already fast');
  });

  it('rejects an unknown lane', async () => {
    openFast();
    const { errors } = await run('set', 'huge');
    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toContain('unknown lane "huge"');
  });

  it('errors with no active feature', async () => {
    const { errors } = await run('set', 'full');
    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toContain('no active feature');
  });

  it('show prints the recorded lane', async () => {
    openFast();
    const { lines } = await run('show');
    expect(JSON.parse(lines.at(-1)!)).toEqual({ lane: 'fast' });
  });

  describe('the route', () => {
    beforeEach(() => {
      writeWorkflowState(root, SES, { active: { workflow: 'project-question' }, paused: [] });
    });

    it('AC-18: lane set full moves project-question to feature with source lane-set', async () => {
      openFast();
      const { lines } = await run('set', 'full');
      expect(readWorkflowState(root, SES).active?.workflow).toBe('feature-development');
      expect(readRouteOverrides(root, SES)).toEqual([
        expect.objectContaining({ source: 'lane-set', agent_label: 'feature-development' }),
      ]);
      expect(lines.indexOf(ROUTE_SWITCHED_LINE)).toBeGreaterThanOrEqual(0);
      expect(JSON.parse(lines.at(-1)!)).toMatchObject({ set: true, lane: 'full' });
    });

    it('AC-18: a refused lane set leaves the route', async () => {
      const { errors } = await run('set', 'full');
      expect(errors.join('\n')).toContain('no active feature');
      expect(readWorkflowState(root, SES).active?.workflow).toBe('project-question');
      expect(readRouteOverrides(root, SES)).toEqual([]);
    });

    it('AC-18: a lane set on a session read from the shared cache leaves the route', async () => {
      vi.stubEnv('SE_SESSION', undefined);
      vi.stubEnv('CLAUDE_SESSION_ID', undefined);
      openFast();
      resolveSessionId(root, SES);
      vi.spyOn(console, 'log').mockImplementation(() => {});
      await createLaneCommand().parseAsync(['set', 'full', '--project-root', root], {
        from: 'user',
      });
      vi.unstubAllEnvs();
      expect(readChangeConstants(root, currentFeature(root, SES)!).lane).toBe('full');
      expect(readWorkflowState(root, SES).active?.workflow).toBe('project-question');
      expect(readRouteOverrides(root, SES)).toEqual([]);
    });

    it('AC-17: a lane set after a switch records no second switch', async () => {
      openFast();
      await run('set', 'graduated');
      vi.restoreAllMocks();
      const { lines } = await run('set', 'full');
      expect(lines).not.toContain(ROUTE_SWITCHED_LINE);
      expect(readRouteOverrides(root, SES)).toHaveLength(1);
    });
  });
});
