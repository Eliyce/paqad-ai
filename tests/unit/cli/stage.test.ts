import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createStageCommand } from '@/cli/commands/stage.js';
import { createProgram } from '@/cli/program.js';
import { listFeatureDirs } from '@/feature-evidence/enumerate.js';
import { readFeatureRecord } from '@/feature-evidence/feature-record.js';
import { featureFilePath } from '@/feature-evidence/paths.js';
import { readSessionControl, setLane } from '@/feature-evidence/session-control.js';
import {
  appendFeatureStageRow,
  closeActiveFeature,
  currentFeature,
  openFeatureChange,
  readFeatureStageUnit,
  resolveFeatureRef,
} from '@/feature-evidence/stage-ledger.js';
import { classifyCompletionEnforcement } from '@/pipeline/session-ownership.js';
import { writeWorkflowState } from '@/pipeline/workflow-state.js';
import { resolveSessionId } from '@/rag-ledger/session.js';
import { planLaneResize } from '@/feature-evidence/lane-resize.js';
import { writePendingImpact, writePendingLane } from '@/stage-evidence/pending-lane.js';
import { STAGE_AGENT_KIND } from '@/stage-evidence/types.js';
import { buildStageBrief } from '@/stage-isolation/stage-brief.js';

describe('paqad-ai stage command', () => {
  let root: string;
  const SES = 'ses_cli_stage';

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-cli-stage-'));
    mkdirSync(join(root, '.paqad'), { recursive: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
    rmSync(root, { recursive: true, force: true });
  });

  function rows() {
    const dir = currentFeature(root, SES);
    return dir ? readFeatureStageUnit(root, dir) : [];
  }

  async function run(...args: string[]): Promise<string[]> {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: string) => {
      lines.push(String(line));
    });
    await createStageCommand().parseAsync([...args, '--project-root', root, '--session', SES], {
      from: 'user',
    });
    return lines;
  }

  it('is registered on the program', () => {
    const names = createProgram().commands.map((command) => command.name());
    expect(names).toContain('stage');
  });

  it('records a start+end pair, script-minting the ledger rows', async () => {
    await run('start', 'planning');
    await run('end', 'planning');

    const recorded = rows();
    expect(recorded.some((r) => r.kind === 'stage_start' && r.stage === 'planning')).toBe(true);
    expect(recorded.some((r) => r.kind === 'stage_end' && r.stage === 'planning')).toBe(true);
    expect(recorded.every((r) => !r.stage || r.evidence_source === 'live-mark')).toBe(true);
  });

  it('hashes an `--artifact` on end into artifact_digest, but ignores it on start', async () => {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(root, 'findings.md'), '# findings\n');
    await run('start', 'development', '--artifact', 'findings.md');
    await run('end', 'development', '--artifact', 'findings.md');
    const end = rows().find((r) => r.kind === 'stage_end' && r.stage === 'development');
    expect(typeof end?.artifact_digest).toBe('string');
    expect(end?.artifact_digest).toMatch(/^sha256-/);
    const start = rows().find((r) => r.kind === 'stage_start' && r.stage === 'development');
    expect(start?.artifact_digest ?? null).toBeNull();
  });

  it('leaves artifact_digest null when the --artifact file is missing', async () => {
    await run('start', 'review');
    await run('end', 'review', '--artifact', 'nope.md');
    const end = rows().find((r) => r.kind === 'stage_end' && r.stage === 'review');
    expect(end?.artifact_digest ?? null).toBeNull();
  });

  it('accepts an ABSOLUTE in-tree --artifact by normalizing it to relative', async () => {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(root, 'findings.md'), '# findings\n');
    await run('start', 'development');
    await run('end', 'development', '--artifact', join(root, 'findings.md'));
    const end = rows().find((r) => r.kind === 'stage_end' && r.stage === 'development');
    expect(end?.artifact_digest).toMatch(/^sha256-/);
    expect(end?.artifact_paths).toEqual(['findings.md']);
  });

  it('rejects an out-of-tree --artifact loudly with exit 1 and writes no row', async () => {
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((line: string) => {
      errors.push(String(line));
    });
    await run('start', 'planning');
    const before = rows().length;
    await run('end', 'planning', '--artifact', join(tmpdir(), 'paqad-oot-review.md'));
    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toContain('artifact must be a path inside the project');
    expect(rows().filter((r) => r.kind === 'stage_end' && r.stage === 'planning')).toHaveLength(0);
    expect(rows().length).toBe(before);
  });

  it('ignores an out-of-tree path on a START (artifacts are end-only)', async () => {
    await run('start', 'planning', '--artifact', join(tmpdir(), 'paqad-oot.md'));
    expect(process.exitCode).toBeUndefined();
    expect(rows().some((r) => r.kind === 'stage_start' && r.stage === 'planning')).toBe(true);
  });

  it('narrates the mark in the ▸ paqad voice (ledger writes are never silent)', async () => {
    const startLines = await run('start', 'planning');
    expect(startLines.some((line) => line.startsWith('**▸ paqad** · '))).toBe(true);

    const endLines = await run('end', 'planning');
    expect(endLines.some((line) => line.includes('"recorded":true'))).toBe(true);
    expect(endLines.some((line) => line.includes('evidence recorded'))).toBe(false);
  });

  it('rejects an unknown stage with exit code 1 and no ledger row', async () => {
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((line: string) => {
      errors.push(String(line));
    });
    await run('start', 'bogus');
    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toContain('unknown stage');
    expect(rows()).toHaveLength(0);
  });

  it('stamps agent_id from SE_AGENT_ID on a stage_start, and none without it', async () => {
    vi.stubEnv('SE_AGENT_ID', 'agent-p1');
    await run('start', 'planning');
    await run('end', 'planning');
    vi.stubEnv('SE_AGENT_ID', '  ');
    await run('start', 'specification');
    vi.unstubAllEnvs();
    const starts = rows().filter((r) => r.kind === 'stage_start');
    expect(starts.find((r) => r.stage === 'planning')?.agent_id).toBe('agent-p1');
    expect(starts.find((r) => r.stage === 'specification')).not.toHaveProperty('agent_id');
    expect(rows().find((r) => r.kind === 'stage_end')).not.toHaveProperty('agent_id');
  });

  it('rejects an unknown phase with exit code 1', async () => {
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((line: string) => {
      errors.push(String(line));
    });
    await run('begin', 'planning');
    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toContain("use 'start', 'end', 'settings' or 'brief'");
  });

  it('a --title on start opens a fresh named feature', async () => {
    await run('start', 'planning', '--title', 'Route first workflows', '--issue', '339');
    const active = currentFeature(root, SES)!;
    expect(active.startsWith('339-route-first-workflows-')).toBe(true);
    expect(resolveFeatureRef(root, SES, '339')).toBe(active);
    expect(rows().some((r) => r.kind === 'stage_start' && r.stage === 'planning')).toBe(true);
  });

  it('records an out-of-order boundary instead of rejecting it', async () => {
    await run('start', 'review');
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((line: string) => {
      errors.push(String(line));
    });
    process.exitCode = 0;
    await run('start', 'planning');
    expect(process.exitCode).toBe(0);
    expect(errors).toEqual([]);
    expect(rows().some((r) => r.kind === 'stage_start' && r.stage === 'planning')).toBe(true);
  });

  describe('rigid bundle artifact for planning/specification', () => {
    function writeBundleArtifact(file: 'plan' | 'specification'): string {
      const dir = currentFeature(root, SES)!;
      const rel = featureFilePath(dir, file);
      mkdirSync(join(root, dirname(rel)), { recursive: true });
      writeFileSync(join(root, rel), '{"real":true}\n');
      return rel;
    }

    it('hashes the bundle plan.json on a planning end (the accepted artifact)', async () => {
      await run('start', 'planning');
      const planRel = writeBundleArtifact('plan');
      await run('end', 'planning', '--artifact', planRel);
      const end = rows().find((r) => r.kind === 'stage_end' && r.stage === 'planning');
      expect(end?.artifact_digest).toMatch(/^sha256-/);
      expect(end?.artifact_paths).toEqual([planRel]);
    });

    it('hashes the bundle specification.json on a specification end (the accepted artifact)', async () => {
      await run('start', 'planning');
      const specRel = writeBundleArtifact('specification');
      await run('end', 'specification', '--artifact', specRel);
      const end = rows().find((r) => r.kind === 'stage_end' && r.stage === 'specification');
      expect(end?.artifact_digest).toMatch(/^sha256-/);
    });

    it('drops a non-bundle planning artifact (records inconclusive) and names `plan compile`', async () => {
      const errors: string[] = [];
      vi.spyOn(console, 'error').mockImplementation((line: string) => {
        errors.push(String(line));
      });
      await run('start', 'planning');
      writeFileSync(join(root, 'notes.md'), '# hand-written plan\n');
      const out = await run('end', 'planning', '--artifact', 'notes.md');
      const end = rows().find((r) => r.kind === 'stage_end' && r.stage === 'planning');
      expect(end).toBeDefined();
      expect(end?.artifact_digest ?? null).toBeNull();
      expect(out.some((line) => line.includes('"recorded":true'))).toBe(true);
      expect(process.exitCode).toBeUndefined();
      expect(errors.join('\n')).toContain('paqad-ai plan compile');
      expect(errors.join('\n')).toContain('inconclusive');
    });

    it('drops a non-bundle specification artifact and names `spec freeze`', async () => {
      const errors: string[] = [];
      vi.spyOn(console, 'error').mockImplementation((line: string) => {
        errors.push(String(line));
      });
      await run('start', 'planning');
      writeFileSync(join(root, 'draft-spec.md'), '# hand-written spec\n');
      await run('end', 'specification', '--artifact', 'draft-spec.md');
      const end = rows().find((r) => r.kind === 'stage_end' && r.stage === 'specification');
      expect(end?.artifact_digest ?? null).toBeNull();
      expect(errors.join('\n')).toContain('paqad-ai spec freeze');
    });
  });

  describe('session-id resolution (block-forward parity)', () => {
    async function runNoSession(...args: string[]): Promise<void> {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      await createStageCommand().parseAsync([...args, '--project-root', root], { from: 'user' });
    }

    function rowsFor(session: string) {
      const dir = currentFeature(root, session);
      return dir ? readFeatureStageUnit(root, dir) : [];
    }

    function ownActive(session: string): string | null {
      return readSessionControl(root, session).active;
    }

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('falls back to SE_SESSION when --session is absent', async () => {
      vi.stubEnv('SE_SESSION', 'ses_from_se');
      vi.stubEnv('CLAUDE_SESSION_ID', 'ses_from_claude');
      await runNoSession('start', 'planning');
      expect(rowsFor('ses_from_se').some((r) => r.kind === 'stage_start')).toBe(true);
      expect(ownActive('ses_from_claude')).toBeNull();
    });

    it('falls back to CLAUDE_SESSION_ID when --session and SE_SESSION are both absent', async () => {
      vi.stubEnv('SE_SESSION', undefined);
      vi.stubEnv('CLAUDE_SESSION_ID', 'ses_from_claude');
      await runNoSession('start', 'planning');
      expect(rowsFor('ses_from_claude').some((r) => r.kind === 'stage_start')).toBe(true);
    });

    it('resolves the cached/minted local id when nothing is supplied (no throw)', async () => {
      vi.stubEnv('SE_SESSION', undefined);
      vi.stubEnv('CLAUDE_SESSION_ID', undefined);
      await runNoSession('start', 'planning');
      expect(process.exitCode).toBeUndefined();
    });

    it('stamps session_source env when the flag or environment supplied the id', async () => {
      await run('start', 'planning');
      expect(rows().find((r) => r.kind === 'stage_start')).toMatchObject({ session_source: 'env' });
    });

    it('stamps session_source env when only SE_SESSION supplied the id', async () => {
      vi.stubEnv('SE_SESSION', 'ses_from_se');
      await runNoSession('start', 'planning');
      expect(rowsFor('ses_from_se').find((r) => r.kind === 'stage_start')).toMatchObject({
        session_source: 'env',
      });
    });

    it('AC-11: a start resolved from the cache file is stamped cache and is not an edit this turn', async () => {
      vi.stubEnv('SE_SESSION', undefined);
      vi.stubEnv('CLAUDE_SESSION_ID', undefined);
      resolveSessionId(root, SES);
      writeWorkflowState(root, SES, {
        active: { workflow: 'project-question' },
        paused: [],
        turn_started_at: '2000-01-01T00:00:00.000Z',
      });

      await runNoSession('start', 'planning');

      const start = rowsFor(SES).find((r) => r.kind === 'stage_start');
      expect(start).toMatchObject({ session_source: 'cache' });
      expect(classifyCompletionEnforcement(root, SES)).toMatchObject({
        enforce: false,
        reason: 'detour',
      });

      await run('start', 'planning');
      expect(classifyCompletionEnforcement(root, SES).reason).toBe('edited-this-turn');
    });
  });

  describe('stage brief', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    function openChange(): string {
      return openFeatureChange(root, SES, {
        adapter: 'claude-code',
        title: 'Stage brief verb',
        issue: '1',
        ulid: '01JABCDEFGHJKMNPQRSTVWXYZ1',
      });
    }

    function captureErrors(): string[] {
      const errors: string[] = [];
      vi.spyOn(console, 'error').mockImplementation((line: string) => {
        errors.push(String(line));
      });
      return errors;
    }

    it.each(['specification', 'development'])(
      'prints exactly buildStageBrief for %s, the active change and the open agent id',
      async (stage) => {
        vi.stubEnv('SE_AGENT_ID', undefined);
        const dir = openChange();
        appendFeatureStageRow(root, SES, dir, {
          kind: STAGE_AGENT_KIND,
          event_status: 'started',
          stage: 'planning',
          agent: 'paqad-planning',
          agent_id: 'agent-plan-1',
          tokens_used: 0,
          tokens_not_recarried: 0,
          estimate: true,
        });
        const printed = (await run('brief', stage)).join('\n');
        expect(printed).toBe(
          buildStageBrief(stage, root, SES, { agentId: 'agent-plan-1', resumed: true }),
        );
        expect(printed).toContain(
          `SE_SESSION=${SES} SE_AGENT_ID=agent-plan-1 paqad-ai stage start ${stage}`,
        );
        expect(printed).toContain('resumed for the same feature-development change');
        expect(printed).not.toContain('added this stage brief to your context when you started');
        expect(process.exitCode).toBeUndefined();
      },
    );

    it('takes an explicit --agent-id, then SE_AGENT_ID, over the open row', async () => {
      const dir = openChange();
      appendFeatureStageRow(root, SES, dir, {
        kind: STAGE_AGENT_KIND,
        event_status: 'started',
        stage: 'development',
        agent_id: 'agent-row',
        tokens_used: 0,
        tokens_not_recarried: 0,
        estimate: true,
      });
      vi.stubEnv('SE_AGENT_ID', 'agent-env');
      expect((await run('brief', 'development', '--agent-id', 'agent-flag')).join('\n')).toContain(
        'SE_AGENT_ID=agent-flag paqad-ai',
      );
      vi.restoreAllMocks();
      expect((await run('brief', 'development')).join('\n')).toContain(
        'SE_AGENT_ID=agent-env paqad-ai',
      );
    });

    it('prints no agent id when none is known or the open row has ended', async () => {
      vi.stubEnv('SE_AGENT_ID', undefined);
      const dir = openChange();
      appendFeatureStageRow(root, SES, dir, {
        kind: STAGE_AGENT_KIND,
        event_status: 'started',
        stage: 'planning',
        agent_id: 'agent-done',
        tokens_used: 0,
        tokens_not_recarried: 0,
        estimate: true,
      });
      appendFeatureStageRow(root, SES, dir, {
        kind: STAGE_AGENT_KIND,
        event_status: 'completed',
        stage: 'planning',
        agent_id: 'agent-done',
        tokens_used: 0,
        tokens_not_recarried: 0,
        estimate: true,
      });
      const printed = (await run('brief', 'specification')).join('\n');
      expect(printed).toBe(buildStageBrief('specification', root, SES, { resumed: true }));
      expect(printed).not.toContain('SE_AGENT_ID');
    });

    it('exits non-zero with a plain message and no brief for an unknown or missing stage', async () => {
      openChange();
      const errors = captureErrors();
      expect(await run('brief', 'bogus')).toEqual([]);
      expect(process.exitCode).toBe(1);
      expect(errors.join('\n')).toContain('name the stage to brief');
      expect(errors.join('\n')).toContain('"bogus"');
      process.exitCode = undefined;
      vi.restoreAllMocks();
      captureErrors();
      expect(await run('brief')).toEqual([]);
      expect(process.exitCode).toBe(1);
    });

    it('exits non-zero with a plain message and no brief when the session has no active change', async () => {
      const errors = captureErrors();
      expect(await run('brief', 'development')).toEqual([]);
      expect(process.exitCode).toBe(1);
      expect(errors.join('\n')).toContain('no active change');
    });
  });

  describe('stage settings', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    function settingsFile(session: string): string {
      return join(root, '.paqad/session/stage-settings.d', `${session}.json`);
    }

    it('prints the per-stage effort, model and pass advice as JSON and records the settings', async () => {
      mkdirSync(join(root, '.paqad/configs'), { recursive: true });
      writeFileSync(
        join(root, '.paqad/configs/.config.models'),
        'stage_model_checks=haiku\nstage_effort_review=medium\nstage_effort_planning=inherit\n',
        'utf8',
      );
      const printed = JSON.parse((await run('settings')).join('\n'));
      expect(Object.keys(printed)).toHaveLength(6);
      for (const entry of Object.values(printed)) {
        expect(typeof (entry as { pass: unknown }).pass).toBe('string');
      }
      expect(printed.checks).toEqual({
        effort: 'low',
        model: 'haiku',
        pass: 'on its Agent call, pass effort low and model haiku',
      });
      expect(printed.review).toEqual({
        effort: 'medium',
        model: 'inherit',
        pass: 'on its Agent call, pass effort medium',
      });
      expect(printed.planning).toEqual({
        effort: 'inherit',
        model: 'inherit',
        pass: 'on its Agent call, pass your own current effort level as effort, because its agent file defaults to high effort',
      });
      expect(printed.development.pass).toBe(
        "pass nothing on its Agent call, so it runs at the session's own effort and model",
      );
      const recorded = JSON.parse(readFileSync(settingsFile(SES), 'utf8'));
      expect(recorded.checks).toEqual({ effort: 'low', model: 'haiku' });
      expect(recorded.review).toEqual({ effort: 'medium', model: 'inherit' });
      expect(recorded.planning).toEqual({ effort: 'inherit', model: 'inherit' });
      expect(process.exitCode).toBeUndefined();
    });

    it('records under SE_SESSION when no --session is given', async () => {
      vi.stubEnv('SE_SESSION', 'ses_orch_env');
      vi.spyOn(console, 'log').mockImplementation(() => {});
      await createStageCommand().parseAsync(['settings', '--project-root', root], {
        from: 'user',
      });
      expect(existsSync(settingsFile('ses_orch_env'))).toBe(true);
    });

    it('falls back to the resolved local session when nothing names one', async () => {
      vi.stubEnv('SE_SESSION', undefined);
      vi.stubEnv('CLAUDE_SESSION_ID', undefined);
      vi.spyOn(console, 'log').mockImplementation(() => {});
      await createStageCommand().parseAsync(['settings', '--project-root', root], {
        from: 'user',
      });
      expect(existsSync(settingsFile(resolveSessionId(root, null)))).toBe(true);
    });

    it('writes nothing and exits non-zero for an unsafe SE_SESSION', async () => {
      vi.stubEnv('SE_SESSION', 'x; rm -rf ~');
      const errors: string[] = [];
      vi.spyOn(console, 'error').mockImplementation((line: string) => {
        errors.push(String(line));
      });
      await createStageCommand().parseAsync(['settings', '--project-root', root], {
        from: 'user',
      });
      expect(process.exitCode).toBe(1);
      expect(errors.join('\n')).toContain('unsafe session id');
      expect(existsSync(join(root, '.paqad/session/stage-settings.d'))).toBe(false);
    });

    it('still asks for a stage on start and end', async () => {
      const errors: string[] = [];
      vi.spyOn(console, 'error').mockImplementation((line: string) => {
        errors.push(String(line));
      });
      await run('start');
      expect(process.exitCode).toBe(1);
      expect(errors.join('\n')).toContain('name the stage to start');
    });
  });
  describe('the forward-only raise after a plan resize', () => {
    function git(...args: string[]): void {
      execFileSync('git', args, { cwd: root, stdio: ['ignore', 'ignore', 'ignore'] });
    }

    function resizedChange(): string {
      git('init', '-q', '-b', 'feat/small');
      git('config', 'user.email', 't@t.dev');
      git('config', 'user.name', 'Test');
      writeFileSync(join(root, '.gitignore'), '.paqad/\n');
      writeFileSync(join(root, 'a.txt'), 'a');
      git('add', '-A');
      git('commit', '-q', '-m', 'chore: base');
      const sid = resolveSessionId(root, SES);
      const dir = openFeatureChange(root, sid, {
        adapter: 'claude-code',
        title: 'small change',
        lane: 'full',
      });
      writePendingImpact(root, sid, { database_impact: 'none', api_impact: 'none' });
      planLaneResize({
        projectRoot: root,
        sessionId: sid,
        dirName: dir,
        steps: [{ id: 'S1', description: 'edit', files: ['src/a.ts'] }],
        changedFiles: [],
        changesKnown: true,
      });
      expect(readFeatureRecord(root, dir)?.lane).toBe('graduated');
      return dir;
    }

    it('raises the lane to full once when the change grows past 8 files', async () => {
      const dir = resizedChange();
      mkdirSync(join(root, 'src'), { recursive: true });
      for (let i = 0; i < 11; i += 1) writeFileSync(join(root, `src/f${i}.ts`), 'x');

      const lines = await run('start', 'review');

      expect(lines).toContain(
        '**▸ paqad** · lane raised to full from graduated: the change now touches 11 files',
      );
      expect(JSON.parse(lines.at(-1)!).lane_raised).toMatchObject({ from: 'graduated', files: 11 });
      const record = readFeatureRecord(root, dir)!;
      expect(record).toMatchObject({ lane: 'full', lane_source: 'plan' });
      const raisedAt = record.lane_raised!.at;
      const review = readFeatureStageUnit(root, dir).at(-1)!;
      expect(review).toMatchObject({ kind: 'stage_start', stage: 'review' });
      expect(Date.parse(String(review.recorded_at))).toBeGreaterThanOrEqual(Date.parse(raisedAt));

      const again = await run('start', 'checks');
      expect(again.some((line) => line.includes('lane raised'))).toBe(false);
      expect(readFeatureRecord(root, dir)?.lane_raised?.at).toBe(raisedAt);
    });

    it('keeps graduated while the change stays small', async () => {
      const dir = resizedChange();
      const lines = await run('start', 'specification');
      expect(lines.some((line) => line.includes('lane raised'))).toBe(false);
      expect(readFeatureRecord(root, dir)?.lane).toBe('graduated');
    });
  });

  describe('a stage mark with no open change', () => {
    function git(...args: string[]): void {
      execFileSync('git', args, { cwd: root, stdio: ['ignore', 'ignore', 'ignore'] });
    }

    function onBranch(branch: string): void {
      git('init', '-q', '-b', branch);
      git('config', 'user.email', 't@t.dev');
      git('config', 'user.name', 'Test');
      writeFileSync(join(root, 'a.txt'), 'a');
      git('add', '-A');
      git('commit', '-q', '-m', 'chore: base');
    }

    function closedChange(sessionId: string, lane: 'fast' | 'full'): string {
      const sid = resolveSessionId(root, sessionId);
      const dir = openFeatureChange(root, sid, {
        adapter: 'claude-code',
        title: 'earlier work',
        lane,
      });
      closeActiveFeature(root, sid);
      return dir;
    }

    it('AC-4: reattaches this session’s closed change on the branch with its lane', async () => {
      onBranch('fix/x');
      const dir = closedChange(SES, 'fast');

      await run('start', 'review');

      expect(listFeatureDirs(root)).toEqual([dir]);
      expect(currentFeature(root, resolveSessionId(root, SES))).toBe(dir);
      expect(readFeatureRecord(root, dir)?.lane).toBe('fast');
      const unit = readFeatureStageUnit(root, dir);
      expect(unit.filter((row) => row.kind === 'open')).toHaveLength(2);
      expect(unit.at(-1)).toMatchObject({ kind: 'stage_start', stage: 'review' });
    });

    it('AC-25: marking again after the close never shows a second untitled change', async () => {
      onBranch('fix/x');
      const dir = closedChange(SES, 'fast');

      await run('start', 'checks');
      await run('end', 'checks');
      closeActiveFeature(root, resolveSessionId(root, SES));
      await run('start', 'checks');

      expect(listFeatureDirs(root)).toEqual([dir]);
      expect(readFeatureRecord(root, dir)?.lane).toBe('fast');
    });

    it('AC-24: does not adopt a change from another branch and mints with the session lane', async () => {
      onBranch('fix/other');
      const earlier = closedChange(SES, 'fast');
      git('checkout', '-q', '-b', 'fix/x');
      setLane(root, resolveSessionId(root, SES), 'graduated');

      await run('start', 'development');

      const minted = currentFeature(root, resolveSessionId(root, SES));
      expect(minted).not.toBeNull();
      expect(minted).not.toBe(earlier);
      expect(readFeatureRecord(root, minted!)?.lane).toBe('graduated');
    });

    it('AC-24: does not adopt another session’s change and mints with the pending lane', async () => {
      onBranch('fix/x');
      const foreign = closedChange('ses_someone_else', 'fast');
      writePendingLane(root, resolveSessionId(root, SES), 'full');

      await run('start', 'development');

      const minted = currentFeature(root, resolveSessionId(root, SES));
      expect(minted).not.toBe(foreign);
      expect(readFeatureRecord(root, minted!)?.lane).toBe('full');
      expect(readFeatureStageUnit(root, foreign).filter((row) => row.kind === 'open')).toHaveLength(
        1,
      );
    });

    it('AC-24: a session with no change of its own mints with the session control lane', async () => {
      onBranch('fix/x');
      setLane(root, resolveSessionId(root, SES), 'fast');

      await run('start', 'planning');

      const minted = currentFeature(root, resolveSessionId(root, SES));
      expect(readFeatureRecord(root, minted!)?.lane).toBe('fast');
    });
  });
});
