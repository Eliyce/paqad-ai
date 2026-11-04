import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import YAML from 'yaml';

import { runSetup } from '@/cli/commands/git-workflow.js';
import { putGitWorkflowFile } from '@/dashboard/config-git-workflow.js';
import { applyChange } from '@/git-workflow/change.js';
import { gitWorkflowHealth } from '@/health/git-workflow-check.js';
import { OnboardingOrchestrator } from '@/onboarding/orchestrator.js';
import { FrameworkUpdater } from '@/update/index.js';

const DIR = '.paqad/configs/git-workflow';
const COMMITS = `${DIR}/commits.yaml`;
const POLICY = 'docs/instructions/workflows/delivery-policy.yaml';
const POLICY_TEXT = 'process:\n  pr:\n    draft: true\n';
const OTHERS = ['tickets.yaml', 'branches.yaml', 'pull-requests.yaml', 'enforcement.yaml'];

describe('a delivery move held back by a commit settings file', () => {
  let root: string;
  const put = (rel: string, text: string) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  };
  const read = (rel: string) => readFileSync(join(root, rel), 'utf8');
  const update = () => new FrameworkUpdater({ generateCandidates: async () => [] }).run(root);

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-blocked-move-'));
    put(
      '.paqad/project-profile.yaml',
      'project: { name: D, id: d, description: D }\nrouting: { domain: coding, stack: laravel, capabilities: [] }\ncommands: {}\ncompliance_packs: []\nactive_capabilities: [coding]\nmcp: { servers: [] }\ncustom: { classification_dimensions: [], verification_plugins: [], escalation_rules: [] }\n',
    );
    put(POLICY, POLICY_TEXT);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it.each([
    ['an unreadable stamp', 'schema_version: abc'],
    ['a higher stamp', 'schema_version: 2'],
  ])(
    'AC-18: with %s, creates no file, then moves the rules once the stamp is fixed',
    async (_name, stamp) => {
      put(COMMITS, `${stamp}\nai_attribution: keep\n`);

      await update();
      expect(read(COMMITS)).toBe(`${stamp}\nai_attribution: keep\n`);
      for (const file of OTHERS) expect(existsSync(join(root, DIR, file))).toBe(false);
      expect(read(POLICY)).toBe(POLICY_TEXT);

      const details = gitWorkflowHealth(root, () => true).map((result) => result.detail);
      expect(details.join('\n')).not.toContain('Delete it');
      expect(details.join('\n')).toContain(`${POLICY} hasn't moved yet, so keep it.`);
      expect(details.join('\n')).toContain('The move runs on the next paqad-ai update.');

      await update();
      for (const file of OTHERS) expect(existsSync(join(root, DIR, file))).toBe(false);

      put(COMMITS, 'schema_version: 1\nai_attribution: keep\n');
      await update();
      expect(existsSync(join(root, POLICY))).toBe(false);
      expect(YAML.parse(read(`${DIR}/pull-requests.yaml`))).toMatchObject({ draft: true });
      expect(YAML.parse(read(COMMITS))).toMatchObject({
        schema_version: 1,
        ai_attribution: 'keep',
      });
      const after = gitWorkflowHealth(root, () => true).map((result) => result.detail);
      expect(after.join('\n')).not.toContain(POLICY);
    },
  );

  it('AC-14: once the stamp is fixed and before update runs, doctor says keep it, and its advice clears it', async () => {
    put(COMMITS, 'schema_version: abc\n');
    await update();
    put(COMMITS, 'schema_version: 1\n');
    const details = gitWorkflowHealth(root, () => true).map((result) => result.detail);
    expect(details).toContain(
      `${POLICY} hasn't moved yet, so keep it. It holds your only copy of these rules. Run paqad-ai update to move them.`,
    );
    expect(details.join('\n')).not.toContain('Delete it');
    await update();
    expect(existsSync(join(root, POLICY))).toBe(false);
  });

  it('a commit file with real settings and a bad stamp is not a pending move: doctor says delete, and names the line', async () => {
    const text = 'schema_version: abc\nsign_off: true\n';
    put(COMMITS, text);
    const details = gitWorkflowHealth(root, () => true).map((result) => result.detail);
    const line = details.find((detail) => detail.includes(POLICY))!;
    expect(line).toContain(`${POLICY} is no longer read. Delete it.`);
    expect(line).toContain(`${COMMITS} has a schema_version or paqad_version line`);
    expect(line).not.toContain('The move runs');
    await update();
    expect(read(COMMITS)).toBe(text);
    expect(existsSync(join(root, DIR, 'tickets.yaml'))).toBe(true);
    expect(read(POLICY)).toBe(POLICY_TEXT);
  });

  const REFUSAL = `${POLICY} hasn't moved yet, so this wasn't changed. Run paqad-ai update first.`;
  const shell = { run: async () => ({ stdout: '', stderr: '', exitCode: 0 }) };

  describe.each([
    ['a higher stamp alone', 'schema_version: 2\n', 'was written by a newer paqad'],
    ['an unreadable old stamp', 'paqad_version: banana\n', "can't read"],
    ['no stamp problem', null, null],
  ])('while a move is pending, with %s', (_name, text, blockWords) => {
    function arrange(): void {
      if (text !== null) put(COMMITS, text);
    }

    async function expectNothingWrittenThenMoved(): Promise<void> {
      if (text === null) expect(existsSync(join(root, COMMITS))).toBe(false);
      else expect(read(COMMITS)).toBe(text);
      for (const file of OTHERS) expect(existsSync(join(root, DIR, file))).toBe(false);
      expect(read(POLICY)).toBe(POLICY_TEXT);
      if (text !== null) put(COMMITS, 'schema_version: 1\n');
      await update();
      expect(existsSync(join(root, POLICY))).toBe(false);
      expect(YAML.parse(read(`${DIR}/pull-requests.yaml`))).toMatchObject({ draft: true });
    }

    function expectNamed(message: string): void {
      expect(message).toContain(REFUSAL);
      if (blockWords !== null) {
        expect(message).toContain(blockWords);
        expect(message.indexOf(blockWords)).toBeLessThan(message.indexOf(REFUSAL));
      }
    }

    it('AC-18: a git workflow change refuses, and the rules move on the next update', async () => {
      arrange();
      const outcome = applyChange(root, [
        { file: 'enforcement.yaml', path: ['agents'], value: 'warn' },
      ]);
      expect(outcome.valid).toBe(false);
      expect(outcome.written).toEqual([]);
      expectNamed(outcome.errors.map((error) => error.message).join(' '));
      await expectNothingWrittenThenMoved();
    });

    it('AC-18: setup refuses even with overwrite, and the rules move on the next update', async () => {
      arrange();
      put('answers.json', '{"choices":{}}');
      const result = await runSetup({
        projectRoot: root,
        shell,
        answersFile: 'answers.json',
        overwrite: true,
      });
      expect(result.exitCode).toBe(1);
      const out = JSON.parse(result.stdout) as { error: string; written: string[] };
      expect(out.written).toEqual([]);
      expectNamed(out.error);
      await expectNothingWrittenThenMoved();
    });

    it('AC-18: a dashboard save refuses, and the rules move on the next update', async () => {
      arrange();
      let message = '';
      try {
        putGitWorkflowFile(root, 'enforcement.yaml', {
          content: 'enabled: false\n',
          baseHash: null,
        });
      } catch (error) {
        message = (error as Error).message;
      }
      expectNamed(message);
      await expectNothingWrittenThenMoved();
    });
  });

  it('a change still works once no move is pending', () => {
    put(`${DIR}/enforcement.yaml`, 'schema_version: 1\nenabled: true\nagents: block\n');
    rmSync(join(root, POLICY));
    const outcome = applyChange(root, [
      { file: 'enforcement.yaml', path: ['agents'], value: 'warn' },
    ]);
    expect(outcome.valid).toBe(true);
    expect(YAML.parse(read(`${DIR}/enforcement.yaml`))).toMatchObject({ agents: 'warn' });
  });

  it('with no block, doctor still says to delete a file the team has already moved past', () => {
    put(`${DIR}/enforcement.yaml`, 'schema_version: 1\nenabled: true\n');
    const details = gitWorkflowHealth(root, () => true).map((result) => result.detail);
    expect(details).toContain(`${POLICY} is no longer read. Delete it.`);
  });

  it('onboarding names the block and creates none of the files either', async () => {
    put(COMMITS, 'schema_version: abc\n');
    rmSync(join(root, '.paqad/project-profile.yaml'));
    const result = await new OnboardingOrchestrator().run({
      projectRoot: root,
      interactive: false,
      selections: { domain: 'coding', stack: 'laravel', capabilities: [] },
    });
    expect(result.warnings.join('\n')).toContain(`${COMMITS} has a schema_version`);
    expect(read(COMMITS)).toBe('schema_version: abc\n');
    for (const file of OTHERS) expect(existsSync(join(root, DIR, file))).toBe(false);
    expect(read(POLICY)).toBe(POLICY_TEXT);
  });
});
