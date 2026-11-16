import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildDecisionPauseContractBody } from '../../../../src/onboarding/decision-pause-contract-writer.js';
import {
  AUTO_SIGNAL,
  BRIEF_CEILING,
  gitWorkflowAnswersPath,
  nextStep,
} from '../../../../src/onboarding/journey/briefs.js';
import { updateRun } from '../../../../src/onboarding/journey/run-store.js';
import { gitWorkflowHashes } from '../../../../src/onboarding/journey/setup.js';
import { ONBOARDING_STAGES } from '../../../../src/onboarding/journey/stages.js';

import { at, clockAt, moduleMap, seedRun, tempRoot, writeFile } from './fixtures/journey.js';

const CARVE_OUT_SKILLS = [
  'documentation-workflow',
  'git-workflow',
  'rules-discovery',
  'rules-proposer',
  'rule-analyzer',
  'rule-script-generator',
  'rule-script-reconciler',
];

function skill(name: string): string {
  return readFileSync(join(process.cwd(), 'runtime/base/skills', name, 'SKILL.md'), 'utf8');
}

describe('onboarding stage briefs', () => {
  let root: string;

  beforeEach(() => {
    root = tempRoot();
    writeFile(root, '.paqad/framework-path.txt', '/opt/paqad-ai\n');
    seedRun(root, {
      owner_session: 'owner-1',
      setup_hashes: { '.paqad/configs/git-workflow/branches.yaml': 'old' },
    });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function runningAt(stage: (typeof ONBOARDING_STAGES)[number]['id'], plan?: string[]): void {
    updateRun(root, (draft) => {
      for (const before of ONBOARDING_STAGES) {
        if (before.id === stage) break;
        draft.stages[before.id] = { status: 'done' };
      }
      draft.stages[stage] = { status: 'running', started_at: at(1), ...(plan ? { plan } : {}) };
    });
  }

  it('FR-22: the docs brief carries SE_SESSION, the areas still to do and the re-read step', () => {
    runningAt('project_docs', ['stack', 'architecture']);
    const brief = nextStep(root, clockAt(2)).brief;
    expect(brief).toContain('SE_SESSION=owner-1');
    expect(brief).toContain('- stack\n- architecture');
    expect(brief).toContain('re-read docs/stack/ and docs/design-system/');
    expect(brief).toContain('entry sentinel is stamped fresh');
    expect(brief).toContain('keep them as they are');
    expect(brief).toContain(AUTO_SIGNAL);
  });

  it('applies the git workflow only when the files still match setup', () => {
    writeFile(root, '.paqad/configs/git-workflow/branches.yaml', 'x');
    runningAt('project_docs');
    updateRun(root, (draft) => {
      draft.setup_hashes = gitWorkflowHashes(root);
    });
    const brief = nextStep(root, clockAt(2)).brief;
    const answers = gitWorkflowAnswersPath();
    expect(answers.startsWith(root)).toBe(false);
    expect(brief).toContain(`write the empty answers \`{}\` to ${answers}`);
    expect(brief).toContain(`git-workflow setup --apply ${answers} --overwrite`);
    expect(brief).not.toContain('--apply {}');
  });

  it('the step 5 brief dispatches the rules agent', () => {
    runningAt('rules_discovery');
    const brief = nextStep(root, clockAt(2)).brief;
    expect(brief).toContain('Dispatch the paqad-onboarding-rules agent');
    expect(brief).not.toContain('Export SE_SESSION');
  });

  it('the analyze brief batches by 25 with progress calls and absolute script paths', () => {
    runningAt('rules_analyze');
    const brief = nextStep(root, clockAt(2)).brief;
    expect(brief).toContain('batches of 25');
    expect(brief).toContain('paqad-ai onboarding progress rules_analyze');
    expect(brief).toContain('/opt/paqad-ai/runtime/base/skills/rule-analyzer/scripts');
  });

  it('stays under the 27k ceiling with a very long list of units', () => {
    const slugs = Array.from({ length: 3000 }, (_, i) => `module-with-a-long-name-${i}`);
    writeFile(root, 'docs/instructions/rules/module-map.yml', moduleMap(slugs.slice(0, 2)));
    runningAt('module_docs', slugs);
    const brief = nextStep(root, clockAt(2)).brief;
    expect(brief.length).toBeLessThanOrEqual(BRIEF_CEILING);
    expect(brief).toContain('paqad-ai onboarding stage end module_docs');
  });

  it('names the commit question once every step is done', () => {
    updateRun(root, (draft) => {
      for (const stage of ONBOARDING_STAGES) draft.stages[stage.id] = { status: 'done' };
    });
    const step = nextStep(root, clockAt(2));
    expect(step.done).toBe(true);
    expect(step.brief).toContain('Commit these changes on a new branch?');
  });
});

describe('auto-recommended carve-outs', () => {
  it.each(CARVE_OUT_SKILLS)(
    'NFR-5: %s asks as today unless the brief carries the journey signal',
    (name) => {
      const text = skill(name);
      expect(text).toContain('## Onboarding Journey');
      expect(text).toContain(`"${AUTO_SIGNAL}"`);
      expect(text).toContain('Without that line, ask as you always do.');
    },
  );

  it('NFR-5: the decision-pause contract carries the same carve-out', () => {
    expect(buildDecisionPauseContractBody()).toContain(`"${AUTO_SIGNAL}"`);
  });

  it('FR-8 FR-9: the driver skill loops next and never restates the step words', () => {
    const text = skill('onboarding-journey');
    expect(text).toContain('paqad-ai onboarding next');
    expect(text).toContain('view.json');
    for (const stage of ONBOARDING_STAGES.slice(1)) expect(text).not.toContain(stage.name);
  });
});
