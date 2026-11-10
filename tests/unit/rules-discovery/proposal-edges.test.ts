import { writeFileSync } from 'node:fs';

import { afterEach, describe, expect, it } from 'vitest';

import { manifestPackageNames } from '@/rules-discovery/nudge.js';
import { atomicWriteJson } from '@/rules-discovery/files.js';
import { absRunFile } from '@/rules-discovery/paths.js';
import {
  buildProposal,
  proposalFileHash,
  readJudgements,
  readProposal,
  staleRows,
  type BuildProposalInput,
  type ExistingRule,
} from '@/rules-discovery/proposal.js';
import { markResearched, readResearch, startResearch } from '@/rules-discovery/research.js';
import { openRun } from '@/rules-discovery/run-store.js';
import type { StackInventory } from '@/rules-discovery/types.js';
import { managedBlockMarkers, upsertManagedBlock } from '@/stack-docs/managed-block.js';

import { TempProject } from './fixtures.js';
import { NOW, pkg } from './flow-fixtures.js';

const RULES = 'docs/instructions/rules/coding/api.md';
const projects: TempProject[] = [];

afterEach(() => {
  while (projects.length > 0) projects.pop()!.dispose();
});

function temp(): TempProject {
  const project = new TempProject('paqad-rd-proposal-edges-');
  projects.push(project);
  return project;
}

const existing: ExistingRule[] = [
  {
    rule_id: 'RL-aaaa',
    text: 'Validate request bodies at the boundary.',
    source: RULES,
    check: 'script',
  },
];

function input(partial: Partial<BuildProposalInput>): BuildProposalInput {
  return {
    runId: 'rd-20261101-100000',
    now: NOW,
    existing,
    decisions: { ideas: [], not_rules: [] },
    research: [],
    inventory: null,
    judgements: [],
    fileHash: () => 'h',
    ...partial,
  };
}

describe('AC-5 proposal rows', () => {
  it('AC-5: picks a topic from the package, falling back to decisions or stack', () => {
    const proposal = buildProposal(
      input({
        decisions: {
          ideas: [
            {
              idea_id: 'DI-1',
              text: 'Keep one router per module.',
              why: 'x',
              source_decisions: ['D-1'],
              scope: 'project',
            },
          ],
          not_rules: [],
        },
        research: [
          {
            idea_id: 'RI-1',
            text: 'Prefer safeParse for user input.',
            why: 'x',
            sources: ['S-1'],
            applies_to: { package: '@Scope/Zod', versions: '^3' },
            code_breaks: 0,
          },
          {
            idea_id: 'RI-2',
            text: 'Pin the toolchain.',
            why: 'x',
            sources: ['S-2'],
            applies_to: { package: '___', versions: '*' },
            code_breaks: 0,
          },
        ],
      }),
    );
    expect(proposal.rows.map((row) => [row.topic, row.target])).toEqual([
      ['decisions', 'docs/instructions/rules/project/decisions.md'],
      ['scope-zod', 'docs/instructions/rules/project/scope-zod.md'],
      ['stack', 'docs/instructions/rules/project/stack.md'],
    ]);
  });

  it('AC-5: folds an idea the judgement names as a fold of an existing rule', () => {
    const proposal = buildProposal(
      input({
        decisions: {
          ideas: [
            {
              idea_id: 'DI-1',
              text: 'Check every request body where it enters.',
              why: 'x',
              source_decisions: ['D-1'],
              scope: 'project',
            },
          ],
          not_rules: [],
        },
        judgements: [{ idea_id: 'DI-1', outcome: 'fold', rule_id: 'RL-aaaa' }],
      }),
    );
    expect(proposal.rows).toEqual([]);
    expect(proposal.folded).toEqual([
      { idea_id: 'DI-1', rule_id: 'RL-aaaa', source_decisions: ['D-1'] },
    ]);
  });

  it('AC-5: a fold naming an unknown rule becomes a new row', () => {
    const proposal = buildProposal(
      input({
        decisions: {
          ideas: [
            {
              idea_id: 'DI-1',
              text: 'Log every request.',
              why: 'x',
              source_decisions: ['D-1'],
              scope: 'project',
            },
          ],
          not_rules: [],
        },
        judgements: [{ idea_id: 'DI-1', outcome: 'fold', rule_id: 'RL-none' }],
      }),
    );
    expect(proposal.folded).toEqual([]);
    expect(proposal.rows).toMatchObject([{ change: 'new', existing: null }]);
  });

  it('AC-5: merges ideas with the same text into one row with every source', () => {
    const proposal = buildProposal(
      input({
        decisions: {
          ideas: [
            {
              idea_id: 'DI-1',
              text: 'Parse input with zod.',
              why: 'x',
              source_decisions: ['D-1'],
              scope: 'project',
            },
            {
              idea_id: 'DI-2',
              text: 'parse input with zod',
              why: 'x',
              source_decisions: ['D-1', 'D-2'],
              scope: 'project',
            },
            {
              idea_id: 'DI-3',
              text: '<!-- only a comment -->',
              why: 'x',
              source_decisions: ['D-3'],
              scope: 'project',
            },
          ],
          not_rules: [],
        },
        research: [
          {
            idea_id: 'RI-1',
            text: 'Parse input with zod',
            why: 'x',
            sources: ['S-1'],
            applies_to: { package: 'zod', versions: '^3' },
            code_breaks: 0,
          },
        ],
      }),
    );
    expect(proposal.rows).toHaveLength(1);
    expect(proposal.rows[0]).toMatchObject({
      idea_ids: ['DI-1', 'DI-2', 'RI-1'],
      source_decisions: ['D-1', 'D-2'],
      sources: ['S-1'],
      packages: ['zod'],
    });
  });

  it('AC-5: a removed package that is still live under another manifest proposes no removal', () => {
    const inventory: StackInventory = {
      schema_version: 1,
      generated_at: NOW.toISOString(),
      run_id: 'rd-20261101-100000',
      packages: [
        pkg('moment', 'removed'),
        { ...pkg('Moment', 'unchanged'), manifest: 'web/package.json' },
      ],
      frameworks: [],
      manifests: ['package.json'],
      manifests_looked_for: [],
      compared_to: null,
    };
    const proposal = buildProposal(
      input({
        existing: [
          { rule_id: 'RL-bbbb', text: 'Use moment for dates.', source: RULES, check: 'none' },
        ],
        inventory,
      }),
    );
    expect(proposal.rows).toEqual([]);
  });
});

describe('AC-5 stale rows', () => {
  it('AC-5: a row against a rule that changed or vanished on disk is stale', () => {
    const proposal = buildProposal(
      input({
        decisions: {
          ideas: [
            {
              idea_id: 'DI-1',
              text: 'Validate bodies in services.',
              why: 'x',
              source_decisions: ['D-1'],
              scope: 'project',
            },
          ],
          not_rules: [],
        },
        judgements: [{ idea_id: 'DI-1', outcome: 'change', rule_id: 'RL-aaaa' }],
      }),
    );
    expect(proposal.rows[0]).toMatchObject({ change: 'changed', target: RULES });
    const why = [{ row_id: 'P-1', why: 'rule RL-aaaa changed on disk' }];
    expect(
      staleRows(proposal, [{ ...existing[0]!, text: 'Something else.' }], () => 'h', {}),
    ).toEqual(why);
    expect(staleRows(proposal, [], () => 'h', {})).toEqual(why);
    expect(staleRows(proposal, existing, () => 'h', {})).toEqual([]);
  });
});

describe('AC-5 proposal files', () => {
  it('AC-5: refuses broken proposal and judgement files and reads missing ones as empty', () => {
    const project = temp();
    const run = openRun(project.root, NOW);
    expect(readProposal(project.root, run.run_id)).toBeNull();
    expect(proposalFileHash(project.root, run.run_id)).toBeNull();
    expect(readJudgements(project.root, run.run_id)).toEqual([]);
    atomicWriteJson(absRunFile(project.root, run.run_id, 'proposal'), { rows: 'x' });
    expect(readProposal(project.root, run.run_id)).toBeNull();
    expect(proposalFileHash(project.root, run.run_id)).toMatch(/^[0-9a-f]{64}$/);
    atomicWriteJson(absRunFile(project.root, run.run_id, 'judgements'), { ideas: 'x' });
    expect(readJudgements(project.root, run.run_id)).toEqual([]);
    writeFileSync(absRunFile(project.root, run.run_id, 'proposal'), '{', 'utf8');
    writeFileSync(absRunFile(project.root, run.run_id, 'judgements'), '{', 'utf8');
    expect(() => readProposal(project.root, run.run_id)).toThrow(/proposal\.json .* is unreadable/);
    expect(() => readJudgements(project.root, run.run_id)).toThrow(
      /proposal-judgements\.json .* is unreadable/,
    );
  });
});

describe('AC-5 research progress files', () => {
  it('AC-5: refuses a broken research.json and a key outside the plan', () => {
    const project = temp();
    const run = openRun(project.root, NOW);
    expect(() => markResearched(project.root, run.run_id, 'node:zod', NOW)).toThrow(
      /research has not started/,
    );
    const inventory: StackInventory = {
      schema_version: 1,
      generated_at: NOW.toISOString(),
      run_id: run.run_id,
      packages: [pkg('zod', 'new')],
      frameworks: [],
      manifests: ['package.json'],
      manifests_looked_for: [],
      compared_to: null,
    };
    const started = startResearch(project.root, run.run_id, inventory, {
      offline: false,
      now: NOW,
    });
    const key = started.order[0]!.key;
    expect(() => markResearched(project.root, run.run_id, 'node:other', NOW)).toThrow(
      /is not in the research plan/,
    );
    const once = markResearched(project.root, run.run_id, key, NOW);
    expect(markResearched(project.root, run.run_id, key, NOW).done).toEqual(once.done);
    writeFileSync(absRunFile(project.root, run.run_id, 'research'), '{', 'utf8');
    expect(() => readResearch(project.root, run.run_id)).toThrow(/research\.json .* is unreadable/);
  });
});

describe('AC-5 drift nudge manifests', () => {
  it('AC-5: lists a package once across manifests and skips non-object dependency blocks', () => {
    const project = temp();
    project.write(
      'package.json',
      JSON.stringify({ dependencies: { zod: '^3.0.0' }, devDependencies: null }),
    );
    project.write(
      'web/package.json',
      JSON.stringify({ dependencies: { zod: '^3.0.0', react: '^18.0.0' } }),
    );
    expect(manifestPackageNames(project.root)).toEqual([
      { name: 'zod', ecosystem: 'node' },
      { name: 'react', ecosystem: 'node' },
    ]);
  });

  it('AC-5: falls back to the manifest parser when package.json is not valid JSON', () => {
    const project = temp();
    project.write('package.json', '{ "dependencies": ');
    project.write('requirements.txt', 'requests==2.31.0\n');
    expect(manifestPackageNames(project.root)).toEqual([{ name: 'requests', ecosystem: 'python' }]);
  });
});

describe('AC-5 managed stack doc blocks', () => {
  const { begin, end } = managedBlockMarkers('zod');

  it('AC-5: writes the block alone into an empty file', () => {
    expect(upsertManagedBlock('', 'zod', 'body')).toBe(`${begin}\nbody\n${end}\n`);
  });

  it('AC-5: appends after a blank line, keeping Windows line endings', () => {
    expect(upsertManagedBlock('# Title', 'zod', 'a\nb')).toBe(
      `# Title\n\n${begin}\na\nb\n${end}\n`,
    );
    expect(upsertManagedBlock('# Title\r\n', 'zod', 'a')).toBe(
      `# Title\r\n\r\n${begin}\r\na\r\n${end}\r\n`,
    );
  });

  it('AC-5: replaces an existing block in place', () => {
    const first = upsertManagedBlock('# Title\n', 'zod', 'old');
    const second = upsertManagedBlock(`${first}tail\n`, 'zod', 'new');
    expect(second).toBe(`# Title\n\n${begin}\nnew\n${end}\ntail\n`);
  });
});
