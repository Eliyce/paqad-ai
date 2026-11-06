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
