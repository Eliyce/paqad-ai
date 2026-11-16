import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { finishJourney } from '../../../../src/onboarding/journey/finish.js';
import { readRun, updateRun } from '../../../../src/onboarding/journey/run-store.js';
import { ONBOARDING_STAGES } from '../../../../src/onboarding/journey/stages.js';

import { at, clockAt, seedRun, tempRoot, writeFile } from './fixtures/journey.js';

describe('onboarding finish', () => {
  let root: string;

  beforeEach(() => {
    root = tempRoot('paqad-finish-');
    seedRun(root, { allow_list: true });
    updateRun(root, (draft) => {
      for (const stage of ONBOARDING_STAGES) draft.stages[stage.id] = { status: 'done' };
      draft.stages.rules_discovery = { status: 'degraded', degraded: ['research_offline'] };
      draft.stages.finish = { status: 'running', started_at: at(1) };
      draft.written = { 'docs/stack/overview.md': 'h' };
    });
    writeFile(
      root,
      '.paqad/project-profile.yaml',
      'project:\n  id: x\ncommands:\n  dev: npm run dev\n  build: npm run build\n  test: npm test\n',
    );
    writeFile(root, 'docs/modules/app/summary.md', '# App');
    writeFile(root, 'docs/stack/overview.md', '# Stack');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('AC-23 FR-23: lists existing hand-written pages for review and leaves them byte-identical', () => {
    writeFile(root, 'docs/architecture/overview.md', '# Our own words\n');
    const report = finishJourney(root, { rag: () => 'ready' }, clockAt(2));
    expect(report.existing_pages_kept).toEqual(['docs/architecture/overview.md']);
    expect(readFileSync(join(root, 'docs/architecture/overview.md'), 'utf8')).toBe(
      '# Our own words\n',
    );
    expect(readFileSync(join(root, '.paqad/onboarding/report.md'), 'utf8')).toContain(
      'docs/architecture/overview.md',
    );
  });

  it('FR-29 FR-5: the report names the allow list removal and every gap with its next action', () => {
    const report = finishJourney(root, { rag: () => 'ready' }, clockAt(2));
    expect(report.allow_list).toContain('.claude/settings.local.json');
    expect(
      report.steps.find((step) => step.step === 'Research rules for your stack')?.gaps[0]?.code,
    ).toBe('research_offline');
    expect(readRun(root)?.stages.finish.status).toBe('done');
    expect(Object.keys(readRun(root)!.written)).toContain('.paqad/onboarding/report.json');
  });

  it('ends Wrap up with the rag_off gap when search could not be built', () => {
    const report = finishJourney(root, { rag: () => 'off' }, clockAt(2));
    expect(report.rag).toBe('off');
    expect(readRun(root)?.stages.finish).toMatchObject({
      status: 'degraded',
      degraded: ['rag_off'],
    });
  });

  it('refuses before step 8 started', () => {
    updateRun(root, (draft) => void (draft.stages.finish = { status: 'not_started' }));
    expect(() => finishJourney(root, { rag: () => 'ready' }, clockAt(2))).toThrow('Start step 8');
  });
});
