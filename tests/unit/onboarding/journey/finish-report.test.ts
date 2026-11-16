import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const engine = vi.hoisted(() => ({ state: 'ready' as string, refresh: vi.fn() }));

vi.mock('@/core/optional-package.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/optional-package.js')>()),
  describeOptionalEngine: () => ({ state: engine.state }),
}));

vi.mock('@/background/worker-harness.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/background/worker-harness.js')>()),
  triggerRefresh: engine.refresh,
}));

import {
  buildReport,
  finishJourney,
  rebuildRagInBackground,
} from '../../../../src/onboarding/journey/finish.js';
import { readRun, updateRun } from '../../../../src/onboarding/journey/run-store.js';
import { ONBOARDING_STAGES } from '../../../../src/onboarding/journey/stages.js';
import { serializeRuleScriptMap } from '../../../../src/rule-scripts/map.js';

import { at, clockAt, seedRun, tempRoot, writeFile } from './fixtures/journey.js';

function row(row_id: string, change: string, text: string) {
  return { row_id, change, text, verdict: null };
}

describe('Wrap up search index and report sections (FR-20, FR-5)', () => {
  let root: string;

  beforeEach(() => {
    root = tempRoot('paqad-finish-report-');
    engine.state = 'ready';
    engine.refresh.mockReset();
    seedRun(root, { allow_list: false, rule_checks_flagged: ['RL-new'] });
    updateRun(root, (draft) => {
      for (const stage of ONBOARDING_STAGES) draft.stages[stage.id] = { status: 'done' };
      draft.stages.finish = { status: 'running', started_at: at(1) };
    });
    writeFile(
      root,
      '.paqad/project-profile.yaml',
      'project:\n  id: x\ncommands:\n  dev: npm run dev\n  build: npm run build\n  test: npm test\n',
    );
    writeFile(root, 'docs/modules/app/summary.md', '# App');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('starts the search index rebuild in the background only when the engine is ready', () => {
    expect(rebuildRagInBackground(root)).toBe('ready');
    expect(engine.refresh).toHaveBeenCalledTimes(1);
    expect(engine.refresh.mock.calls[0]![0]).toMatchObject({
      jobId: 'onboarding-rag-rebuild',
      worker: { args: ['rag', 'rebuild', '--yes', '--project-root', root] },
    });
    engine.state = 'installing';
    expect(rebuildRagInBackground(root)).toBe('installing');
    engine.state = 'missing';
    expect(rebuildRagInBackground(root)).toBe('off');
    expect(engine.refresh).toHaveBeenCalledTimes(1);
  });

  it('lists changed and removed rule rows of the latest run and the new rule checks to review', () => {
    writeFile(
      root,
      '.paqad/ledger/rules-discovery/rd-20260101-090000/proposal.json',
      JSON.stringify({ rows: [row('P-9', 'removed', 'old run')] }),
    );
    writeFile(
      root,
      '.paqad/ledger/rules-discovery/rd-20260101-100000/proposal.json',
      JSON.stringify({
        rows: [
          row('P-1', 'new', 'Add this'),
          row('P-2', 'changed', 'Reword that'),
          row('P-3', 'removed', 'Drop that'),
        ],
      }),
    );
    const rule = (id: string, path: string) => ({
      id,
      source: 'docs/instructions/rules/coding/q.md',
      text: id,
      text_hash: 'h',
      verifiability: { kind: 'deterministic' },
      enforced_by: [],
      scripts: [{ path }],
    });
    writeFile(
      root,
      'docs/instructions/rules/rule-script-map.yml',
      serializeRuleScriptMap({
        schema_version: 1,
        generated_at: at(0),
        rule_files_hash: 'h',
        rules: [
          rule('RL-old', '.paqad/scripts/rules/coding/old.mjs'),
          rule('RL-new', '.paqad/scripts/rules/coding/new.mjs'),
        ],
      } as never),
    );
    const report = finishJourney(root, { rag: () => 'installing' }, clockAt(2));
    expect(report.rule_changes_for_review).toEqual([
      { row_id: 'P-2', change: 'changed', text: 'Reword that' },
      { row_id: 'P-3', change: 'removed', text: 'Drop that' },
    ]);
    expect(report.new_rule_checks).toEqual(['.paqad/scripts/rules/coding/new.mjs']);
    expect(report.allow_list).toBeNull();
    expect(report.steps.at(-1)).toMatchObject({ status: 'done', gaps: [] });
    const markdown = readFileSync(join(root, '.paqad/onboarding/report.md'), 'utf8');
    expect(markdown).toContain('- P-2 (changed): Reword that');
    expect(markdown).toContain('- .paqad/scripts/rules/coding/new.mjs');
    expect(markdown).not.toContain('## Allow list');
    expect(readRun(root)?.stages.finish.status).toBe('done');
  });

  it('reports no rule rows and no checks when there is no discovery run or rule map', () => {
    const report = buildReport(root, readRun(root)!, 'ready', new Date(at(2)));
    expect(report.rule_changes_for_review).toEqual([]);
    expect(report.new_rule_checks).toEqual([]);
  });
});
