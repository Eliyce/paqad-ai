import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createOnboardingCommand } from '../../../../src/cli/commands/onboarding.js';
import { nextStep } from '../../../../src/onboarding/journey/briefs.js';
import { readEvents } from '../../../../src/onboarding/journey/events.js';
import {
  STAGED_CHECKS_ROOT,
  installStagedCheck,
} from '../../../../src/onboarding/journey/install-check.js';
import { updateRun } from '../../../../src/onboarding/journey/run-store.js';
import { ONBOARDING_STAGES } from '../../../../src/onboarding/journey/stages.js';
import { loadRuleScriptMap, serializeRuleScriptMap } from '../../../../src/rule-scripts/map.js';
import { stageAgentWriteDecision } from '../../../../src/stage-isolation/bash-write-guard.js';

import { T0, clockAt, seedRun, tempRoot, writeFile } from './fixtures/journey.js';

const RULE = 'RL-7f3a';
const STAGED = `${STAGED_CHECKS_ROOT}coding/no-debugger.mjs`;
const INSTALLED = '.paqad/scripts/rules/coding/no-debugger.mjs';

const SCRIPT = [
  '// @paqad-rule-script',
  `// rule_id: ${RULE}`,
  '// source: docs/instructions/rules/coding/code-quality.md',
  '// kind: deterministic',
  '// scope: changed-files',
  '// runtime: node',
  "import { readFileSync } from 'node:fs';",
  "import { join } from 'node:path';",
  "const { projectRoot, files } = JSON.parse(readFileSync(0, 'utf8'));",
  'const findings = [];',
  'for (const f of files) {',
  "  const text = readFileSync(join(projectRoot, f), 'utf8');",
  "  if (text.includes('debugger')) findings.push({ file: f, line: 1, message: 'debugger', severity: 'blocker' });",
  '}',
  `process.stdout.write(JSON.stringify({ rule_id: '${RULE}', kind: 'deterministic', findings }));`,
  '',
].join('\n');

function stageCheck(root: string, failFixture = 'debugger;\n'): void {
  writeFile(root, STAGED, SCRIPT);
  writeFile(root, `${STAGED_CHECKS_ROOT}coding/no-debugger/__fixtures__/pass/a.ts`, 'ok;\n');
  writeFile(root, `${STAGED_CHECKS_ROOT}coding/no-debugger/__fixtures__/fail/b.ts`, failFixture);
}

describe('step 7 installs staged checks through the onboarding unit verb', () => {
  let root: string;

  beforeEach(() => {
    root = tempRoot('paqad-install-check-');
    seedRun(root);
    updateRun(root, (draft) => {
      for (const stage of ONBOARDING_STAGES) {
        if (stage.id === 'rule_scripts') break;
        draft.stages[stage.id] = { status: 'done' };
      }
      draft.stages.rule_scripts = { status: 'running', started_at: T0 };
    });
    writeFile(
      root,
      'docs/instructions/rules/rule-script-map.yml',
      serializeRuleScriptMap({
        schema_version: 1,
        generated_at: T0,
        rule_files_hash: 'h',
        rules: [
          {
            id: RULE,
            source: 'docs/instructions/rules/coding/code-quality.md',
            text: 'No debugger statements.',
            text_hash: 'h',
            verifiability: { kind: 'deterministic' },
            enforced_by: [],
            scripts: [],
          },
        ],
      } as never),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
    rmSync(root, { recursive: true, force: true });
  });

  function install(staged = STAGED) {
    return installStagedCheck(
      root,
      { staged, ruleId: RULE, kind: 'deterministic', scope: 'changed-files' },
      clockAt(5),
    );
  }

  it('copies a check whose fixtures pass into .paqad/scripts/rules/ and registers it', () => {
    stageCheck(root);
    const result = install();
    expect(result).toMatchObject({ installed: true, path: INSTALLED });
    expect(readFileSync(join(root, INSTALLED), 'utf8')).toBe(SCRIPT);
    expect(
      existsSync(join(root, '.paqad/scripts/rules/coding/no-debugger/__fixtures__/fail/b.ts')),
    ).toBe(true);
    const scripts = loadRuleScriptMap(root)?.rules[0]?.scripts ?? [];
    expect(scripts).toMatchObject([{ path: INSTALLED, fixtures_passed: true }]);
  });

  it('leaves a check whose fixtures fail staged and unregistered', () => {
    stageCheck(root, 'ok;\n');
    expect(install().installed).toBe(false);
    expect(existsSync(join(root, INSTALLED))).toBe(false);
    expect(loadRuleScriptMap(root)?.rules[0]?.scripts).toEqual([]);
  });

  it('refuses a check outside the staging folder or one that would rewrite a check', () => {
    stageCheck(root);
    writeFile(root, 'scripts/x.mjs', SCRIPT);
    expect(() => install('scripts/x.mjs')).toThrow(STAGED_CHECKS_ROOT);
    expect(() => install(`${STAGED_CHECKS_ROOT}../../../scripts/rules/x.mjs`)).toThrow('".."');
    writeFile(root, INSTALLED, 'export {};\n');
    expect(() => install()).toThrow('never rewrites an existing check');
  });

  it('FR-24: refuses when step 7 or the journey is not running, and a wrong kind or scope', () => {
    stageCheck(root);
    const call = (input: Partial<Parameters<typeof installStagedCheck>[1]>) =>
      installStagedCheck(
        root,
        { staged: STAGED, ruleId: RULE, kind: 'deterministic', scope: 'changed-files', ...input },
        clockAt(5),
      );
    expect(() => call({ kind: 'ai' })).toThrow('Use --kind deterministic or heuristic, not ai.');
    expect(() => call({ scope: 'repo' })).toThrow('Use --scope changed-files or whole-tree');
    updateRun(root, (draft) => void (draft.status = 'paused'));
    expect(() => call({})).toThrow('Step 7 (Write the rule checks) is not running.');
    updateRun(root, (draft) => {
      draft.status = 'running';
      draft.stages.rule_scripts = { status: 'done' };
    });
    expect(() => call({})).toThrow('Step 7 (Write the rule checks) is not running.');
  });

  it('FR-24: refuses a staged file that is not .mjs or is missing, a missing map and an unknown rule', () => {
    expect(() => install(`${STAGED_CHECKS_ROOT}coding/no-debugger.js`)).toThrow(
      'Stage the check as a .mjs file',
    );
    expect(() => install()).toThrow(`The staged check ${STAGED} does not exist.`);
    stageCheck(root);
    expect(() =>
      installStagedCheck(
        root,
        { staged: STAGED, ruleId: 'RL-none', kind: 'heuristic', scope: 'whole-tree' },
        clockAt(5),
      ),
    ).toThrow('Rule RL-none is not in the rule-script map.');
    rmSync(join(root, 'docs/instructions/rules/rule-script-map.yml'));
    expect(() => install()).toThrow('The rule-script map is missing; run step 6 first.');
  });

  it('installs again over a byte-identical check instead of refusing', () => {
    stageCheck(root);
    writeFile(root, INSTALLED, SCRIPT);
    expect(install()).toMatchObject({ installed: true, path: INSTALLED });
  });

  it('defers a check whose header needs a binary this machine lacks', () => {
    stageCheck(root);
    writeFile(
      root,
      STAGED,
      SCRIPT.replace(
        '// runtime: node',
        '// runtime: node\n// requires: {"binaries":["paqad-no-such-binary-xyz"]}',
      ),
    );
    const result = install();
    expect(result).toMatchObject({ installed: false, deferred: true });
    expect(result.fixtures.missing_binaries).toEqual(['paqad-no-such-binary-xyz']);
    expect(existsSync(join(root, INSTALLED))).toBe(false);
  });

  it('keeps a check with a broken header staged and names the header errors', () => {
    stageCheck(root);
    writeFile(root, STAGED, SCRIPT.replace('// @paqad-rule-script\n', ''));
    const result = install();
    expect(result.installed).toBe(false);
    expect(result.header_errors?.length).toBeGreaterThan(0);
    expect(existsSync(join(root, INSTALLED))).toBe(false);
  });

  it('`unit rule_scripts <rule> --install-check` installs the check and records the unit', async () => {
    stageCheck(root);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await createOnboardingCommand({ now: clockAt(5) }).parseAsync(
      [
        'unit',
        'rule_scripts',
        RULE,
        '--install-check',
        STAGED,
        '--kind',
        'deterministic',
        '--scope',
        'changed-files',
        '--project-root',
        root,
      ],
      { from: 'user' },
    );
    expect(process.exitCode ?? 0).toBe(0);
    expect(existsSync(join(root, INSTALLED))).toBe(true);
    expect(
      readEvents(root).some(
        (event) => event.kind === 'unit' && event.stage === 'rule_scripts' && event.unit === RULE,
      ),
    ).toBe(true);
  });

  it('keeps .paqad/scripts/rules/ closed to the scripts agent and opens the staging folder', () => {
    const blocked = (target: string) =>
      stageAgentWriteDecision({
        projectRoot: root,
        agentType: 'paqad-onboarding-scripts',
        toolName: 'Write',
        targets: [join(root, target)],
      }).blocked;
    expect(blocked(INSTALLED)).toBe(true);
    expect(blocked(STAGED)).toBe(false);
  });

  it('the step 7 brief stages checks and installs them with the unit verb', () => {
    const brief = nextStep(root, clockAt(6)).brief;
    expect(brief).toContain(STAGED_CHECKS_ROOT);
    expect(brief).toContain('paqad-ai onboarding unit rule_scripts <rule-id> --install-check');
    expect(brief).toContain('paqad-ai rules compile');
    expect(brief).not.toContain('install it only through register-script.mjs');
  });
});
