import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDiscoveryCommand } from '@/cli/commands/discovery.js';
import { createProgram } from '@/cli/program.js';
import {
  discoveryReportPath,
  discoveryRunFilePath,
  isDiscoveryRunDirName,
} from '@/discovery/paths.js';
import { listDiscoveryRuns, readDiscoveryRun } from '@/discovery/run-store.js';

describe('paqad-ai discovery command', () => {
  let root: string;
  const SES = 'ses_cli_discovery';

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-cli-discovery-'));
    mkdirSync(join(root, '.paqad'), { recursive: true });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
    rmSync(root, { recursive: true, force: true });
  });

  async function run(...args: string[]): Promise<{ out: string[]; err: string[] }> {
    const out: string[] = [];
    const err: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((l: string) => void out.push(String(l)));
    vi.spyOn(console, 'error').mockImplementation((l: string) => void err.push(String(l)));
    await createDiscoveryCommand().parseAsync([...args, '--project-root', root, '--session', SES], {
      from: 'user',
    });
    vi.restoreAllMocks();
    return { out, err };
  }

  function tpl(name: string, body: unknown): string {
    const p = join(root, `${name}.json`);
    writeFileSync(p, JSON.stringify(body), 'utf8');
    return p;
  }

  async function startRun(): Promise<string> {
    const { out } = await run('start', '--title', 'Bulk invoice export', '--issue', '597');
    return (JSON.parse(out[out.length - 1]!) as { run: string }).run;
  }

  it('is registered on the program', () => {
    expect(createProgram().commands.map((c) => c.name())).toContain('discovery');
  });

  it('start opens a run, anchors the session, and status/report resolve it', async () => {
    const dir = await startRun();
    expect(isDiscoveryRunDirName(dir)).toBe(true);
    expect(readDiscoveryRun(root, dir)?.status).toBe('active');

    const status = await run('status');
    expect(status.out.join('\n')).toContain('verdict');

    const report = await run('report');
    expect(report.out.join('\n')).toContain(discoveryReportPath(dir));
    expect(readFileSync(join(root, discoveryReportPath(dir)), 'utf8')).toContain('<!doctype html>');
  });

  it('records every canonical artifact through its record subcommand', async () => {
    const dir = await startRun();
    await run(
      'brief',
      tpl('brief', {
        revision: 1,
        intent: 'i',
        facts: [],
        interpretations: [],
        success: [],
        constraints: [],
        open_questions: [],
        assignments: [],
      }),
    );
    await run(
      'synthesis',
      tpl('syn', {
        revision: 1,
        summary: 's',
        complementary: [],
        conflicts: [],
        recommendation: 'r',
        alternatives: [],
      }),
    );
    await run('decisions', tpl('dec', { revision: 1, decisions: [] }));
    await run(
      'readiness',
      tpl('rd', {
        revision: 1,
        outcome: 'development',
        verdict: 'ready',
        blockers: [],
        owners: [],
      }),
    );
    await run(
      'handoff',
      tpl('ho', {
        revision: 1,
        outcome: 'development',
        value: 'v',
        scope: 's',
        success: [],
        constraints: [],
        scenarios: [],
        decisions: [],
        next_action: 'go',
        authorization: 'ok',
      }),
    );
    await run(
      'source',
      tpl('src', {
        source_id: 'S1',
        title: 't',
        reference: null,
        kind: 'fact',
        retrieved_at: '2026-09-30',
        finding: 'f',
        uncertainty: null,
        counterevidence: null,
      }),
    );
    await run(
      'contribution',
      tpl('con', {
        expert_role: 'application-architect',
        expert_version: null,
        assignment: 'a',
        findings: [],
        references: [],
        uncertainty: null,
        conflicts: [],
        status: 'complete',
      }),
    );
    await run(
      'blocker',
      tpl('blk', { stage: 'check_readiness', description: 'd', owner: null, resolved: false }),
    );
    await run(
      'context',
      tpl('ctx', { stage: 'understand', items: ['current-request'], mode: 'read', reason: null }),
    );

    for (const f of ['brief', 'synthesis', 'decisions', 'readiness', 'handoff'] as const) {
      expect(readFileSync(join(root, discoveryRunFilePath(dir, f)), 'utf8').length).toBeGreaterThan(
        0,
      );
    }
    for (const f of ['sources', 'contributions', 'blockers', 'contextReceipts'] as const) {
      expect(
        readFileSync(join(root, discoveryRunFilePath(dir, f)), 'utf8').trim().length,
      ).toBeGreaterThan(0);
    }
  });

  it('records stage boundaries with an artifact', async () => {
    const dir = await startRun();
    await run(
      'brief',
      tpl('brief', {
        revision: 1,
        intent: 'i',
        facts: [],
        interpretations: [],
        success: [],
        constraints: [],
        open_questions: [],
        assignments: [],
      }),
    );
    await run('stage', 'start', 'understand');
    const end = await run(
      'stage',
      'end',
      'understand',
      '--artifact',
      discoveryRunFilePath(dir, 'brief'),
    );
    expect(end.out.join('\n')).toContain('"recorded":true');
  });

  it('set-status and resume update lifecycle and re-anchor', async () => {
    const dir = await startRun();
    const paused = await run('set-status', 'paused');
    expect(paused.out.join('\n')).toContain('"status":"paused"');
    const resumed = await run('resume', dir);
    expect(resumed.out.join('\n')).toContain('"resumed":true');
    const completed = await run(
      'set-status',
      'completed',
      '--outcome',
      'experiment',
      '--bump-revision',
    );
    expect(completed.out.join('\n')).toContain('"updated":true');
    expect(readDiscoveryRun(root, dir)?.outcome).toBe('experiment');
    expect(readDiscoveryRun(root, dir)?.revision).toBe(2);
  });

  it('reports precise errors for bad input', async () => {
    // No run yet.
    expect((await run('status')).err.join('\n')).toContain('no Discovery run');
    process.exitCode = undefined;
    await startRun();
    expect((await run('stage', 'sideways', 'understand')).err.join('\n')).toContain('phase');
    process.exitCode = undefined;
    expect((await run('stage', 'start', 'development')).err.join('\n')).toContain(
      'six Discovery stages',
    );
    process.exitCode = undefined;
    expect((await run('set-status', 'wat')).err.join('\n')).toContain('valid run status');
    process.exitCode = undefined;
    expect((await run('set-status', 'paused', '--outcome', 'nope')).err.join('\n')).toContain(
      'valid outcome',
    );
    process.exitCode = undefined;
    expect((await run('brief', join(root, 'missing.json'))).err.join('\n')).toContain(
      'readable JSON',
    );
    process.exitCode = undefined;
    expect((await run('resume', 'no-such-run')).err.join('\n')).toContain('matches');
    process.exitCode = undefined;
    // Context receipt refusal: extra item, no reason.
    const bad = await run(
      'context',
      tpl('ctxbad', {
        stage: 'understand',
        items: ['the-whole-rulebook'],
        mode: 'read',
        reason: null,
      }),
    );
    expect(bad.err.join('\n')).toContain('reason');
  });

  it('falls back to SE_SESSION when no --session is passed, and empty --run uses the anchor', async () => {
    const prev = process.env.SE_SESSION;
    process.env.SE_SESSION = 'ses_env_fallback';
    try {
      const out: string[] = [];
      vi.spyOn(console, 'log').mockImplementation((l: string) => void out.push(String(l)));
      await createDiscoveryCommand().parseAsync(
        ['start', '--title', 'env idea', '--project-root', root],
        { from: 'user' },
      );
      const dir = (JSON.parse(out[out.length - 1]!) as { run: string }).run;
      // Empty --run string falls through to the session anchor.
      out.length = 0;
      await createDiscoveryCommand().parseAsync(['status', '--run', '', '--project-root', root], {
        from: 'user',
      });
      vi.restoreAllMocks();
      expect(out.join('\n')).toContain(dir);
    } finally {
      if (prev === undefined) delete process.env.SE_SESSION;
      else process.env.SE_SESSION = prev;
    }
  });

  it('errors when an explicit --run ref matches nothing and no record without a run', async () => {
    expect(
      (await run('status', '--run', 'nope-01M3RWNS7194V0PV2RX340VM50')).err.join('\n'),
    ).toContain('no Discovery run');
    process.exitCode = undefined;
    // A record subcommand with no active run and no --run.
    const t = tpl('b', {
      revision: 1,
      intent: 'i',
      facts: [],
      interpretations: [],
      success: [],
      constraints: [],
      open_questions: [],
      assignments: [],
    });
    expect((await run('brief', t)).err.join('\n')).toContain('no Discovery run');
    process.exitCode = undefined;
    // Report/stage with no run.
    expect((await run('report')).err.join('\n')).toContain('no Discovery run');
    process.exitCode = undefined;
    expect((await run('stage', 'start', 'understand')).err.join('\n')).toContain(
      'no Discovery run',
    );
    process.exitCode = undefined;
    // context with no run.
    const c = tpl('c', { stage: 'understand', items: [], mode: 'read', reason: null });
    expect((await run('context', c)).err.join('\n')).toContain('no Discovery run');
    process.exitCode = undefined;
    // set-status with no run.
    expect((await run('set-status', 'paused')).err.join('\n')).toContain('no Discovery run');
  });

  it('errors on a record template that is not a JSON object', async () => {
    await startRun();
    const bad = join(root, 'arr.json');
    writeFileSync(bad, '[]', 'utf8');
    expect((await run('synthesis', bad)).err.join('\n')).toContain('readable JSON object');
    process.exitCode = undefined;
    // The context handler has its own not-an-object guard.
    expect((await run('context', bad)).err.join('\n')).toContain('readable JSON object');
  });

  it('defaults a context template that omits stage/items', async () => {
    await startRun();
    // No stage and no items → stage '' has an empty contract, items default to [] → recorded ok.
    const t = tpl('ctxmin', { mode: 'available' });
    expect((await run('context', t)).out.join('\n')).toContain('"recorded":true');
  });

  it('resolves a run by explicit --run ref when the session is not anchored', async () => {
    const dir = await startRun();
    // A fresh command with a DIFFERENT session but an explicit --run resolves it.
    const out: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((l: string) => void out.push(String(l)));
    await createDiscoveryCommand().parseAsync(
      ['status', '--run', dir, '--project-root', root, '--session', 'other-session'],
      { from: 'user' },
    );
    vi.restoreAllMocks();
    expect(out.join('\n')).toContain(dir);
    expect(listDiscoveryRuns(root)).toContain(dir);
  });
});
