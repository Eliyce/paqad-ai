import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import YAML from 'yaml';

import { syncTeamSetup } from '@/adapters/claude/team-setup.js';
import {
  CATALOG_VERSION,
  checkoutIsNewer,
  FRAMEWORK_CONFIG_SPECS,
  generateConfigExample,
  writeConfigExample,
  writeConfigsReadme,
} from '@/core/framework-config.js';
import {
  renderTeamConfigFile,
  setTeamConfigValue,
  syncTeamConfigFiles,
  writeTeamYamlValue,
} from '@/core/team-config.js';
import { migrateTeamConfig } from '@/core/team-config-migrate.js';
import { runCheck, runSetup } from '@/cli/commands/git-workflow.js';
import { putGitWorkflowFile } from '@/dashboard/config-git-workflow.js';
import { applyChange } from '@/git-workflow/change.js';
import { stampLastApplied } from '@/git-workflow/last-applied.js';
import { gitWorkflowHealth } from '@/health/git-workflow-check.js';
import { migrateDeliveryPolicy, OLD_DELIVERY_POLICY } from '@/git-workflow/migrate.js';
import { FrameworkUpdater } from '@/update/index.js';
import { syncGitWorkflow } from '@/git-workflow/sync.js';

const MODELS = '.paqad/configs/models.yaml';
const NEWER_LINE = (file: string) =>
  `${file} was written by a newer paqad, so it wasn't changed. Update paqad-ai.`;

describe('AC-24 and INV-4: a file with a higher integer through every writer', () => {
  let root: string;
  const put = (rel: string, text: string) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  };
  const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-team-writers-'));
    mkdirSync(join(root, '.paqad/configs'), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('syncTeamConfigFiles', () => {
    put(MODELS, 'schema_version: 2\n');
    const problems: string[] = [];
    syncTeamConfigFiles(root, problems);
    expect(read(MODELS)).toBe('schema_version: 2\n');
    expect(problems).toContain(NEWER_LINE(MODELS));
  });

  it('writeTeamYamlValue, for an own file and for the commit settings', () => {
    put(MODELS, 'schema_version: 2\n');
    expect(() => writeTeamYamlValue(root, 'models.yaml', ['models', 'x'], 'y')).toThrow(
      NEWER_LINE(MODELS),
    );
    const commits = '.paqad/configs/git-workflow/commits.yaml';
    put(commits, 'schema_version: 2\n');
    expect(() =>
      writeTeamYamlValue(root, 'git-workflow/commits.yaml', ['ai_attribution'], 'keep'),
    ).toThrow(NEWER_LINE(commits));
    expect(read(commits)).toBe('schema_version: 2\n');
  });

  it('migrateTeamConfig stops, names the file and keeps the old settings', () => {
    const evidence = '.paqad/configs/feature-development/evidence.yaml';
    put(evidence, 'schema_version: 2\n');
    put('.paqad/configs/.config.app', 'enterprise=true\n');
    const result = migrateTeamConfig(root, { version: '1.120.0' });
    expect(read(evidence)).toBe('schema_version: 2\n');
    expect(read('.paqad/configs/.config.app')).toBe('enterprise=true\n');
    expect(result.lines).toEqual([NEWER_LINE(evidence)]);
  });

  it('syncGitWorkflow', () => {
    const file = '.paqad/configs/git-workflow/enforcement.yaml';
    put(file, 'schema_version: 2\nenabled: true\n');
    const notes: string[] = [];
    syncGitWorkflow(root, { notes, baseBranch: 'main' });
    expect(read(file)).toBe('schema_version: 2\nenabled: true\n');
    expect(notes).toEqual([NEWER_LINE(file)]);
  });

  it('applyChange refuses and names the file', () => {
    const file = '.paqad/configs/git-workflow/enforcement.yaml';
    const text = 'schema_version: 2\nenabled: true\nagents: warn\n';
    put(file, text);
    const outcome = applyChange(root, [
      { file: 'enforcement.yaml', path: ['agents'], value: 'block' },
    ]);
    expect(outcome.valid).toBe(false);
    expect(outcome.written).toEqual([]);
    expect(outcome.errors.map((error) => error.message)).toContain(NEWER_LINE(file));
    expect(read(file)).toBe(text);
  });

  it('AC-24: migrateDeliveryPolicy stops and names a newer file that holds only known keys', () => {
    const commits = '.paqad/configs/git-workflow/commits.yaml';
    const text = 'schema_version: 2\nai_attribution: keep\n';
    put(commits, text);
    put(OLD_DELIVERY_POLICY, 'branch:\n  base: main\n');
    const result = migrateDeliveryPolicy(root, { baseBranch: 'main', version: '1.120.0' });
    expect(result).toEqual({
      ran: false,
      lines: [NEWER_LINE(commits)],
      written: [],
      deleted: false,
    });
    expect(read(commits)).toBe(text);
    expect(read(OLD_DELIVERY_POLICY)).toBe('branch:\n  base: main\n');
  });

  it('AC-24: an update names that file once', async () => {
    const commits = '.paqad/configs/git-workflow/commits.yaml';
    put(commits, 'schema_version: 2\nai_attribution: keep\n');
    put(OLD_DELIVERY_POLICY, 'branch:\n  base: main\n');
    put(
      '.paqad/project-profile.yaml',
      'project: { name: D, id: d, description: D }\nrouting: { domain: coding, stack: laravel, capabilities: [] }\ncommands: {}\ncompliance_packs: []\nactive_capabilities: [coding]\nmcp: { servers: [] }\ncustom: { classification_dimensions: [], verification_plugins: [], escalation_rules: [] }\n',
    );
    const report = await new FrameworkUpdater({ generateCandidates: async () => [] }).run(root);
    expect(read(commits)).toBe('schema_version: 2\nai_attribution: keep\n');
    expect(
      (report.git_workflow_notes ?? []).filter((note) => note === NEWER_LINE(commits)),
    ).toHaveLength(1);
  });

  it('AC-24: the git workflow setup refuses to overwrite it', async () => {
    const file = '.paqad/configs/git-workflow/enforcement.yaml';
    put(file, 'schema_version: 2\nenabled: true\n');
    put('answers.json', '{"choices":{}}');
    const result = await runSetup({
      projectRoot: root,
      answersFile: 'answers.json',
      overwrite: true,
      shell: { run: async () => ({ stdout: '', stderr: '', exitCode: 0 }) },
    } as never);
    expect(result.exitCode).toBe(1);
    expect(read(file)).toBe('schema_version: 2\nenabled: true\n');
    expect(result.stdout).toContain(NEWER_LINE(file));
  });

  it('AC-24: the dashboard refuses to save it', () => {
    const file = '.paqad/configs/git-workflow/enforcement.yaml';
    put(file, 'schema_version: 2\nenabled: true\n');
    expect(() =>
      putGitWorkflowFile(root, 'enforcement.yaml', { content: 'enabled: false\n' } as never),
    ).toThrow(NEWER_LINE(file));
    expect(read(file)).toBe('schema_version: 2\nenabled: true\n');
  });

  it('catalog_version keeps the catalog and README, and no equal build writes a different byte', () => {
    const higher = generateConfigExample().replace(
      `# catalog_version: ${CATALOG_VERSION}`,
      `# catalog_version: ${CATALOG_VERSION + 1}`,
    );
    put('.paqad/.config.example', higher);
    put('.paqad/configs/README.md', 'newer readme\n');
    expect(checkoutIsNewer(root)).toBe(true);
    writeConfigExample(root);
    writeConfigsReadme(root);
    expect(read('.paqad/.config.example')).toBe(higher);
    expect(read('.paqad/configs/README.md')).toBe('newer readme\n');

    put('.paqad/.config.example', generateConfigExample());
    writeConfigExample(root);
    expect(read('.paqad/.config.example')).toBe(generateConfigExample());
  });

  it('LAUNCHER_REVISION keeps the launcher', () => {
    put('.paqad/hook.mjs', 'export const LAUNCHER_REVISION = 99;\n');
    expect(syncTeamSetup(root, {}).kept).toContain('.paqad/hook.mjs');
    expect(read('.paqad/hook.mjs')).toBe('export const LAUNCHER_REVISION = 99;\n');
  });
});

describe('AC-21: a malformed stamp through the writers', () => {
  let root: string;
  const put = (rel: string, text: string) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  };
  const read = (rel: string) => readFileSync(join(root, rel), 'utf8');
  const unreadable = (file: string) =>
    `${file} has a schema_version or paqad_version line paqad can't read, so it wasn't changed. Fix that line, then try again.`;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-team-writers-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it.each([
    ['a quoted number', 'schema_version: "2"\n'],
    ['text', 'schema_version: abc\n'],
    ['zero', 'schema_version: 0\n'],
    ['a text old stamp', 'paqad_version: banana\n'],
  ])('AC-21: config set refuses %s and names the file', (_name, text) => {
    put(MODELS, text);
    expect(() => setTeamConfigValue(root, 'model_default', 'x')).toThrow(unreadable(MODELS));
    expect(read(MODELS)).toBe(text);
  });

  it('AC-21: the delivery move leaves a commit file with an unreadable stamp and names it', () => {
    const commits = '.paqad/configs/git-workflow/commits.yaml';
    put(commits, 'schema_version: abc\n');
    put(OLD_DELIVERY_POLICY, 'branch:\n  base: main\n');
    const result = migrateDeliveryPolicy(root, { baseBranch: 'main', version: '1.120.0' });
    expect(result).toEqual({
      ran: false,
      lines: [unreadable(commits)],
      written: [],
      deleted: false,
    });
    expect(read(commits)).toBe('schema_version: abc\n');
    expect(read(OLD_DELIVERY_POLICY)).toBe('branch:\n  base: main\n');
  });

  it('AC-21: the migration stops and names the file, and keeps the old settings', () => {
    const retrieval = '.paqad/configs/retrieval.yaml';
    put(retrieval, 'schema_version: abc\n');
    put('.paqad/configs/.config.rag', 'rag_top_n=9\n');
    const result = migrateTeamConfig(root, { version: '1.120.0' });
    expect(result.lines).toEqual([unreadable(retrieval)]);
    expect(read(retrieval)).toBe('schema_version: abc\n');
    expect(read('.paqad/configs/.config.rag')).toBe('rag_top_n=9\n');
  });

  it('AC-21: update leaves the line, and a value in the commit settings keeps it too', () => {
    put(MODELS, 'schema_version: abc\n');
    syncTeamConfigFiles(root);
    expect(read(MODELS)).toBe('schema_version: abc\n');
    const commits = '.paqad/configs/git-workflow/commits.yaml';
    put(commits, 'schema_version: abc\nai_attribution: keep\n');
    writeTeamYamlValue(root, 'git-workflow/commits.yaml', ['ai_attribution'], 'strip');
    expect(read(commits)).toBe('schema_version: abc\nai_attribution: strip\n');
  });
});

describe('AC-14: the changed-outside warning clears by doing what it says', () => {
  it('AC-14: goes from doctor to the remedy and back to a clean doctor', () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-team-writers-'));
    try {
      const commits = join(root, '.paqad/configs/git-workflow/commits.yaml');
      mkdirSync(dirname(commits), { recursive: true });
      writeFileSync(commits, 'schema_version: 1\nsign_off: false\n');
      stampLastApplied(root);
      expect(gitWorkflowHealth(root, () => true)[0]!.status).toBe('pass');
      writeFileSync(commits, 'schema_version: 1\nsign_off: true\n');
      const warned = gitWorkflowHealth(root, () => true);
      expect(warned).toHaveLength(1);
      expect(warned[0]!.detail).toContain(
        'commits.yaml was changed outside the git-workflow skill',
      );
      expect(runCheck(root, true).exitCode).toBe(0);
      expect(gitWorkflowHealth(root, () => true)[0]!.status).toBe('pass');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
  'AC-22: a write failure on one file',
  () => {
    let root: string;
    const put = (rel: string, text: string) => {
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      writeFileSync(join(root, rel), text);
    };
    const read = (rel: string) => readFileSync(join(root, rel), 'utf8');
    const SAFETY = '.paqad/configs/feature-development/safety.yaml';
    const DECISIONS = '.paqad/configs/decisions.yaml';

    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), 'paqad-team-writers-'));
    });

    afterEach(() => {
      chmodSync(join(root, '.paqad/configs/feature-development'), 0o755);
      rmSync(root, { recursive: true, force: true });
    });

    it('AC-22: an own team file is named, the others swap, and the next run finishes', () => {
      syncTeamConfigFiles(root);
      for (const rel of [MODELS, DECISIONS]) {
        put(rel, read(rel).replace('schema_version: 1', 'paqad_version: "1.119.0"'));
      }
      chmodSync(join(root, MODELS), 0o444);
      const notes: string[] = [];
      expect(() => syncTeamConfigFiles(root, notes)).not.toThrow();
      expect(notes).toHaveLength(1);
      expect(notes[0]).toMatch(/^Couldn't write \.paqad\/configs\/models\.yaml: .*next update/u);
      expect(read(DECISIONS)).toContain('schema_version: 1');
      expect(read(MODELS)).toContain('paqad_version');
      chmodSync(join(root, MODELS), 0o644);
      expect(syncTeamConfigFiles(root)).toEqual([join(root, MODELS)]);
      expect(read(MODELS)).not.toContain('paqad_version');
      expect(syncTeamConfigFiles(root)).toEqual([]);
    });

    it('AC-22: a safety file with team notes that cannot be written is named, and the next run finishes', () => {
      syncTeamConfigFiles(root);
      put(SAFETY, 'paqad_version: "1.117.0"\n# Ask Sam first.\n');
      chmodSync(join(root, SAFETY), 0o444);
      const notes: string[] = [];
      syncTeamConfigFiles(root, notes);
      expect(notes).toHaveLength(1);
      expect(notes[0]).toContain(`Couldn't change ${SAFETY}: `);
      chmodSync(join(root, SAFETY), 0o644);
      const next: string[] = [];
      syncTeamConfigFiles(root, next);
      expect(read(SAFETY)).toBe('schema_version: 1\n# Ask Sam first.\n');
      expect(next[0]).toContain('holds notes your team wrote');
    });

    it('AC-22: a safety file that cannot be deleted is named, and the next run finishes', () => {
      syncTeamConfigFiles(root);
      put(SAFETY, 'schema_version: 1\n');
      chmodSync(join(root, '.paqad/configs/feature-development'), 0o555);
      const notes: string[] = [];
      syncTeamConfigFiles(root, notes);
      expect(notes).toHaveLength(1);
      expect(notes[0]).toContain(`Couldn't change ${SAFETY}: `);
      chmodSync(join(root, '.paqad/configs/feature-development'), 0o755);
      const next: string[] = [];
      syncTeamConfigFiles(root, next);
      expect(next).toEqual([`Removed ${SAFETY}, which paqad doesn't read any more.`]);
    });
  },
);

describe('what an update may change in a team file', () => {
  let root: string;
  const retired = FRAMEWORK_CONFIG_SPECS.find(
    (spec) => spec.yaml?.retiredValues !== undefined && spec.yaml.retiredValues.size > 0,
  )!;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-team-writers-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('AC-20: a retired value changes only that value line, whatever else is in the file', () => {
    const [oldValue, newValue] = [...retired.yaml!.retiredValues!.entries()][0]!;
    syncTeamConfigFiles(root);
    const path = join(root, '.paqad/configs', retired.file);
    const document = YAML.parseDocument(renderTeamConfigFile(retired.file, null));
    document.setIn([...retired.path], oldValue);
    const live = renderTeamConfigFile(retired.file, document).replace(
      '# Inside a group',
      '#  An odd   team   comment\n# Inside a group',
    );
    writeFileSync(path, live);
    const notes: string[] = [];
    syncTeamConfigFiles(root, notes);
    const leaf = retired.path[retired.path.length - 1];
    const before = live.split('\n');
    const after = readFileSync(path, 'utf8').split('\n');
    const changed = before.filter((line, index) => line !== after[index]);
    expect(changed).toHaveLength(1);
    expect(changed[0]).toContain(`${leaf}:`);
    expect(after).toHaveLength(before.length);
    expect(readFileSync(path, 'utf8')).toContain(String(newValue));
    expect(notes).toHaveLength(1);
    expect(syncTeamConfigFiles(root)).toEqual([]);
  });

  it('FR-43: the old first line updates once, and an old rendered file still reads as rendered', () => {
    syncTeamConfigFiles(root);
    const path = join(root, '.paqad/configs/models.yaml');
    const current = readFileSync(path, 'utf8');
    expect(current).toContain(
      "Settings added later aren't listed here. See .paqad/.config.example or run paqad-ai config show.",
    );
    const old = current
      .replace(
        /^# To change a setting.*$/mu,
        "# Every setting is listed with paqad's default. To change one, remove the # in front of it.",
      )
      .replace('schema_version: 1', 'paqad_version: "1.119.0"');
    writeFileSync(path, old);
    syncTeamConfigFiles(root);
    expect(readFileSync(path, 'utf8')).toBe(current);
    expect(renderTeamConfigFile('models.yaml', YAML.parseDocument(old))).toBe(
      renderTeamConfigFile('models.yaml', YAML.parseDocument(current)),
    );
  });
});
