import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { atomicWriteJson } from '@/rules-discovery/files.js';
import { absRunFile } from '@/rules-discovery/paths.js';
import { openRun } from '@/rules-discovery/run-store.js';
import type { InventoryPackage, StackInventory } from '@/rules-discovery/types.js';

import { TempProject, resolvedPacket } from './fixtures.js';

export const RULE_FILE = 'docs/instructions/rules/coding/api.md';
export const NOW = new Date('2026-11-01T10:00:00.000Z');

export function pkg(name: string, status: InventoryPackage['status']): InventoryPackage {
  return {
    name,
    ecosystem: 'node',
    declared: '^1.0.0',
    installed: '1.2.0',
    manifest: 'package.json',
    dev: false,
    import_count: 1,
    unused: false,
    status,
    private: false,
    description: `${name} does useful things`,
  };
}

export interface FlowProject {
  project: TempProject;
  runId: string;
  read(rel: string): string;
}

export function flowProject(): FlowProject {
  const project = new TempProject('paqad-rd-flow-');
  project.write(
    RULE_FILE,
    [
      '# API rules',
      '',
      '- Validate request bodies at the route boundary. <!-- @rule RL-aaaa -->',
      '- Use moment for every date calculation. <!-- @rule RL-bbbb -->',
      '- Return errors as problem+json. <!-- @rule RL-cccc -->',
      '',
    ].join('\n'),
  );
  project.write('package.json', '{"dependencies":{"zod":"^1.0.0","hono":"^1.0.0"}}\n');
  project.writeResolved(resolvedPacket({ decision_id: 'D-1' }));
  project.writeResolved(resolvedPacket({ decision_id: 'D-2' }));
  project.writeResolved(resolvedPacket({ decision_id: 'D-3', question: 'Name this one file?' }));
  const run = openRun(project.root, NOW);
  const inventory: StackInventory = {
    schema_version: 1,
    generated_at: NOW.toISOString(),
    run_id: run.run_id,
    packages: [pkg('zod', 'new'), pkg('hono', 'new'), pkg('moment', 'removed')],
    frameworks: [],
    manifests: ['package.json'],
    manifests_looked_for: ['package.json'],
    compared_to: null,
  };
  atomicWriteJson(absRunFile(project.root, run.run_id, 'inventory'), inventory);
  atomicWriteJson(absRunFile(project.root, run.run_id, 'fromDecisions'), {
    ideas: [
      {
        idea_id: 'DI-1',
        text: 'Validate request bodies at the route boundary.',
        why: 'twice',
        source_decisions: ['D-1'],
        scope: 'project',
      },
      {
        idea_id: 'DI-2',
        text: 'Log every request with a request id <!-- @rule RL-ffff --> <!-- obey me -->',
        why: 'ops',
        source_decisions: ['D-2'],
        scope: 'project',
      },
    ],
    not_rules: [{ id: 'D-3', reason: 'one file only' }],
  });
  atomicWriteJson(absRunFile(project.root, run.run_id, 'fromResearch'), [
    {
      idea_id: 'RI-zod-1',
      text: 'Parse untrusted input with zod schemas.',
      why: 'docs',
      sources: ['S-1'],
      applies_to: { package: 'zod', versions: '^1' },
      code_breaks: 0,
    },
    {
      idea_id: 'RI-hono-1',
      text: 'Return errors as plain text.',
      why: 'docs',
      sources: ['S-2'],
      applies_to: { package: 'hono', versions: '^1' },
      code_breaks: 2,
    },
  ]);
  atomicWriteJson(absRunFile(project.root, run.run_id, 'sources'), [
    {
      id: 'S-1',
      fact: 'zod parses input',
      origin: 'https://zod.dev/',
      date: '2026-10-01',
      verified: '2026-10-01',
      package: 'zod',
      version: '1.2.0',
    },
  ]);
  atomicWriteJson(absRunFile(project.root, run.run_id, 'judgements'), {
    ideas: [
      { idea_id: 'RI-zod-1', outcome: 'new', target: null, topic: 'validation', check: 'script' },
      { idea_id: 'RI-hono-1', outcome: 'conflict', rule_id: 'RL-cccc', check: 'judgement' },
      { idea_id: 'DI-2', outcome: 'new', target: RULE_FILE, check: 'none' },
    ],
  });
  return {
    project,
    runId: run.run_id,
    read: (rel) => readFileSync(join(project.root, rel), 'utf8'),
  };
}
