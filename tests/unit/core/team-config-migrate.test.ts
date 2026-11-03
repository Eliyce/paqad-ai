import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import YAML from 'yaml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import {
  FRAMEWORK_CONFIG_SPECS,
  layeredConfigMap,
  parseDotConfig,
  resolveFrameworkConfig,
} from '@/core/framework-config.js';
import {
  DRY_RUN_LINE,
  MIGRATE_ONCE_LINE,
  MIGRATION_DONE_LINE,
  migrateTeamConfig,
  NOTHING_TO_MOVE_LINE,
  readSetLines,
  teamConfigMigrationNeeded,
} from '@/core/team-config-migrate.js';
import { renderTeamConfigFile } from '@/core/team-config.js';
import { isMigratedStub } from '@/core/team-config-legacy.js';
import {
  checkYamlValue,
  fromYamlValue,
  TEAM_CONFIG_FILES,
  toYamlValue,
} from '@/core/team-config-values.js';
import { loadFeatureDevelopmentPolicy } from '@/pipeline/feature-development-policy.js';
import { featureDevelopmentViewPath } from '@/pipeline/feature-development-view.js';

const FIXTURES = join(__dirname, '../../fixtures/team-config');
const PROJECTS = ['project-a', 'project-b', 'project-c', 'project-d'] as const;
const VERSION = '1.117.0';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'team-config-migrate-'));
});

afterEach(() => {
  chmodSync(root, 0o755);
  rmSync(root, { recursive: true, force: true });
});

function useFixture(name: string): void {
  cpSync(join(FIXTURES, name), root, { recursive: true });
  mkdirSync(join(root, '.paqad'), { recursive: true });
  writeFileSync(join(root, PATHS.PROJECT_PROFILE), 'active_capabilities:\n  - coding\n');
}

function configs(rel: string): string {
  return readFileSync(join(root, PATHS.PROJECT_CONFIGS_DIR, rel), 'utf8');
}

function snapshot(): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else out[relative(root, path)] = readFileSync(path, 'utf8');
    }
  };
  walk(root);
  return out;
}

function settingLines(lines: string[]): string[] {
  return lines.filter((line) => line.includes(' → '));
}

describe('the rendered team files after migration (FR-14, AC-30)', () => {
  for (const name of PROJECTS) {
    it(`${name}: every own team file is the render of its live values`, () => {
      useFixture(name);
      expect(migrateTeamConfig(root, { version: VERSION }).error).toBeUndefined();
      for (const file of TEAM_CONFIG_FILES) {
        const text = configs(file);
        expect(text, file).toBe(renderTeamConfigFile(file, YAML.parseDocument(text), VERSION));
        expect(text.split('\n')[0], file).not.toMatch(/yaml-language-server/u);
      }
    });
  }
});

describe('the four fixture projects', () => {
  for (const name of PROJECTS) {
    it(`${name}: moves every set value and resolves to the same flat values (AC-47, AC-72)`, () => {
      useFixture(name);
      const before = layeredConfigMap(root, {});
      const resolvedBefore = JSON.stringify(resolveFrameworkConfig(root, {}));
      const result = migrateTeamConfig(root, { version: VERSION });
      expect(result.ran).toBe(true);
      expect(result.error).toBeUndefined();
      const after = layeredConfigMap(root, {});
      for (const [key, value] of before) {
        if (key === 'rule_compliance' && name === 'project-b') continue;
        if (key === 'legacy_flag') continue;
        const spec = FRAMEWORK_CONFIG_SPECS.find((row) => row.key === key)!;
        if (checkYamlValue(spec, toYamlValue(spec, value)) !== null) {
          expect([key, after.get(key)]).toEqual([key, undefined]);
          continue;
        }
        const flat = spec.yaml?.list ? fromYamlValue(spec, toYamlValue(spec, value)) : value;
        expect([key, after.get(key)]).toEqual([key, flat]);
      }
      if (name !== 'project-b') {
        expect(JSON.stringify(resolveFrameworkConfig(root, {}))).toBe(resolvedBefore);
      }
      for (const old of ['.config.rag', '.config.models', '.config.policy']) {
        expect(existsSync(join(root, PATHS.PROJECT_CONFIGS_DIR, old))).toBe(false);
      }
      expect(isMigratedStub(configs('.config.app'))).toBe(true);
      for (const file of TEAM_CONFIG_FILES) {
        expect(existsSync(join(root, PATHS.PROJECT_CONFIGS_DIR, file))).toBe(true);
      }
      expect(result.lines.at(-2)).toBe(MIGRATE_ONCE_LINE);
      expect(result.lines.at(-1)).toBe(MIGRATION_DONE_LINE);
    });
  }

  it('project-a: writes sparse YAML with only the set lines, and drops generated comments (AC-60, AC-72)', () => {
    useFixture('project-a');
    const result = migrateTeamConfig(root, { version: VERSION });
    const evidence = configs('feature-development/evidence.yaml');
    expect(YAML.parse(evidence)).toEqual({
      paqad_version: VERSION,
      enterprise: { enabled: true, ledger: true },
      legacy_existence_check: 'strict',
    });
    expect(evidence).not.toContain('(env:');
    expect(evidence).not.toContain('──');
    expect(configs('retrieval.yaml')).toContain(
      '# Retrieval\n# Loads relevant code and docs into context through search.\nenabled: true',
    );
    expect(settingLines(result.lines)).toEqual([
      'enterprise → feature-development/evidence.yaml: enterprise.enabled = true',
      'enterprise_evidence_ledger → feature-development/evidence.yaml: enterprise.ledger = true',
      'market_research → feature-development/workflow.yaml: stages.planning.research.market = true',
      'site_map → paqad.yaml: site_map.enabled = true',
      'stages_mode → feature-development/workflow.yaml: stage_tracking = block',
      'rule_compliance → feature-development/rules.yaml: enforcement = block',
      'evidence_existence_gate → feature-development/evidence.yaml: legacy_existence_check = strict',
      'spec_pipeline_token_ceiling → feature-development/specification.yaml: pipeline.max_tokens = 60000',
      'rag_enabled → retrieval.yaml: enabled = true',
      'rag_embedding_provider → retrieval.yaml: embeddings.provider = local',
    ]);
    const kept = Object.values(snapshot())
      .join('\n')
      .split('\n')
      .filter((line) => /^[a-z_.]+:/u.test(line) && !line.startsWith('paqad_version'));
    expect(kept.length).toBeLessThanOrEqual(24);
  });

  it('project-b: carries the workflow file per section 4.2 and prints each line (AC-48, AC-60, AC-62)', () => {
    useFixture('project-b');
    const result = migrateTeamConfig(root, { version: VERSION });
    expect(result.lines).toContain(
      "Carried this planning instruction from the old workflow file; delete it from feature-development/workflow.yaml if it is a stale copy of paqad's own: Check the payments module owner before changing invoices.",
    );
    expect(result.lines).toContain(
      "Carried this development instruction from the old workflow file; delete it from feature-development/workflow.yaml if it is a stale copy of paqad's own: Run the payments contract tests before review.",
    );
    expect(result.lines.join('\n')).not.toContain(
      "instruction from the old workflow file; delete it from feature-development/workflow.yaml if it is a stale copy of paqad's own: Implement only the requested",
    );
    expect(result.lines).toContain(
      "stages.development.escalation.scope_expansion was set in the old workflow file but paqad never used it, so it wasn't carried over.",
    );
    expect(result.lines).toContain(
      'rule_compliance was also set in the workflow file; kept strict from there.',
    );
    expect(YAML.parse(configs('feature-development/workflow.yaml'))).toMatchObject({
      stages: {
        planning: {
          read: ['docs/architecture/**'],
          instructions: ['Check the payments module owner before changing invoices.'],
          module_attribution: 'stop',
        },
        development: { instructions: ['Run the payments contract tests before review.'] },
      },
    });
    const checksYaml = YAML.parse(configs('feature-development/checks.yaml'));
    expect(checksYaml).toMatchObject({
      commands: { extra: { 'command-1': 'npm --prefix frontend run lint:js' } },
      on_failure: 'warn',
    });
    expect(checksYaml.commands.from_project_profile).toBeUndefined();
    expect(YAML.parse(configs('feature-development/rules.yaml')).enforcement).toBe('block');
    expect(layeredConfigMap(root, {}).get('rule_compliance')).toBe('strict');
    expect(existsSync(featureDevelopmentViewPath(root))).toBe(false);
    expect(result.deleted).toContain('docs/instructions/workflows/feature-development.yaml');
    expect(result.replaced).not.toContain('docs/instructions/workflows/feature-development.yaml');
    expect(result.lines).toContain('Deleted docs/instructions/workflows/feature-development.yaml');
    const policy = loadFeatureDevelopmentPolicy(root).policy;
    expect(policy.stages.development.instructions.at(-1)).toBe(
      'Run the payments contract tests before review.',
    );
    expect(policy.stages.checks.checks?.commands).toEqual(['format', 'test', 'build']);
    expect(policy.stages.checks.checks?.block_on_failure).toBe(false);
    expect(policy.stages.checks.checks?.shell_commands).toEqual([
      'npm --prefix frontend run lint:js',
    ]);
  });

  it('project-c: prints the duplicate and unknown key lines and writes them into the stub (AC-48, AC-62)', () => {
    useFixture('project-c');
    const result = migrateTeamConfig(root, { version: VERSION });
    expect(result.lines).toContain(
      'mutation_mode was set in .config.policy and .config.rag; kept off from .config.rag.',
    );
    expect(result.lines).toContain(
      "legacy_flag=yes in .config.app isn't a paqad setting, so it wasn't carried over.",
    );
    expect(configs('.config.app')).toBe(
      [
        '# paqad-migrated-stub',
        "# This project's paqad settings moved to the YAML files in this folder.",
        "# The lines below are for an older paqad, which can't read the YAML files: it turns itself off",
        '# instead of running on its defaults, and asks to update. A current paqad ignores this file.',
        'paqad_enable=false',
        'minimum_version=9.9.0',
        '# Not carried over (not paqad settings):',
        '# legacy_flag=yes',
        '',
      ].join('\n'),
    );
    expect(configs('paqad.yaml')).toContain(
      '\nupdates:\n  # Pulls newer paqad versions in the background when a session starts.\n  # automatic: true\n  # Pinned because CI images lag behind.\n  # The lowest paqad version this project runs on, where latest always tracks the newest version.\n  minimum_version: 9.9.0',
    );
    expect(YAML.parse(configs('feature-development/checks.yaml')).mutation_testing).toBe('off');
    expect(configs('feature-development/checks.yaml')).not.toContain('too noisy');
  });

  it('project-d: translates values into the YAML vocabulary', () => {
    useFixture('project-d');
    migrateTeamConfig(root, { version: VERSION });
    expect(YAML.parse(configs('feature-development/checks.yaml'))).toMatchObject({
      max_processes: 'auto',
      flaky_tests: 'block',
    });
    expect(YAML.parse(configs('feature-development/specification.yaml'))).toMatchObject({
      experts: { standing: ['product-owner', 'qa-engineer'] },
    });
    expect(YAML.parse(configs('git-workflow/commits.yaml'))).toMatchObject({
      ai_attribution: 'keep',
    });
    expect(YAML.parse(configs('decisions.yaml'))).toMatchObject({ ask: 'rarely' });
    expect(configs('.config.app')).toContain(`minimum_version=${VERSION}`);
  });
});

describe('dry run, idempotence and failure', () => {
  it('a dry run writes nothing and prints the same setting lines in the same order (AC-61)', () => {
    useFixture('project-b');
    const before = snapshot();
    const dry = migrateTeamConfig(root, { version: VERSION, dryRun: true });
    expect(snapshot()).toEqual(before);
    expect(dry.lines.at(-1)).toBe(DRY_RUN_LINE);
    const real = migrateTeamConfig(root, { version: VERSION });
    expect(settingLines(real.lines)).toEqual(settingLines(dry.lines));
    expect(real.lines.slice(0, -1)).toEqual(dry.lines.slice(0, -1));
  });

  it('a second run changes nothing and says there is nothing to move (AC-65)', () => {
    useFixture('project-a');
    migrateTeamConfig(root, { version: VERSION });
    expect(teamConfigMigrationNeeded(root)).toBe(false);
    const before = snapshot();
    const again = migrateTeamConfig(root, { version: VERSION });
    expect(again.ran).toBe(false);
    expect(again.lines).toEqual([NOTHING_TO_MOVE_LINE]);
    expect(snapshot()).toEqual(before);
  });

  it('a write that fails leaves the old files and the old workflow file untouched (AC-64)', () => {
    useFixture('project-b');
    writeFileSync(join(root, PATHS.PROJECT_CONFIGS_DIR, '.config.rag'), 'rag_top_n=9\n');
    writeFileSync(join(root, PATHS.PROJECT_CONFIGS_DIR, '.config.app'), 'enterprise=true\n');
    const blocker = join(root, PATHS.PROJECT_CONFIGS_DIR, 'feature-development/checks.yaml');
    mkdirSync(blocker, { recursive: true });
    const oldWorkflow = readFileSync(featureDevelopmentViewPath(root), 'utf8');
    const before = configs('.config.policy');
    const result = migrateTeamConfig(root, { version: VERSION });
    rmSync(blocker, { recursive: true, force: true });
    expect(result.error).toMatch(
      /^Couldn't write the new settings files, so the old ones were kept/u,
    );
    expect(result.lines.at(-1)).toBe(result.error);
    expect(configs('.config.policy')).toBe(before);
    expect(configs('.config.rag')).toBe('rag_top_n=9\n');
    expect(configs('.config.app')).toBe('enterprise=true\n');
    expect(readFileSync(featureDevelopmentViewPath(root), 'utf8')).toBe(oldWorkflow);
    const retry = migrateTeamConfig(root, { version: VERSION });
    expect(retry.error).toBeUndefined();
    expect(existsSync(join(root, PATHS.PROJECT_CONFIGS_DIR, '.config.policy'))).toBe(false);
  });

  it('an old workflow file that cannot be deleted leaves .config.app as it was, not the stub (AC-64)', () => {
    useFixture('project-b');
    writeFileSync(join(root, PATHS.PROJECT_CONFIGS_DIR, '.config.app'), 'enterprise=true\n');
    const workflows = join(root, 'docs/instructions/workflows');
    chmodSync(workflows, 0o555);
    const result = migrateTeamConfig(root, { version: VERSION });
    chmodSync(workflows, 0o755);
    expect(
      existsSync(join(root, PATHS.PROJECT_CONFIGS_DIR, 'feature-development/workflow.yaml')),
    ).toBe(true);
    expect(result.error).toMatch(
      /^Couldn't write the new settings files, so the old ones were kept/u,
    );
    expect(configs('.config.app')).toBe('enterprise=true\n');
    expect(existsSync(join(root, PATHS.PROJECT_CONFIGS_DIR, '.config.policy'))).toBe(true);
    const retry = migrateTeamConfig(root, { version: VERSION });
    expect(retry.error).toBeUndefined();
    expect(isMigratedStub(configs('.config.app'))).toBe(true);
  });

  it('an old file that comes back after a merge is migrated again and YAML wins', () => {
    useFixture('project-a');
    migrateTeamConfig(root, { version: VERSION });
    writeFileSync(
      join(root, PATHS.PROJECT_CONFIGS_DIR, '.config.policy'),
      'stages_mode=warn\nduplication_mode=warn\n',
    );
    const again = migrateTeamConfig(root, { version: VERSION });
    expect(again.ran).toBe(true);
    expect(again.lines).toContain(
      'stages_mode is set in both .config.policy and feature-development/workflow.yaml; kept the YAML value block.',
    );
    expect(again.lines).toContain(
      'duplication_mode → feature-development/reuse.yaml: duplication.gate = warn',
    );
    expect(layeredConfigMap(root, {}).get('stages_mode')).toBe('strict');
  });

  it('names the in-progress change when it moves mid-change', () => {
    useFixture('project-a');
    const result = migrateTeamConfig(root, { version: VERSION, activeChange: '01ABCCHANGE' });
    expect(result.lines).toContain(
      'The change 01ABCCHANGE is part-way through its stages. Its settings moved now, so its remaining stages read the YAML files.',
    );
    const quiet = migrateTeamConfig(root, { version: VERSION, activeChange: null });
    expect(quiet.lines.some((line) => line.startsWith('The change '))).toBe(false);
  });

  it('removes a tracked old workflow file from git and writes no new copy', () => {
    useFixture('project-b');
    execFileSync('git', ['init', '-q'], { cwd: root });
    execFileSync('git', ['add', 'docs'], { cwd: root });
    migrateTeamConfig(root, { version: VERSION });
    const tracked = execFileSync('git', ['ls-files', 'docs'], { cwd: root, encoding: 'utf8' });
    expect(tracked).toBe('');
    expect(existsSync(featureDevelopmentViewPath(root))).toBe(false);
    expect(existsSync(join(root, '.paqad/state/feature-development-view.sha256'))).toBe(false);
  });
});

describe('the stub', () => {
  it('an older paqad reads minimum_version from it, and a new paqad ignores it (AC-63, AC-73)', () => {
    useFixture('project-c');
    migrateTeamConfig(root, { version: VERSION });
    const stub = configs('.config.app');
    expect(parseDotConfig(stub).get('minimum_version')).toBe('9.9.0');
    expect([...parseDotConfig(stub).keys()]).toEqual(['paqad_enable', 'minimum_version']);
    expect(parseDotConfig(stub).get('paqad_enable')).toBe('false');
    expect(readSetLines(stub).map((line) => line.key)).toEqual(['paqad_enable', 'minimum_version']);
    expect(teamConfigMigrationNeeded(root)).toBe(false);
  });
});

describe('readSetLines', () => {
  it('keeps team comments directly above a line and drops generated ones (AC-48)', () => {
    expect(
      readSetLines(
        [
          '# ── Section ──',
          '# A generated description. (env: PAQAD_X)',
          'a=1',
          '# team note',
          '# b=commented out',
          'b=2',
          '',
          '# detached',
          '',
          'c=3',
        ].join('\n'),
      ),
    ).toEqual([
      { key: 'a', value: '1', comments: [] },
      { key: 'b', value: '2', comments: ['team note'] },
      { key: 'c', value: '3', comments: [] },
    ]);
  });
});

describe('the size of the team settings (AC-72)', () => {
  const NOISE = join(FIXTURES, 'generated-noise', PATHS.PROJECT_CONFIGS_DIR);
  const OLD_FILES = ['.config.app', '.config.rag', '.config.models', '.config.policy'];

  function useFullSizeFixture(name: string): number {
    useFixture(name);
    let lines = 0;
    for (const file of OLD_FILES) {
      const path = join(root, PATHS.PROJECT_CONFIGS_DIR, file);
      const team = existsSync(path) ? readFileSync(path, 'utf8') : '';
      const text = `${readFileSync(join(NOISE, file), 'utf8')}\n${team}`;
      writeFileSync(path, text);
      lines += text.trimEnd().split('\n').length;
    }
    return lines;
  }

  function teamFiles(at: string): Record<string, string> {
    return Object.fromEntries(
      TEAM_CONFIG_FILES.map((file) => [
        file,
        readFileSync(join(at, PATHS.PROJECT_CONFIGS_DIR, file), 'utf8'),
      ]),
    );
  }

  function settingLineCount(files: Record<string, string>): number {
    return Object.values(files)
      .flatMap((text) => text.split('\n'))
      .filter((line) => line.trim() !== '' && !line.trim().startsWith('#'))
      .filter((line) => !line.startsWith('paqad_version:')).length;
  }

  for (const name of PROJECTS) {
    it(`${name}: shrinks the full generated files to only the lines the team set, with every value carried (AC-72)`, () => {
      const before = useFullSizeFixture(name);
      expect(before).toBeGreaterThanOrEqual(207);
      const flatBefore = layeredConfigMap(root, {});

      const result = migrateTeamConfig(root, { version: VERSION });
      expect(result.error).toBeUndefined();

      const plain = mkdtempSync(join(tmpdir(), 'team-config-plain-'));
      try {
        cpSync(join(FIXTURES, name), plain, { recursive: true });
        writeFileSync(join(plain, PATHS.PROJECT_PROFILE), 'active_capabilities:\n  - coding\n');
        migrateTeamConfig(plain, { version: VERSION });
        expect(teamFiles(root)).toEqual(teamFiles(plain));
      } finally {
        rmSync(plain, { recursive: true, force: true });
      }

      const after = teamFiles(root);
      const set = settingLineCount(after);
      expect(set).toBeGreaterThanOrEqual(7);
      expect(set).toBeLessThanOrEqual(24);
      for (const text of Object.values(after)) {
        expect(text).not.toContain('(env:');
        expect(text).not.toContain('──');
        expect(text).not.toContain('Added in a newer paqad version');
      }
      const flatAfter = layeredConfigMap(root, {});
      for (const [key, value] of flatBefore) {
        if (key === 'legacy_flag' || (key === 'rule_compliance' && name === 'project-b')) continue;
        const spec = FRAMEWORK_CONFIG_SPECS.find((row) => row.key === key)!;
        if (checkYamlValue(spec, toYamlValue(spec, value)) !== null) continue;
        const flat = spec.yaml?.list ? fromYamlValue(spec, toYamlValue(spec, value)) : value;
        expect([key, flatAfter.get(key)]).toEqual([key, flat]);
      }
    });
  }
});
