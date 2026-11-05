import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createStageCommand } from '@/cli/commands/stage.js';
import { featureFilePath } from '@/feature-evidence/paths.js';
import {
  appendFeatureStageRow,
  openFeatureChange,
  readFeatureStageUnit,
} from '@/feature-evidence/stage-ledger.js';

const SES = 'ses_stage_paths';
const ULID = '01JABCDEFGHJKMNPQRSTVWXY50';

describe('paqad-ai stage, in process', () => {
  let root: string;
  let out: string[];
  let err: string[];

  beforeEach(() => {
    vi.stubEnv('SE_AGENT_ID', undefined);
    vi.stubEnv('SE_SESSION', undefined);
    vi.stubEnv('CLAUDE_SESSION_ID', undefined);
    vi.stubEnv('PAQAD_STAGE_AGENT', undefined);
    root = mkdtempSync(join(tmpdir(), 'paqad-stage-paths-'));
    mkdirSync(join(root, '.paqad'), { recursive: true });
    out = [];
    err = [];
    vi.spyOn(console, 'log').mockImplementation((line: string) => void out.push(String(line)));
    vi.spyOn(console, 'error').mockImplementation((line: string) => void err.push(String(line)));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    process.exitCode = undefined;
    rmSync(root, { recursive: true, force: true });
  });

  const run = async (...args: string[]) => {
    await createStageCommand().parseAsync([...args, '--project-root', root, '--session', SES], {
      from: 'user',
    });
  };
  const open = (lane: 'full' | 'fast' = 'full', adapter = 'claude-code') =>
    openFeatureChange(root, SES, {
      adapter,
      title: 'Paths',
      issue: '1',
      ulid: ULID,
      lane,
    });
  const blockedReview = (dir: string) =>
    appendFeatureStageRow(root, SES, dir, {
      kind: 'stage-agent',
      stage: 'review',
      agent_id: 'a1',
      event_status: 'completed',
      report_status: 'BLOCKED',
      report_stated: true,
      report_source: 'text',
      reason: 'stuck',
      tokens_used: 0,
      tokens_not_recarried: 0,
      estimate: true,
    });

  describe('begin', () => {
    it('prints one JSON failure for a stage it does not know', async () => {
      await run('begin', 'nonsense');
      expect(process.exitCode).toBe(1);
      expect(JSON.parse(out[0]!)).toMatchObject({
        stage: 'nonsense',
        failed_step: 'stage start',
      });
      expect(out[0]).toContain('name the stage to begin');
    });

    it('prints that failure with an empty stage when none was named', async () => {
      await run('begin');
      expect(process.exitCode).toBe(1);
      expect(JSON.parse(out[0]!)).toMatchObject({ stage: '', failed_step: 'stage start' });
    });

    it('prints an already-open stage with no second start', async () => {
      const dir = open();
      appendFeatureStageRow(root, SES, dir, { kind: 'stage_start', stage: 'planning' });
      await run('begin', 'planning');
      expect(process.exitCode).toBe(0);
      expect(JSON.parse(out[0]!)).toMatchObject({ stage: 'planning', started: false });
    });

    it('prints the refusal as JSON and exits 1 past an unfinished stage', async () => {
      blockedReview(open());
      await run('begin', 'checks');
      expect(process.exitCode).toBe(1);
      expect(JSON.parse(out[0]!).error).toContain('checks cannot start');
    });

    it('takes the session from the environment when no flag names it', async () => {
      const dir = open();
      appendFeatureStageRow(root, SES, dir, { kind: 'stage_start', stage: 'planning' });
      vi.stubEnv('SE_SESSION', SES);
      await createStageCommand().parseAsync(['begin', 'planning', '--project-root', root], {
        from: 'user',
      });
      expect(JSON.parse(out[0]!)).toMatchObject({ stage: 'planning', started: false });
    });
  });

  describe('report', () => {
    it('asks for the agent id when none was named', async () => {
      await run('report');
      expect(process.exitCode).toBe(1);
      expect(JSON.parse(out[0]!)).toMatchObject({
        agent_id: '',
        report_status: 'UNKNOWN',
        reason: 'name the agent id to report on',
      });
    });

    it('reports an agent no row names, exiting 1', async () => {
      open();
      await run('report', 'ghost');
      expect(process.exitCode).toBe(1);
      expect(JSON.parse(out[0]!)).toMatchObject({
        agent_id: 'ghost',
        reason: 'no stage row names agent ghost',
      });
    });

    it('reports an agent when no change is active as that same unknown', async () => {
      await run('report', 'ghost');
      expect(process.exitCode).toBe(1);
      expect(JSON.parse(out[0]!).reason).toContain('no stage row names agent ghost');
    });

    it('prints the report of a known agent, exiting clean', async () => {
      blockedReview(open());
      await run('report', 'a1');
      expect(process.exitCode).toBeUndefined();
      expect(JSON.parse(out[0]!)).toMatchObject({
        agent_id: 'a1',
        stage: 'review',
        report_status: 'BLOCKED',
        reason: 'stuck',
      });
    });
  });

  describe('repair', () => {
    const breakChain = (dir: string): number => {
      appendFeatureStageRow(root, SES, dir, { kind: 'stage_start', stage: 'planning' });
      appendFeatureStageRow(root, SES, dir, { kind: 'stage_end', stage: 'planning' });
      const path = join(root, featureFilePath(dir, 'stageEvidence'));
      const lines = readFileSync(path, 'utf8').trim().split('\n');
      const last = JSON.parse(lines.at(-1)!) as Record<string, unknown>;
      last.prev_hash = 'f'.repeat(64);
      lines[lines.length - 1] = JSON.stringify(last);
      writeFileSync(path, `${lines.join('\n')}\n`);
      return lines.length;
    };

    it('refuses a stage agent', async () => {
      vi.stubEnv('SE_AGENT_ID', 'a1');
      await run('repair', '1', '--reason', 'r');
      expect(process.exitCode).toBe(1);
      expect(err[0]).toContain('a stage agent cannot repair the ledger');
    });

    it.each([
      ['a row that is no number', ['abc', '--reason', 'r']],
      ['row zero', ['0', '--reason', 'r']],
      ['no reason', ['1']],
      ['a blank reason', ['1', '--reason', '   ']],
      ['no row', ['--reason', 'r']],
    ])('prints the usage and exits 2 for %s', async (_name, args) => {
      await run('repair', ...args);
      expect(process.exitCode).toBe(2);
      expect(err[0]).toContain('usage: paqad-ai stage repair');
    });

    it('says there is nothing to repair with no active change', async () => {
      await run('repair', '1', '--reason', 'r');
      expect(process.exitCode).toBe(1);
      expect(err[0]).toContain('no change is active');
    });

    it('declines a row that is not a break, naming that there are none', async () => {
      const dir = open();
      appendFeatureStageRow(root, SES, dir, { kind: 'stage_start', stage: 'planning' });
      await run('repair', '1', '--reason', 'r');
      expect(process.exitCode).toBe(1);
      expect(err[0]).toContain('the ledger has no chain break');
    });

    it('declines the wrong row, naming the real break', async () => {
      const dir = open();
      const broken = breakChain(dir);
      await run('repair', '1', '--reason', 'r');
      expect(process.exitCode).toBe(1);
      expect(err[0]).toContain(`the breaks are at rows ${broken}`);
    });

    it('records a repair of the real break under the orchestrator with no terminal', async () => {
      const dir = open();
      const broken = breakChain(dir);
      await run('repair', String(broken), '--reason', 'a torn write');
      expect(process.exitCode).toBeUndefined();
      expect(out[0]).toContain(`recorded a repair for row ${broken}: a torn write`);
      const repair = readFeatureStageUnit(root, dir).find((row) => row.kind === 'record-repair');
      expect(repair).toMatchObject({ repairs_row: broken, reason: 'a torn write' });
    });
  });

  describe('brief', () => {
    it('asks for a stage when none was named, without quoting one', async () => {
      await run('brief');
      expect(process.exitCode).toBe(1);
      expect(err[0]).toContain('name the stage to brief');
      expect(err[0]).not.toContain('(got');
    });

    it('quotes the stage it does not know', async () => {
      await run('brief', 'nonsense');
      expect(process.exitCode).toBe(1);
      expect(err[0]).toContain('(got "nonsense")');
    });

    it('fails plainly with no active change', async () => {
      await run('brief', 'review');
      expect(process.exitCode).toBe(1);
      expect(err[0]).toContain('could not build the review stage brief: no active change');
    });

    it('prints the brief, the recipe and the content, recording no injection inline', async () => {
      const dir = open();
      await run('brief', 'review');
      expect(process.exitCode).toBeUndefined();
      expect(out[0]).toContain('## Your recipe');
      expect(out[0]).toContain('## Request');
      expect(readFeatureStageUnit(root, dir).some((row) => row.kind === 'recipe-injected')).toBe(
        false,
      );
    });

    it('records the injection for a dispatched agent', async () => {
      const dir = open();
      vi.stubEnv('SE_AGENT_ID', 'a-brief');
      await run('brief', 'review');
      expect(
        readFeatureStageUnit(root, dir).filter((row) => row.agent_id === 'a-brief').length,
      ).toBeGreaterThan(0);
    });

    it('records no injection for a Codex change, which its own host injects', async () => {
      const dir = open('full', 'codex-cli');
      const before = readFeatureStageUnit(root, dir).length;
      vi.stubEnv('SE_AGENT_ID', 'a-brief');
      await run('brief', 'review');
      expect(readFeatureStageUnit(root, dir)).toHaveLength(before);
    });
  });

  describe('start and end guards', () => {
    it('refuses a start past an unfinished stage and writes no row', async () => {
      const dir = open();
      blockedReview(dir);
      await run('start', 'checks');
      expect(process.exitCode).toBe(1);
      expect(err[0]).toContain('checks cannot start: review is unfinished (BLOCKED)');
      expect(
        readFeatureStageUnit(root, dir).some(
          (row) => row.kind === 'stage_start' && row.stage === 'checks',
        ),
      ).toBe(false);
    });

    it('lets a titled start open new work past an unfinished stage', async () => {
      blockedReview(open());
      await run('start', 'planning', '--title', 'Other work');
      expect(process.exitCode).toBeUndefined();
    });

    it('warns when a rigid stage is ended against a file that is not its artifact', async () => {
      const dir = open();
      appendFeatureStageRow(root, SES, dir, { kind: 'stage_start', stage: 'review' });
      const elsewhere = join(root, 'not-the-review.json');
      writeFileSync(elsewhere, '{}');
      await run('end', 'review', '--artifact', elsewhere);
      expect(err.join('\n')).toContain("that file isn't review's bundle artifact");
      expect(err.join('\n')).toContain('Recording review as inconclusive');
    });

    it('warns when a free-form stage names a file inside the bundle', async () => {
      const dir = open();
      appendFeatureStageRow(root, SES, dir, { kind: 'stage_start', stage: 'development' });
      const inside = join(root, featureFilePath(dir, 'plan'), '..', 'notes.md');
      writeFileSync(inside, 'notes');
      await run('end', 'development', '--artifact', inside);
      expect(err.join('\n')).toContain('a feature bundle holds only its rigid artifacts');
      expect(
        readFeatureStageUnit(root, dir).find(
          (row) => row.kind === 'stage_end' && row.stage === 'development',
        )?.artifact_paths ?? [],
      ).toEqual([]);
    });

    const devEnded = (dir: string) =>
      readFeatureStageUnit(root, dir).some(
        (row) => row.kind === 'stage_end' && row.stage === 'development',
      );
    const specFor = (dir: string) =>
      writeFileSync(
        join(root, featureFilePath(dir, 'specification')),
        JSON.stringify({ acceptance_criteria: [{ id: 'AC-1', statement: 'x' }] }),
      );
    const testFile = (text: string) => {
      mkdirSync(join(root, 'tests'), { recursive: true });
      writeFileSync(join(root, 'tests/a.test.ts'), text);
    };

    it('refuses a development end the AC map check fails for a dispatched agent', async () => {
      const dir = open();
      appendFeatureStageRow(root, SES, dir, {
        kind: 'stage_start',
        stage: 'development',
        agent_id: 'a-dev',
      });
      specFor(dir);
      testFile("it('has no id', () => {});\n");
      await run('end', 'development');
      expect(process.exitCode).toBe(1);
      expect(err[0]).toContain('development-recipe check found problems');
      expect(devEnded(dir)).toBe(false);
    });

    it('ends development once a test names the criterion, and records the script', async () => {
      const dir = open();
      appendFeatureStageRow(root, SES, dir, {
        kind: 'stage_start',
        stage: 'development',
        agent_id: 'a-dev',
      });
      specFor(dir);
      testFile("it('AC-1: works', () => {});\n");
      await run('end', 'development');
      expect(process.exitCode).toBeUndefined();
      expect(devEnded(dir)).toBe(true);
      expect(
        readFeatureStageUnit(root, dir).find((row) => row.kind === 'skill-used'),
      ).toMatchObject({
        recipe: 'development-recipe',
        script: 'check-ac-map.mjs',
        agent_id: 'a-dev',
      });
    });

    it('checks only the lines this change added when the change has a start point', async () => {
      const git = (...args: string[]) =>
        execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
          cwd: root,
          stdio: 'pipe',
        });
      git('init', '-q');
      testFile("it('AC-1: already here', () => {});\n");
      git('add', '.');
      git('commit', '-qm', 'base');
      const dir = open();
      appendFeatureStageRow(root, SES, dir, {
        kind: 'stage_start',
        stage: 'development',
        agent_id: 'a-dev',
      });
      specFor(dir);
      await run('end', 'development');
      expect(process.exitCode).toBe(1);
      expect(err[0]).toContain('development-recipe check found problems');
      expect(devEnded(dir)).toBe(false);
    });

    it('passes the docs it was told are fine to the stale docs check and records them', async () => {
      const dir = open();
      appendFeatureStageRow(root, SES, dir, { kind: 'stage_start', stage: 'documentation_sync' });
      await run('end', 'documentation_sync', '--stale-ok', 'docs/a.md');
      expect(process.exitCode).toBeUndefined();
      expect(
        readFeatureStageUnit(root, dir).find((row) => row.kind === 'skill-used'),
      ).toMatchObject({ recipe: 'documentation-sync-recipe', stale_ok: ['docs/a.md'] });
    });

    it('records a boundary when PAQAD_STAGE_AGENT is exported empty', async () => {
      const dir = open();
      vi.stubEnv('PAQAD_STAGE_AGENT', '');
      await run('start', 'planning');
      expect(process.exitCode).toBeUndefined();
      expect(err).toEqual([]);
      expect(
        readFeatureStageUnit(root, dir).some(
          (row) => row.kind === 'stage_start' && row.stage === 'planning',
        ),
      ).toBe(true);
    });

    it('ends development with nothing to check when the change has no spec', async () => {
      const dir = open();
      appendFeatureStageRow(root, SES, dir, { kind: 'stage_start', stage: 'development' });
      await run('end', 'development');
      expect(process.exitCode).toBeUndefined();
      expect(err).toEqual([]);
      expect(
        readFeatureStageUnit(root, dir).some(
          (row) => row.kind === 'stage_end' && row.stage === 'development',
        ),
      ).toBe(true);
    });

    it('ends any other stage with no recipe check at all', async () => {
      const dir = open();
      appendFeatureStageRow(root, SES, dir, { kind: 'stage_start', stage: 'planning' });
      await run('end', 'planning');
      expect(process.exitCode).toBeUndefined();
      expect(readFeatureStageUnit(root, dir).some((row) => row.kind === 'skill-used')).toBe(false);
    });
  });
});
