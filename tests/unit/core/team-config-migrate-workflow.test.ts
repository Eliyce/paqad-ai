import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import YAML from 'yaml';

import { PATHS } from '@/core/constants/paths.js';
import {
  migrateTeamConfig,
  readSetLines,
  teamConfigMigrationNeeded,
} from '@/core/team-config-migrate.js';
import { featureDevelopmentViewPath } from '@/pipeline/feature-development-view.js';

const VERSION = '1.117.0';
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'team-config-migrate-wf-'));
  mkdirSync(join(root, '.paqad'), { recursive: true });
  writeFileSync(join(root, PATHS.PROJECT_PROFILE), 'active_capabilities:\n  - coding\n');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function oldWorkflow(text: string): void {
  const path = featureDevelopmentViewPath(root);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text, 'utf8');
}

function configs(rel: string): Record<string, unknown> {
  return YAML.parse(readFileSync(join(root, PATHS.PROJECT_CONFIGS_DIR, rel), 'utf8')) as Record<
    string,
    unknown
  >;
}

function writeConfig(rel: string, text: string): void {
  const path = join(root, PATHS.PROJECT_CONFIGS_DIR, rel);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text, 'utf8');
}

describe('migrating an old feature-development workflow file', () => {
  it('needs a migration for a hand-written workflow file alone', () => {
    expect(teamConfigMigrationNeeded(root)).toBe(false);
    oldWorkflow('stages: {}\n');
    expect(teamConfigMigrationNeeded(root)).toBe(true);
  });

  it('carries relaxed docs sync, extra profile commands and the strictness block setting', () => {
    oldWorkflow(
      [
        'stages:',
        '  documentation_sync:',
        '    strictness:',
        '      require_canonical_sync: false',
        '  checks:',
        '    strictness:',
        '      block_on_failure: false',
        '    checks:',
        '      use_project_profile_commands: true',
        '      commands: [format, test, build, lint]',
        '  planning:',
        '    escalation:',
        '      attribution_pending: defer',
        '',
      ].join('\n'),
    );
    const result = migrateTeamConfig(root, { version: VERSION });
    expect(result.error).toBeUndefined();
    expect(configs('feature-development/workflow.yaml')).toMatchObject({
      stages: { documentation_sync: { stale_docs: 'warn' } },
    });
    expect(configs('feature-development/checks.yaml')).toMatchObject({
      commands: { from_project_profile: ['format', 'test', 'build', 'lint'] },
      on_failure: 'warn',
    });
    expect(result.lines).toContain(
      'stages.documentation_sync.strictness.require_canonical_sync → feature-development/workflow.yaml: stages.documentation_sync.stale_docs = warn',
    );
    expect(result.lines.some((line) => line.includes('module_attribution'))).toBe(false);
  });

  it('carries a stale-docs warning and turning off the profile commands', () => {
    oldWorkflow(
      [
        'stages:',
        '  documentation_sync:',
        '    escalation:',
        '      stale_docs: warn',
        '  checks:',
        '    checks:',
        '      use_project_profile_commands: false',
        '',
      ].join('\n'),
    );
    const result = migrateTeamConfig(root, { version: VERSION });
    expect(result.lines).toContain(
      'stages.documentation_sync.escalation.stale_docs → feature-development/workflow.yaml: stages.documentation_sync.stale_docs = warn',
    );
    expect(configs('feature-development/checks.yaml')).toMatchObject({
      commands: { from_project_profile: [] },
    });
  });

  it('carries nothing from a workflow file that is a single value, and moves only the unknown keys into notes', () => {
    oldWorkflow('just a string\n');
    const result = migrateTeamConfig(root, { version: VERSION });
    expect(result.ran).toBe(true);
    expect(result.lines).toContain(
      " was set in the old workflow file but paqad never used it, so it wasn't carried over.",
    );
    expect(result.replaced).toContain('docs/instructions/workflows/feature-development.yaml');
  });

  it('moves a rule-compliance mode set only in the workflow file and names nested keys paqad never read', () => {
    oldWorkflow(
      'stages:\n  checks:\n    rule_compliance:\n      mode: warn\nextras:\n  team:\n    owner: alice\n',
    );
    const result = migrateTeamConfig(root, { version: VERSION });
    expect(
      result.lines.some((line) => line.startsWith('stages.checks.rule_compliance.mode → ')),
    ).toBe(true);
    expect(result.lines.some((line) => line.startsWith('rule_compliance was also set'))).toBe(
      false,
    );
    expect(result.lines).toContain(
      "extras.team.owner was set in the old workflow file but paqad never used it, so it wasn't carried over.",
    );
  });

  it('keeps a workflow file it cannot read and says so', () => {
    oldWorkflow('stages: [unclosed\n');
    const result = migrateTeamConfig(root, { version: VERSION });
    expect(result.lines[0]).toMatch(
      /^Couldn't read docs\/instructions\/workflows\/feature-development\.yaml, so it was kept and none of its settings were carried over: /,
    );
    expect(result.replaced).not.toContain('docs/instructions/workflows/feature-development.yaml');
    expect(readFileSync(featureDevelopmentViewPath(root), 'utf8')).toBe('stages: [unclosed\n');
  });

  it('keeps a YAML value that differs from the old one and says which it kept', () => {
    writeConfig('feature-development/checks.yaml', 'on_failure: block\n');
    oldWorkflow('stages:\n  checks:\n    checks:\n      block_on_failure: false\n');
    const result = migrateTeamConfig(root, { version: VERSION });
    expect(result.lines).toContain(
      'stages.checks.checks.block_on_failure is set in both docs/instructions/workflows/feature-development.yaml and feature-development/checks.yaml; kept the YAML value block.',
    );
    expect(configs('feature-development/checks.yaml').on_failure).toBe('block');
  });

  it('stops without writing when a team YAML file is broken', () => {
    writeConfig('feature-development/checks.yaml', 'on_failure: [unclosed\n');
    oldWorkflow('stages:\n  checks:\n    checks:\n      block_on_failure: false\n');
    const result = migrateTeamConfig(root, { version: VERSION });
    expect(result.error).toMatch(
      /^feature-development\/checks\.yaml isn't valid YAML, so the settings for it weren't moved: /,
    );
    expect(readFileSync(featureDevelopmentViewPath(root), 'utf8')).toContain('block_on_failure');
  });
});

describe('reading set lines from an old dot-config file', () => {
  it('ignores lines that are not a single key=value', () => {
    expect(readSetLines('# a note\nnot a setting\nkey=value\n')).toEqual([
      { key: 'key', value: 'value', comments: [] },
    ]);
  });
});
