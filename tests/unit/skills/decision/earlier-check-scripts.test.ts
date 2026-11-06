import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createPendingDecision, resolvePendingDecision } from '@/decisions/authoring.js';

import { runScript } from '../_helpers/run-script.js';

const CREATE = 'runtime/base/skills/decision/scripts/create.mjs';
const RESOLVE = 'runtime/base/skills/decision/scripts/resolve.mjs';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-earlier-scripts-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const question = {
  category: 'finding.triage',
  title: 'Which colour should the banner use',
  context: 'Why this came up',
  options: [
    { option_key: 'a', label: 'Fix A' },
    { option_key: 'b', label: 'Fix B' },
  ],
};

function answered(): string {
  const { id } = createPendingDecision(root, question);
  resolvePendingDecision(root, id, 'b', 'Matches the brand');
  return id;
}

describe('the decision skill scripts', () => {
  it('AC-6 AC-19 resolve.mjs refuses a required packet and leaves the file byte-identical', () => {
    answered();
    const { id, path } = createPendingDecision(root, question);
    const before = readFileSync(path, 'utf8');
    const result = runScript(RESOLVE, [root, id, 'a']);
    expect(result.status).toBe(1);
    expect(result.stderr.trim()).toBe(
      `This question has earlier answers to check first. Run paqad-ai decision check ${id}.`,
    );
    expect(readFileSync(path, 'utf8')).toBe(before);
  });

  it('AC-51 create.mjs prints the same earlier_check block as the CLI', () => {
    const earlier = answered();
    const result = runScript(CREATE, [
      root,
      '--category',
      'finding.triage',
      '--title',
      'Which colour should banner use',
      '--context',
      'Now',
      '--option',
      'a=Fix A',
      '--option',
      'b=Fix B',
    ]);
    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.earlier_check.required).toBe(true);
    expect(output.earlier_check.candidates[0]).toMatchObject({
      id: earlier,
      chosen: 'b',
      chosen_label: 'Fix B',
      why: 'Matches the brand',
    });
    expect(output.earlier_check.method).toContain('Treat shared wording as no evidence');
  });
});

describe('standing answers through the skill scripts', () => {
  function always(env: Record<string, string> = {}): ReturnType<typeof runScript> {
    const { id } = createPendingDecision(root, question);
    return runScript(RESOLVE, [root, id, 'a', 'Keep it', '--always'], { env });
  }

  const createArgs = (...extra: string[]): string[] => [
    root,
    '--category',
    question.category,
    '--title',
    question.title,
    '--context',
    question.context,
    '--option',
    'a=Fix A',
    '--option',
    'b=Fix B',
    ...extra,
  ];

  it('AC-10 resolve.mjs refuses a stage agent before anything changes', () => {
    const result = always({ SE_AGENT_ID: 'agent-1' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('A stage agent cannot');
  });

  it('AC-51 create.mjs prints the reused shape, and --ask-anyway opens a pending packet', () => {
    const set = always({ SE_AGENT_ID: '' });
    expect(set.status).toBe(0);
    const ruleId = JSON.parse(set.stdout).standing_answer as string;

    const reused = runScript(CREATE, createArgs());
    expect(reused.status).toBe(0);
    expect(JSON.parse(reused.stdout)).toMatchObject({
      reused: true,
      chosen: 'a',
      label: 'Fix A',
      match: 'standing',
    });
    expect(JSON.parse(reused.stdout).say).toContain(ruleId);

    const anyway = JSON.parse(runScript(CREATE, createArgs('--ask-anyway')).stdout);
    expect(anyway).not.toHaveProperty('reused');
    expect(anyway.path).toContain('pending');
  });
});
