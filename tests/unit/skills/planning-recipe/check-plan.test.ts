import { afterEach, describe, expect, it } from 'vitest';

import { cleanTempDirs, runScript, writeTemp } from '../recipe-helpers.js';

afterEach(cleanTempDirs);

const run = (plan: unknown) =>
  runScript('planning-recipe', 'check-plan.mjs', [writeTemp('plan.json', JSON.stringify(plan))]);

describe('check-plan.mjs', () => {
  it('passes a plan with a reuse section and a verdict on every step', async () => {
    const { exitCode, json } = await run({
      reuse: { consulted: [{ query: 'x' }] },
      steps: [{ id: 'S1', classification: 'ac-satisfying' }],
    });
    expect(exitCode).toBe(0);
    expect(json.ok).toBe(true);
    expect(json.hash).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('names a missing reuse section and a step with no verdict', async () => {
    const { exitCode, json } = await run({ steps: [{ id: 'S1' }] });
    expect(exitCode).toBe(1);
    expect(json.errors.join('\n')).toContain('no reuse section');
    expect(json.errors.join('\n')).toContain('S1 has no keep-or-drop verdict');
  });

  it('prints the same hash for the same input', async () => {
    const plan = { reuse: { consulted: [] }, steps: [{ classification: 'necessary-setup' }] };
    expect((await run(plan)).json.hash).toBe((await run(plan)).json.hash);
  });
});
