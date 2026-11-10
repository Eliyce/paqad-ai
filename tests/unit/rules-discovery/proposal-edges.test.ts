import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { baselineLabel } from '@/rules-discovery/baseline.js';
import { proposeStep } from '@/rules-discovery/flow.js';
import {
  computeRulesDriftNudge,
  manifestPackageNames,
  nudgeLine,
} from '@/rules-discovery/nudge.js';
import { atomicWriteJson } from '@/rules-discovery/files.js';
import { absRunFile } from '@/rules-discovery/paths.js';
import {
  buildProposal,
  carryVerdicts,
  mentionsPackage,
  proposalFileHash,
  readJudgements,
  readProposal,
  setVerdict,
  staleRows,
  type BuildProposalInput,
  type ExistingRule,
} from '@/rules-discovery/proposal.js';
import {
  checkResearch,
  markResearched,
  planResearch,
  readResearch,
  startResearch,
  stopResearch,
  type ResearchIdea,
} from '@/rules-discovery/research.js';
import { openRun, readRun } from '@/rules-discovery/run-store.js';
import { readSignoff, signedHash } from '@/rules-discovery/signoff.js';
import type { StackInventory } from '@/rules-discovery/types.js';
import { managedBlockMarkers, upsertManagedBlock } from '@/stack-docs/managed-block.js';

import { TempProject, resolvedPacket } from './fixtures.js';
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

function inventoryOf(runId: string, packages: StackInventory['packages']): StackInventory {
  return {
    schema_version: 1,
    generated_at: NOW.toISOString(),
    run_id: runId,
    packages,
    frameworks: [],
    manifests: ['package.json'],
    manifests_looked_for: [],
    compared_to: null,
  };
}

describe('AC-5 proposal verdict edges', () => {
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
          {
            idea_id: 'DI-2',
            text: 'Name files in kebab case.',
            why: 'x',
            source_decisions: ['D-2'],
            scope: 'project',
          },
        ],
        not_rules: [],
      },
    }),
  );

  it('AC-5: refuses a verdict for a row that does not exist', () => {
    expect(() => setVerdict(proposal, 'P-9', 'keep')).toThrow('no proposal row P-9');
  });

  it('AC-5: refuses an edit with no text or only a comment', () => {
    expect(() => setVerdict(proposal, 'P-1', 'edit')).toThrow(/edit needs the new rule text/);
    expect(() => setVerdict(proposal, 'P-1', 'edit', '<!-- x -->')).toThrow(
      /edit needs the new rule text/,
    );
  });

  it('AC-5: carries earlier verdicts only to rows that match an earlier row', () => {
    const decided = setVerdict(proposal, 'P-1', 'edit', 'Log every request with an id.');
    const next = buildProposal(
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
            {
              idea_id: 'DI-3',
              text: 'Keep handlers small.',
              why: 'x',
              source_decisions: ['D-3'],
              scope: 'project',
            },
          ],
          not_rules: [],
        },
      }),
    );
    const carried = carryVerdicts(decided, next);
    expect(carried.rows.map((row) => [row.verdict, row.edited_text])).toEqual([
      ['edit', 'Log every request with an id.'],
      [null, null],
    ]);
  });

  it('AC-5: never matches a package name shorter than three characters', () => {
    expect(mentionsPackage('Use qs for query strings.', 'qs')).toBe(false);
    expect(mentionsPackage('Use zod for input.', 'zod')).toBe(true);
  });
});

describe('AC-5 proposing without an inventory', () => {
  it('AC-5: proposes from decisions alone and leaves the baseline alone', () => {
    const project = temp();
    const run = openRun(project.root, NOW);
    const result = proposeStep(project.root, run.run_id, NOW);
    expect(result.current).toBe(true);
    expect(readRun(project.root, run.run_id)).toMatchObject({ record: { status: 'done' } });
  });

  it('AC-5: labels a baseline with neither an inventory nor a seed by its own path', () => {
    expect(
      baselineLabel({
        schema_version: 1,
        source: 'run',
        inventory: null,
        run_id: null,
        seeded_from: null,
        updated_at: NOW.toISOString(),
        packages: [],
      }),
    ).toBe('.paqad/ledger/rules-discovery/baseline.json');
  });
});

describe('AC-5 research plan and checks', () => {
  it('AC-5: plans a package once and falls back to its declared version', () => {
    const plan = planResearch(
      inventoryOf('rd-20261101-100000', [
        { ...pkg('zod', 'unchanged'), installed: null },
        { ...pkg('zod', 'unchanged'), manifest: 'web/package.json' },
      ]),
    );
    expect(plan.order).toEqual([
      { key: 'node:zod', name: 'zod', ecosystem: 'node', installed: '^1.0.0', reason: 'other' },
    ]);
  });

  it('AC-5: an online run with nothing to research is done, and stopping needs a started run', () => {
    const project = temp();
    const run = openRun(project.root, NOW);
    expect(() => stopResearch(project.root, run.run_id, NOW)).toThrow(/has not started/);
    const progress = startResearch(project.root, run.run_id, inventoryOf(run.run_id, []), {
      offline: false,
      now: NOW,
    });
    expect(progress.state).toBe('done');
    expect(stopResearch(project.root, run.run_id, NOW).state).toBe('done');
  });

  it('AC-5: stopping with packages left marks research stopped', () => {
    const project = temp();
    const run = openRun(project.root, NOW);
    startResearch(project.root, run.run_id, inventoryOf(run.run_id, [pkg('zod', 'new')]), {
      offline: false,
    });
    expect(stopResearch(project.root, run.run_id).state).toBe('stopped');
  });

  it('AC-5: names an idea with no package, version or sources and keeps a versionless source', () => {
    const broken = { idea_id: 'RI-x', text: 'Something.', why: 'x' } as unknown as ResearchIdea;
    const result = checkResearch({
      ideas: [broken],
      sources: [
        {
          id: 'S-1',
          fact: 'fact',
          origin: 'https://example.test/',
          date: '2026-11-01',
          verified: 'yes',
          package: 'ghost',
          version: undefined as unknown as string,
        },
      ],
      inventory: inventoryOf('rd-20261101-100000', [{ ...pkg('zod', 'new'), installed: null }]),
      now: NOW,
    });
    expect(result.problems).toEqual([
      'RI-x names no package version',
      'RI-x has no usable source with a link and a date read',
    ]);
    expect(result.sources.map((source) => [source.id, source.old])).toEqual([['S-1', false]]);
  });
});

describe('AC-5 sign-off reading', () => {
  it('AC-5: a packet without a proposal hash has no signed hash', () => {
    expect(signedHash(resolvedPacket({ decision_id: 'D-1' }))).toBeNull();
  });

  it('AC-5: a resolved sign-off without a human answer reads as not now', () => {
    const project = temp();
    project.writeResolved(resolvedPacket({ decision_id: 'D-4', human_response: undefined }));
    expect(readSignoff(project.root, 'D-4').state).toBe('not_now');
  });
});

describe('AC-5 drift nudge edges', () => {
  it('AC-5: reads a wildcard manifest such as a csproj', () => {
    const project = temp();
    project.write(
      join('src', 'App.csproj'),
      '<Project><ItemGroup><PackageReference Include="Serilog" Version="3.0.0" /></ItemGroup></Project>',
    );
    expect(manifestPackageNames(project.root)).toEqual([{ name: 'Serilog', ecosystem: 'dotnet' }]);
  });

  it('AC-5: names no packages when none can be shown', () => {
    expect(nudgeLine(2, [], null)).toBe(
      "Your rules may be behind: 2 new packages. Say 'discover rules' to update them.",
    );
  });

  it('AC-5: says nothing when there is no baseline and no stack snapshot', () => {
    const project = temp();
    project.write('package.json', JSON.stringify({ dependencies: { zod: '^3.0.0' } }));
    expect(computeRulesDriftNudge(project.root, NOW)).toBeNull();
  });
});
