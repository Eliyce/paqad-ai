import { afterEach, describe, expect, it, vi } from 'vitest';

import { createRulesCommand } from '@/cli/commands/rules.js';
import { listUnjudgedDecisions, validateFromDecisions } from '@/rules-discovery/decisions.js';
import { runFilePath } from '@/rules-discovery/paths.js';

import { TempProject, resolvedPacket } from './fixtures.js';

const projects: TempProject[] = [];

function project(): TempProject {
  const p = new TempProject();
  projects.push(p);
  return p;
}

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
  while (projects.length > 0) projects.pop()!.dispose();
});

async function run(root: string, ...args: string[]): Promise<string[]> {
  const lines: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((line: string) => lines.push(String(line)));
  vi.spyOn(console, 'error').mockImplementation((line: string) => lines.push(String(line)));
  await createRulesCommand().parseAsync(['discovery', ...args, '--project-root', root], {
    from: 'user',
  });
  return lines;
}

describe('rules discovery decisions', () => {
  it('AC-22: lists untagged resolved decisions with their fields and skips tagged ones', async () => {
    const p = project();
    p.writeResolved(resolvedPacket({ decision_id: 'D-1' }));
    p.writeResolved(
      resolvedPacket({
        decision_id: 'D-2',
        rules_discovery: {
          status: 'absorbed',
          run_id: 'rd-20261101-090000',
          rule_id: 'RL-abcd',
          tagged_at: '2026-11-01T09:00:00Z',
        },
      }),
    );
    p.writeResolved(
      resolvedPacket({
        decision_id: 'D-3',
        rules_discovery: {
          status: 'not-a-rule',
          run_id: 'rd-20261101-090000',
          reason: 'one change only',
          tagged_at: '2026-11-01T09:00:00Z',
        },
      }),
    );
    p.writeResolved(resolvedPacket({ decision_id: 'D-4', category: 'rules.proposal' as never }));
    expect(listUnjudgedDecisions(p.root)).toEqual([
      {
        id: 'D-1',
        category: 'architecture-path',
        title: 'Where should request bodies be validated?',
        chosen: 'boundary',
        chosen_label: 'Validate with zod at the route boundary',
        rationale: 'one place to check input',
        change: 'task-1',
      },
    ]);
    const lines = await run(p.root, 'decisions');
    expect(lines[0]).toContain('1 resolved decision not yet judged');
    expect(JSON.parse(lines[1]!)).toEqual({ decisions: listUnjudgedDecisions(p.root) });
  });

  it('AC-20: the check verb accepts ideas that quote listed decisions and rejects strays', async () => {
    const known = new Set(['D-1', 'D-2']);
    expect(
      validateFromDecisions(
        {
          ideas: [
            {
              idea_id: 'DI-1',
              text: 'Validate request bodies at the route boundary.',
              why: 'settled twice',
              source_decisions: ['D-1'],
              scope: 'project',
            },
          ],
          not_rules: [{ id: 'D-2', reason: 'one change only' }],
        },
        known,
      ),
    ).toEqual([]);
    const problems = validateFromDecisions(
      {
        ideas: [{ idea_id: 'DI-1', text: 'x', source_decisions: ['D-9'], scope: 'anywhere' }],
        not_rules: [{ id: 'D-1', reason: '' }],
      },
      known,
    );
    expect(problems.join('\n')).toContain('D-9, which is not listed');
    expect(problems.join('\n')).toContain('scope must be');
    expect(problems.join('\n')).toContain('has no reason');
  });

  it('AC-21: reports a valid file through the check verb and refuses a broken one', async () => {
    const p = project();
    p.writeResolved(resolvedPacket({ decision_id: 'D-1' }));
    const runId = 'rd-20261110-120000';
    p.write(
      runFilePath(runId, 'fromDecisions'),
      JSON.stringify({ ideas: [], not_rules: [{ id: 'D-1', reason: 'one change only' }] }),
    );
    expect((await run(p.root, 'decisions', '--check', runId)).join('\n')).toContain('valid');
    expect(process.exitCode).toBeUndefined();
    p.write(runFilePath(runId, 'fromDecisions'), JSON.stringify({ ideas: 'nope' }));
    expect((await run(p.root, 'decisions', '--check', runId)).join('\n')).toContain('problem');
    expect(process.exitCode).toBe(1);
  });
});
