import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPlanCommand } from '@/cli/commands/plan.js';
import { createStageCommand } from '@/cli/commands/stage.js';
import { readFeatureRecord } from '@/feature-evidence/feature-record.js';
import {
  laneMayRise,
  raiseLaneForAuthoring,
  raiseLaneIfGrown,
} from '@/feature-evidence/lane-resize.js';
import { openFeatureChange, recordedLaneOrFull } from '@/feature-evidence/stage-ledger.js';
import { resolveSessionId } from '@/rag-ledger/session.js';
import { writePendingImpact } from '@/stage-evidence/pending-lane.js';
import { requiredPreCodeStages } from '@/stage-evidence/stages.js';

const scans = vi.hoisted(() => ({ count: 0 }));
vi.mock('@/pipeline/change-evidence.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/pipeline/change-evidence.js')>();
  return {
    ...actual,
    loadChangeEvidence: (...args: Parameters<typeof actual.loadChangeEvidence>) => {
      scans.count += 1;
      return actual.loadChangeEvidence(...args);
    },
  };
});

const SES = 'ses-authoring-raise';
const AT = '2026-10-31T12:00:00.000Z';
const now = () => new Date(AT);
const SKILL = '.claude/skills/processing-invoices/SKILL.md';
const RAISED_LINE =
  '**▸ paqad** · lane raised to graduated from fast: the change creates or edits a skill ' +
  '(.claude/skills/processing-invoices/SKILL.md), so the Skill Orchestrator sits at the High Table.';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-authoring-raise-'));
  mkdirSync(join(root, '.paqad'), { recursive: true });
  vi.stubEnv('PAQAD_SKILL_ORCHESTRATOR_ENABLED', undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  process.exitCode = undefined;
  rmSync(root, { recursive: true, force: true });
});

function change(lane: 'fast' | 'graduated' | 'full'): string {
  return openFeatureChange(root, resolveSessionId(root, SES), {
    adapter: 'claude-code',
    title: 'add invoice skill',
    lane,
  });
}

function raise(dir: string, plannedFiles: string[], changedFiles: string[] = []) {
  return raiseLaneForAuthoring({
    projectRoot: root,
    dirName: dir,
    plannedFiles,
    changedFiles,
    now,
  });
}

function turnOff(): void {
  writeFileSync(join(root, '.paqad', '.config'), 'skill_orchestrator_enabled=false\n');
}

describe('raiseLaneForAuthoring', () => {
  it('AC-34: raises a fast lane to graduated for a planned skill path and records why', () => {
    const dir = change('fast');
    const move = raise(dir, ['src/a.ts', SKILL]);
    expect(move).toEqual({
      from: 'fast',
      to: 'graduated',
      reason:
        'the change creates or edits a skill (.claude/skills/processing-invoices/SKILL.md), so ' +
        'the Skill Orchestrator sits at the High Table.',
      path: SKILL,
      at: AT,
    });
    const record = readFeatureRecord(root, dir)!;
    expect(record.lane).toBe('graduated');
    expect(record.lane_source).toBe('classifier');
    expect(record.lane_raised_for_authoring).toEqual(move);
  });

  it('raises for a skill path seen only in an edit, ignoring .paqad paths', () => {
    const dir = change('fast');
    expect(raise(dir, ['src/a.ts'], ['.paqad/x/SKILL.md'])).toBeNull();
    const move = raise(dir, ['src/a.ts'], ['.agents/skills/drafting-notes/references/a.md']);
    expect(move?.path).toBe('.agents/skills/drafting-notes/references/a.md');
  });

  it('raises at most once', () => {
    const dir = change('fast');
    expect(raise(dir, [SKILL])).not.toBeNull();
    expect(raise(dir, [SKILL])).toBeNull();
  });

  it('leaves graduated and full lanes untouched', () => {
    for (const lane of ['graduated', 'full'] as const) {
      const dir = change(lane);
      expect(raise(dir, [SKILL])).toBeNull();
      const record = readFeatureRecord(root, dir)!;
      expect(record.lane).toBe(lane);
      expect(record.lane_raised_for_authoring).toBeUndefined();
      rmSync(join(root, '.paqad'), { recursive: true, force: true });
      mkdirSync(join(root, '.paqad'), { recursive: true });
    }
  });

  it('does nothing without a skill path', () => {
    const dir = change('fast');
    expect(raise(dir, ['src/a.ts', '.claude/skills/README.md'])).toBeNull();
    expect(readFeatureRecord(root, dir)?.lane).toBe('fast');
  });

  it('AC-40: does nothing while skill_orchestrator_enabled=false', () => {
    turnOff();
    const dir = change('fast');
    expect(raise(dir, [SKILL])).toBeNull();
    expect(readFeatureRecord(root, dir)?.lane).toBe('fast');
  });

  it('AC-54: the existing raise to full still fires after an authoring raise', () => {
    const dir = change('fast');
    raise(dir, [SKILL]);
    expect(laneMayRise(root, dir)).toBe(true);
    const eleven = Array.from({ length: 11 }, (_, i) => `src/f${i}.ts`);
    const grown = raiseLaneIfGrown({
      projectRoot: root,
      dirName: dir,
      plannedFiles: [SKILL],
      changedFiles: eleven,
      now,
    });
    expect(grown).toMatchObject({ from: 'graduated', to: 'full', files: 11 });
    const record = readFeatureRecord(root, dir)!;
    expect(record.lane).toBe('full');
    expect(record.lane_raised_for_authoring?.to).toBe('graduated');
    expect(laneMayRise(root, dir)).toBe(false);
    expect(raise(dir, [SKILL])).toBeNull();
  });
});

describe('the raise at plan compile and at stage start', () => {
  function git(...args: string[]): void {
    execFileSync('git', args, { cwd: root, stdio: ['ignore', 'ignore', 'ignore'] });
  }

  function repo(): void {
    git('init', '-q', '-b', 'feat/skill');
    git('config', 'user.email', 't@t.dev');
    git('config', 'user.name', 'Test');
    writeFileSync(join(root, '.gitignore'), '.paqad/\nplan-input.json\n');
    writeFileSync(join(root, 'a.txt'), 'a');
    git('add', '-A');
    git('commit', '-q', '-m', 'chore: base');
  }

  function fastChange(): string {
    repo();
    const dir = change('fast');
    writePendingImpact(root, resolveSessionId(root, SES), {
      database_impact: 'none',
      api_impact: 'none',
    });
    return dir;
  }

  async function capture(action: () => Promise<unknown>): Promise<string[]> {
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((line: string) => {
      lines.push(String(line));
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await action();
    spy.mockRestore();
    return lines;
  }

  function compile(files: string[]): Promise<string[]> {
    const input = join(root, 'plan-input.json');
    writeFileSync(
      input,
      JSON.stringify({
        summary: 'add a skill',
        steps: [{ id: 's1', description: 'add the skill', files }],
        reuse: {
          consulted: [{ source: 'grep', query: 'x', hits: 0 }],
          reusing: [],
          new_constructs: [],
        },
      }),
    );
    return capture(() =>
      createPlanCommand().parseAsync(['compile', input, '--project-root', root, '--session', SES], {
        from: 'user',
      }),
    );
  }

  function stageStart(stage: string): Promise<string[]> {
    return capture(() =>
      createStageCommand().parseAsync(['start', stage, '--project-root', root, '--session', SES], {
        from: 'user',
      }),
    );
  }

  it('AC-34, AC-40: plan compile raises and prints once, a later stage start stays quiet', async () => {
    const dir = fastChange();
    const lines = await compile([SKILL]);
    expect(lines.filter((line) => line.includes('lane raised'))).toEqual([RAISED_LINE]);
    expect(JSON.parse(lines.at(-1)!).lane_raised_for_authoring).toMatchObject({
      from: 'fast',
      to: 'graduated',
      path: SKILL,
    });
    expect(readFeatureRecord(root, dir)?.lane).toBe('graduated');

    const again = await compile([SKILL]);
    expect(again.some((line) => line.includes('lane raised'))).toBe(false);
    const start = await stageStart('specification');
    expect(start.some((line) => line.includes('lane raised'))).toBe(false);
  });

  it('AC-45: a first skill path seen only in an edit raises at the next stage start, once', async () => {
    const dir = fastChange();
    await compile(['src/a.ts']);
    expect(readFeatureRecord(root, dir)?.lane).toBe('fast');
    const sid = resolveSessionId(root, SES);
    expect(requiredPreCodeStages(recordedLaneOrFull(root, sid, dir))).not.toContain(
      'specification',
    );
    mkdirSync(join(root, '.claude/skills/processing-invoices'), { recursive: true });
    writeFileSync(join(root, SKILL), '---\nname: processing-invoices\n---\n');

    const lines = await stageStart('development');
    expect(lines.filter((line) => line.includes('lane raised'))).toEqual([RAISED_LINE]);
    expect(JSON.parse(lines.at(-1)!).lane_raised_for_authoring?.path).toBe(SKILL);
    expect(readFeatureRecord(root, dir)?.lane).toBe('graduated');
    expect(requiredPreCodeStages(recordedLaneOrFull(root, sid, dir))).toContain('specification');

    const again = await stageStart('development');
    expect(again.some((line) => line.includes('lane raised'))).toBe(false);
  });

  it('AC-40: with skill_orchestrator_enabled=false neither path raises', async () => {
    const dir = fastChange();
    turnOff();
    const lines = await compile([SKILL]);
    expect(lines.some((line) => line.includes('lane raised'))).toBe(false);
    const start = await stageStart('development');
    expect(start.some((line) => line.includes('lane raised'))).toBe(false);
    expect(readFeatureRecord(root, dir)?.lane).toBe('fast');
  });

  it('a fast-lane stage start with skill_orchestrator_enabled=false does not scan git', async () => {
    fastChange();
    turnOff();
    scans.count = 0;
    await stageStart('development');
    expect(scans.count).toBe(0);
  });
});
