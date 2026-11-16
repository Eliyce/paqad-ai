import { readFileSync, rmSync } from 'node:fs';

import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createProgram } from '../../../src/cli/program.js';
import { REVIEW_RUN_VERBS, createReviewRunCommand } from '../../../src/cli/commands/review-run.js';
import { HUD_REFRESH_VERBS, isHudRefreshVerb } from '../../../src/hud/refresh.js';
import { readReviewRun } from '../../../src/review-runs/store.js';
import { REVIEW_KINDS } from '../../../src/review-runs/kinds.js';

import { clockAt, tempRoot } from '../review-runs/fixtures.js';

describe('paqad-ai security-review and design-review', () => {
  let root: string;

  beforeEach(() => {
    root = tempRoot('paqad-review-cli-');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
    rmSync(root, { recursive: true, force: true });
  });

  async function cli(
    kind: 'security' | 'design',
    ...args: string[]
  ): Promise<{ lines: string[]; errors: string[]; code: number }> {
    const lines: string[] = [];
    const errors: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: string) => void lines.push(String(line)));
    vi.spyOn(console, 'error').mockImplementation((line: string) => void errors.push(String(line)));
    process.exitCode = undefined;
    await createReviewRunCommand(kind, { now: clockAt(0) }).parseAsync(
      [...args, '--project-root', root],
      { from: 'user' },
    );
    const code = Number(process.exitCode ?? 0);
    process.exitCode = undefined;
    vi.restoreAllMocks();
    return { lines, errors, code };
  }

  it('FR-5: both commands come from one factory with the same verbs and refresh the HUD', () => {
    const program = createProgram();
    for (const kind of Object.values(REVIEW_KINDS)) {
      const command = program.commands.find((entry) => entry.name() === kind.verb);
      expect(command?.commands.map((verb) => verb.name())).toEqual([...REVIEW_RUN_VERBS]);
      expect(HUD_REFRESH_VERBS).toContain(kind.verb);
      expect(isHudRefreshVerb(`${kind.verb} stage`)).toBe(true);
    }
  });

  it('AC-2: security-review start writes run.json at revision 1 and view.json', async () => {
    const started = await cli('security', 'start');
    expect(started.code).toBe(0);
    expect(started.lines).toEqual(['Security review: Security review has not started']);
    expect(readReviewRun(root, REVIEW_KINDS.security)?.revision).toBe(1);
    const view = JSON.parse(readFileSync(join(root, '.paqad/reviews/security/view.json'), 'utf8'));
    expect(view.word).toBe('Security review');
    expect(view.updated_at).toBeTruthy();
  });

  it('AC-4: each refusal prints one plain line, exits 1 and keeps the revision', async () => {
    await cli('security', 'start');
    const cases: string[][] = [
      ['start'],
      ['stage', 'nope', 'start'],
      ['stage', 'scope', 'done'],
      ['stage', 'scope', 'later'],
      ['finding', '--severity', 'huge', '--proof', 'confirmed'],
      ['finding', '--severity', 'high', '--proof', 'maybe'],
      ['gap', 'x', '--say', 'words'],
      ['gap', 'x', '--stage', 'scope'],
      ['resume'],
    ];
    for (const args of cases) {
      const refused = await cli('security', ...args);
      expect(refused.code, args.join(' ')).toBe(1);
      expect(refused.errors, args.join(' ')).toHaveLength(1);
      expect(refused.errors[0]).not.toContain('\n');
      expect(readReviewRun(root, REVIEW_KINDS.security)?.revision).toBe(1);
    }
    await cli('security', 'abandon');
    const after = readReviewRun(root, REVIEW_KINDS.security)!.revision;
    for (const args of [['stage', 'scope', 'start'], ['finish'], ['abandon']]) {
      const refused = await cli('security', ...args);
      expect(refused.code).toBe(1);
      expect(refused.errors).toHaveLength(1);
      expect(readReviewRun(root, REVIEW_KINDS.security)?.revision).toBe(after);
    }
  });

  it('AC-5: every verb under --json prints one JSON object, success or refusal', async () => {
    const runs: string[][] = [
      ['status'],
      ['start'],
      ['start'],
      ['stage', 'scope', 'start'],
      ['finding', '--severity', 'high', '--proof', 'confirmed', '--id', 'DT-0001'],
      ['finding', '--severity', 'bad', '--proof', 'confirmed'],
      ['gap', 'missing-design-docs', '--stage', 'scope', '--say', 'No design docs', '--stop'],
      ['resume'],
      ['stage', 'scope', 'done'],
      ['abandon'],
      ['resume'],
      ['finish'],
      ['finish'],
      ['status'],
    ];
    for (const args of runs) {
      const out = await cli('design', ...args, '--json');
      expect(out.lines, args.join(' ')).toHaveLength(1);
      const value = JSON.parse(out.lines[0]!);
      expect(typeof value.ok).toBe('boolean');
      expect(value.ok).toBe(out.code === 0);
    }
  });
});
