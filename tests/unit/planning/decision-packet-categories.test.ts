import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import { DECISION_CATEGORIES } from '@/planning/decision-packet.js';
import {
  buildDecisionPacket,
  decisionOptionsForCategory,
  decisionQuestionForCategory,
} from '@/planning/index.js';

import { createManifest } from './fixtures.js';

describe('decision packets for every category', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'decision-packet-categories-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function contextFor(touches: string[]) {
    const manifest = createManifest({
      execution_slices: [{ ...createManifest().execution_slices[0]!, touches }],
    });
    return {
      manifest,
      context: {
        manifest_header: {
          plan_version: manifest.plan_version,
          plan_mode: manifest.plan_mode,
          feature_id: manifest.feature_id,
          slug: manifest.slug,
          created_at: manifest.created_at,
          classification: manifest.classification,
        },
        current_slice: manifest.execution_slices[0]!,
        verification_criteria: [],
        test_skeletons: [],
        doc_targets: [],
        regression_entries: [],
        prior_slices: [],
        existing_code_matches: [],
        decision_context: [],
        token_budget: 5000,
      },
    };
  }

  it('asks a distinct plain question for each category', () => {
    const questions = DECISION_CATEGORIES.map((category) => decisionQuestionForCategory(category));
    expect(questions.every((question) => question.endsWith('?'))).toBe(true);
    expect(new Set(questions).size).toBe(DECISION_CATEGORIES.length);
  });

  it('offers options only for code-shape forks and defaults the extension to .ts', () => {
    for (const category of DECISION_CATEGORIES) {
      const { options } = decisionOptionsForCategory(root, category, 'src/widgets/Button');
      for (const option of options) {
        expect(option.one_line_preview).not.toContain('undefined');
      }
    }
    expect(decisionOptionsForCategory(root, 'spec.change', 'src/a.ts').options).toEqual([]);
  });

  it('watches the files, touches and design system each category depends on', () => {
    const { manifest, context } = contextFor(['src/ui/Button.tsx', 'src/ui/theme.ts']);
    const watch = (category: (typeof DECISION_CATEGORIES)[number]): string[] =>
      buildDecisionPacket({
        projectRoot: root,
        requestedBy: 'planner',
        taskSessionId: 's',
        decisionId: 'D-01J000000000000000000000A1',
        category,
        detectorConfidence: 0.6,
        context,
        manifest,
      }).invalidation_watch;

    expect(watch('component-reuse')).toContain(PATHS.DESIGN_SYSTEM_DIR);
    expect(watch('create-vs-reuse')).toContain(PATHS.DESIGN_SYSTEM_DIR);
    expect(watch('shared-abstraction')).toContain(PATHS.DESIGN_SYSTEM_DIR);
    expect(watch('ux-pattern')).toEqual(['src/ui/Button.tsx', PATHS.DESIGN_SYSTEM_DIR]);
    expect(watch('architecture-path')).toEqual(['src/ui/Button.tsx', 'src/ui/theme.ts']);
    expect(watch('workflow-or-tool')).toEqual(['src/ui/Button.tsx']);
    expect(watch('finding.triage')).toEqual(['src/ui/Button.tsx']);
  });
});
