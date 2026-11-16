import { rmSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { checkEndGate, proveStage } from '../../../../src/onboarding/journey/proof.js';
import { readModuleUnits } from '../../../../src/onboarding/journey/modules.js';
import { emptyStages } from '../../../../src/onboarding/journey/run-store.js';
import { PROJECT_DOC_AREAS } from '../../../../src/onboarding/journey/stages.js';
import type {
  JourneyEvent,
  JourneyRun,
  StageId,
} from '../../../../src/onboarding/journey/types.js';
import { serializeRuleScriptMap } from '../../../../src/rule-scripts/map.js';

import { T0, at, baseRun, moduleMap, tempRoot, unitRow, writeFile } from './fixtures/journey.js';

function running(stage: StageId, overrides: Partial<JourneyRun> = {}): JourneyRun {
  const stages = emptyStages();
  stages[stage] = { status: 'running', started_at: at(10) };
  return { ...baseRun({ stages, ...overrides }), revision: 2 };
}

function failing(
  root: string,
  run: JourneyRun,
  stage: StageId,
  events: JourneyEvent[] = [],
): string[] {
  return proveStage({ projectRoot: root, run, events }, stage)
    .filter((proof) => !proof.ok)
    .map((proof) => proof.item);
}

const DISCOVERY_RUN = 'rd-20260101-101500';

function discoveryRun(
  root: string,
  research: Record<string, unknown>,
  rows: Array<Record<string, unknown>> = [],
): void {
  const dir = `.paqad/ledger/rules-discovery/${DISCOVERY_RUN}`;
  writeFile(
    root,
    `${dir}/run.json`,
    JSON.stringify({
      schema_version: 1,
      doc_type: 'paqad.rules-discovery.run',
      run_id: DISCOVERY_RUN,
      revision: 3,
      step: 'docs',
      status: 'done',
      opened_at: at(11),
      updated_at: at(20),
      signoff_decision: null,
      proposal_hash: null,
      steps: [],
    }),
  );
  writeFile(
    root,
    `${dir}/research.json`,
    JSON.stringify({
      schema_version: 1,
      order: [],
      done: [],
      skipped_private: [],
      unreached: [],
      updated_at: at(12),
      ...research,
    }),
  );
  writeFile(
    root,
    `${dir}/proposal.json`,
    JSON.stringify({
      schema_version: 1,
      run_id: DISCOVERY_RUN,
      generated_at: at(13),
      rows,
      folded: [],
      not_rules: [],
      manifests: {},
    }),
  );
}

describe('onboarding stage proofs', () => {
  let root: string;

  beforeEach(() => {
    root = tempRoot();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('AC-6: detect refuses a detection from before this run and accepts a fresh one', () => {
    const stale = running('detect', {
      detection: {
        stack: 'react',
        capabilities: [],
        source: 'detector',
        reason: 'package.json',
        detected_at: T0,
      },
    });
    expect(failing(root, stale, 'detect')).toEqual(['detection']);
    const fresh = running('detect', {
      detection: {
        stack: 'react',
        capabilities: [],
        source: 'ai',
        reason: 'vite + react',
        detected_at: at(11),
      },
    });
    expect(failing(root, fresh, 'detect')).toEqual([]);
    const unknown = running('detect', {
      detection: {
        stack: 'cobol',
        capabilities: [],
        source: 'ai',
        reason: 'x',
        detected_at: at(11),
      },
    });
    expect(failing(root, unknown, 'detect')).toEqual(['detection']);
  });

  it('AC-6: setup needs a fresh result with no failed steps and the framework files', () => {
    expect(failing(root, running('setup'), 'setup')).toEqual([
      'setup_result',
      'no_step_failures',
      'framework_path',
      'manifest',
    ]);
    writeFile(root, '.paqad/framework-path.txt', '/opt/paqad');
    writeFile(root, '.paqad/onboarding-manifest.json', '{}');
    const ok = running('setup', {
      setup: {
        completed_at: at(12),
        generated_files: ['CLAUDE.md'],
        step_failures: [],
        rag: 'deferred',
      },
    });
    expect(failing(root, ok, 'setup')).toEqual([]);
  });

  it('FR-20: project docs need one row per doc area and a module map', () => {
    writeFile(root, 'docs/instructions/rules/module-map.yml', moduleMap(['billing']));
    const run = running('project_docs');
    const rows = PROJECT_DOC_AREAS.slice(0, 6).map((area) => unitRow('project_docs', area, at(11)));
    expect(failing(root, run, 'project_docs', rows)).toEqual(['area:module-map']);
    rows.push(unitRow('project_docs', 'module-map', at(12)));
    expect(failing(root, run, 'project_docs', rows)).toEqual([]);
  });

  it('FR-20: module docs need a row for every slug in the current module map plus registries', () => {
    writeFile(root, 'docs/instructions/rules/module-map.yml', moduleMap(['billing', 'auth']));
    const hashes = Object.fromEntries(
      (readModuleUnits(root) ?? []).map((unit) => [unit.slug, unit.source_hash]),
    );
    const run = running('module_docs');
    const rows = [unitRow('module_docs', 'billing', at(11), { source_hash: hashes.billing })];
    expect(failing(root, run, 'module_docs', rows)).toEqual(['module:auth', 'registries']);
    rows.push(unitRow('module_docs', 'auth', at(12), { source_hash: 'old' }));
    rows.push(unitRow('module_docs', 'registries', at(13)));
    expect(failing(root, run, 'module_docs', rows)).toEqual(['module:auth']);
  });

  it('AC-26: offline research fails only research_online, which research_offline relaxes', () => {
    discoveryRun(root, { state: 'skipped-offline' });
    const run = running('rules_discovery');
    expect(failing(root, run, 'rules_discovery')).toEqual(['research_online']);
    const ctx = { projectRoot: root, run, events: [] };
    expect(checkEndGate(ctx, 'rules_discovery', []).ok).toBe(false);
    expect(checkEndGate(ctx, 'rules_discovery', ['research_offline'])).toEqual({
      ok: true,
      degraded: ['research_offline'],
    });
    expect(checkEndGate(ctx, 'rules_discovery', ['research_stopped']).ok).toBe(false);
  });

  it('INV-11: a sign-off that would remove or change existing rules has no proof', () => {
    discoveryRun(root, { state: 'done' }, [
      { row_id: 'r1', change: 'removed', verdict: 'remove' },
      { row_id: 'r2', change: 'changed', verdict: 'edit' },
      { row_id: 'r3', change: 'new', verdict: 'keep' },
    ]);
    expect(failing(root, running('rules_discovery'), 'rules_discovery')).toEqual([
      'no_removed',
      'no_changed',
    ]);
  });

  it('AC-6: analyze needs an analyzer audit row from this step covering every rule', () => {
    const map = {
      schema_version: 1,
      generated_at: T0,
      rule_files_hash: 'stale',
      rules: [
        {
          id: 'RL-1',
          source: 'a.md',
          text: 'x',
          text_hash: 'h',
          verifiability: { kind: 'deterministic' },
          enforced_by: [],
          scripts: [],
        },
      ],
    };
    writeFile(
      root,
      'docs/instructions/rules/rule-script-map.yml',
      serializeRuleScriptMap(map as never),
    );
    writeFile(
      root,
      '.paqad/scripts/rules/.history/events.jsonl',
      `${JSON.stringify({ ts: T0, via: 'rule-analyzer', action: 'analyze', rule_ids: ['RL-1'] })}\n`,
    );
    expect(failing(root, running('rules_analyze'), 'rules_analyze')).toEqual([
      'analyze_audit',
      'rule_files_hash',
    ]);
    expect(failing(root, running('rule_scripts'), 'rule_scripts')).toEqual([
      'rule:RL-1',
      'compile',
    ]);
    writeFile(
      root,
      '.paqad/compiled-rules.json',
      '{"written":"by rag refresh-context, which the brief does not run"}',
    );
    expect(failing(root, running('rule_scripts'), 'rule_scripts')).toContain('compile');
    writeFile(
      root,
      '.paqad/scripts/rules/.history/events.jsonl',
      [
        JSON.stringify({ ts: T0, via: 'rules-compile', action: 'generate', rule_ids: ['RL-1'] }),
        JSON.stringify({ ts: at(11), via: 'rules-compile', action: 'generate', rule_ids: [] }),
      ].join('\n') + '\n',
    );
    expect(failing(root, running('rule_scripts'), 'rule_scripts')).toEqual(['rule:RL-1']);
  });

  it('AC-6: finish needs a report written in this step', () => {
    writeFile(
      root,
      '.paqad/onboarding/report.json',
      JSON.stringify({ generated_at: T0, rag: 'ready' }),
    );
    writeFile(root, '.paqad/onboarding/report.md', '# report');
    const items = failing(root, running('finish'), 'finish');
    expect(items).toContain('report');
    expect(items).not.toContain('rag_ready');
  });
});
