import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

import {
  STAGE_BASELINE_TURNS,
  STAGE_TURN_BUDGET,
  buildBenchmark,
  measureTranscript,
} from '../../../scripts/stage-benchmark.mjs';
import { listWorkflows, scanConsumers } from '../../../scripts/skill-consumer-scan.mjs';
import { MANDATORY_STAGE_AGENTS } from '@/stage-isolation/stage-agents.js';

const roots: string[] = [];

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'paqad-benchmark-'));
  roots.push(dir);
  return dir;
}

const turn = (id: string, at: string, tokens = 10) =>
  JSON.stringify({
    timestamp: at,
    message: { id, role: 'assistant', usage: { input_tokens: tokens, output_tokens: 1 } },
  });

describe('stage-benchmark.mjs', () => {
  it('counts one turn per message id and sums the tokens once', () => {
    const text = [
      turn('m1', '2026-11-04T10:00:00Z'),
      turn('m1', '2026-11-04T10:00:01Z'),
      turn('m2', '2026-11-04T10:00:03Z', 20),
      '{"cut',
    ].join('\n');
    expect(measureTranscript(text)).toEqual({ turns: 2, tokens_used: 32, duration_ms: 3000 });
  });

  it('marks the output as a sample, with each measure and the baseline', () => {
    const dir = tempDir();
    const transcript = join(dir, 't.jsonl');
    writeFileSync(transcript, turn('m1', '2026-11-04T10:00:00Z'));
    const bundle = join(dir, 'bundle');
    mkdirSync(bundle);
    writeFileSync(join(bundle, 'review.json'), '{}');
    writeFileSync(
      join(bundle, 'stage-evidence.jsonl'),
      `${JSON.stringify({ kind: 'skill-used', stage: 'review' })}\n`,
    );
    const benchmark = buildBenchmark([{ stage: 'review', arm: 'b', transcript, bundle }]);
    expect(benchmark.sample).toBe(true);
    expect(benchmark.runs[0]).toMatchObject({
      stage: 'review',
      arm: 'b',
      turns: 1,
      artifact_pass: true,
      skill_used: true,
      within_budget: true,
      baseline_turns: 44,
    });
    expect(benchmark.over_budget).toEqual([]);
  });

  it('keeps the budgets the same as the agent files', () => {
    for (const def of MANDATORY_STAGE_AGENTS) {
      expect(STAGE_TURN_BUDGET[def.ledgerStage as keyof typeof STAGE_TURN_BUDGET]).toBe(
        def.maxTurns,
      );
      expect(
        STAGE_BASELINE_TURNS[def.ledgerStage as keyof typeof STAGE_BASELINE_TURNS],
      ).toBeGreaterThan(0);
    }
  });

  it('writes the file from the command line', async () => {
    const dir = tempDir();
    const transcript = join(dir, 't.jsonl');
    writeFileSync(transcript, turn('m1', '2026-11-04T10:00:00Z'));
    const runs = join(dir, 'runs.json');
    writeFileSync(runs, JSON.stringify([{ stage: 'checks', arm: 'a', transcript, bundle: dir }]));
    const out = join(dir, 'out/benchmark.json');
    await execa('node', ['scripts/stage-benchmark.mjs', '--runs', runs, '--out', out]);
    expect(JSON.parse(readFileSync(out, 'utf8')).sample).toBe(true);
  });
});

describe('skill-consumer-scan.mjs', () => {
  it('lists every base skill with consumers or none, and each recipe beside its sources', () => {
    const scan = scanConsumers(process.cwd());
    for (const item of scan.skills) {
      expect(item.consumers === 'none' || item.consumers.length > 0).toBe(true);
    }
    const review = scan.skills.find((item: { skill: string }) => item.skill === 'review-recipe');
    expect(review.copies).toEqual(['adversarial-review']);
    const source = scan.skills.find(
      (item: { skill: string }) => item.skill === 'adversarial-review',
    );
    expect(source.copied_into).toEqual(['review-recipe']);
    expect(scan.retired).toEqual([]);
  });

  it('reads the workflow list from the code and counts it', () => {
    const workflows = listWorkflows(process.cwd());
    expect(workflows).toContain('feature-development');
    expect(workflows).toContain('pentest-retest');
    expect(scanConsumers(process.cwd()).workflow_count).toBe(workflows.length);
  });
});
