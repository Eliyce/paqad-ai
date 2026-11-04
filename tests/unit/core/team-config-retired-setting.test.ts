import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  FRAMEWORK_CONFIG_SPECS,
  reconcileConfigOverrides,
  generateConfigExample,
  generateConfigsReadme,
  stripFrameworkConfigFromProfile,
} from '@/core/framework-config.js';
import { readTeamConfig, renderTeamConfigFile, syncTeamConfigFiles } from '@/core/team-config.js';
import { migrateTeamConfig } from '@/core/team-config-migrate.js';
import { RETIRED_TEAM_SETTINGS } from '@/core/team-config-retired.js';
import { unknownTeamConfigSettings } from '@/core/team-config-report.js';
import { TEAM_CONFIG_FILES } from '@/core/team-config-values.js';
import { FrameworkUpdater } from '@/update/index.js';

const MODELS = '.paqad/configs/models.yaml';
const DECISIONS = '.paqad/configs/decisions.yaml';
const WORKFLOW = '.paqad/configs/feature-development/workflow.yaml';
const SAFETY = '.paqad/configs/feature-development/safety.yaml';

describe('the removed settings', () => {
  let root: string;
  const put = (rel: string, text: string) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  };
  const read = (rel: string) => readFileSync(join(root, rel), 'utf8');
  const sync = () => {
    const notes: string[] = [];
    syncTeamConfigFiles(root, notes);
    return notes;
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-retired-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('are gone from the registry, the catalog, the README and the team file list', () => {
    const keys = new Set(FRAMEWORK_CONFIG_SPECS.map((spec) => spec.key));
    for (const { key } of RETIRED_TEAM_SETTINGS) {
      expect(keys.has(key)).toBe(false);
      expect(generateConfigExample()).not.toContain(key);
      expect(generateConfigsReadme()).not.toContain(key);
    }
    expect(TEAM_CONFIG_FILES).toHaveLength(12);
    expect(TEAM_CONFIG_FILES).not.toContain('feature-development/safety.yaml');
    expect(generateConfigsReadme()).not.toContain('safety.yaml');
    expect(renderTeamConfigFile('models.yaml', null)).not.toContain('research');
  });

  it('FR-63: a legacy fat profile still validates, and its sections are stripped on write', () => {
    const profile = {
      strictness: { full_lane_default: false },
      escalation: { destructive_operations: 'block' },
      research: { depth: 'standard' },
      custom: { decisions: { max_screens_per_task: 3, idle_timeout_minutes: 30 } },
    };
    const schema = JSON.parse(
      readFileSync(
        join(__dirname, '../../../src/validators/schemas/project-profile.schema.json'),
        'utf8',
      ),
    ) as { properties: Record<string, unknown> };
    for (const section of ['strictness', 'escalation', 'research']) {
      expect(schema.properties[section]).toBeDefined();
    }
    const stripped = stripFrameworkConfigFromProfile(profile as never) as Record<string, unknown>;
    expect(stripped.strictness).toBeUndefined();
    expect(stripped.escalation).toBeUndefined();
    expect(stripped.research).toBeUndefined();
    expect((stripped.custom as Record<string, unknown>).decisions).toBeUndefined();
  });

  it('AC-33: a live line loads with no error or warning before update, and is removed once and named', () => {
    const text = 'schema_version: 1\nmax_screens_per_change: 9\n# ours\nask: rarely\n';
    put(DECISIONS, text);
    expect(readTeamConfig(root).issues).toEqual([]);
    expect(unknownTeamConfigSettings(root)).toEqual([]);
    expect(sync()).toContain(
      `${DECISIONS}: removed max_screens_per_change, which paqad doesn't read any more.`,
    );
    expect(read(DECISIONS)).toBe('schema_version: 1\n# ours\nask: rarely\n');
    expect(sync()).toEqual([]);
    expect(unknownTeamConfigSettings(root)).toEqual([]);
  });

  it('AC-33: prunes a parent left empty and changes no other line', () => {
    put(MODELS, 'schema_version: 1\nresearch:\n  depth: conservative\nmodels:\n  default: x\n');
    expect(sync()).toEqual([
      `${MODELS}: removed research.depth, which paqad doesn't read any more.`,
    ]);
    expect(read(MODELS)).toBe('schema_version: 1\nmodels:\n  default: x\n');
  });

  it('AC-33: keeps a parent with other children', () => {
    put(
      WORKFLOW,
      'schema_version: 1\nstages:\n  review:\n    effort: high\n    adversarial_pass: optional\n',
    );
    sync();
    expect(read(WORKFLOW)).toBe('schema_version: 1\nstages:\n  review:\n    effort: high\n');
  });

  it('AC-34: deletes commented copies, their notes and empty group headers, and holds every other byte', () => {
    const models = [
      '# Which models paqad uses and how deep research goes.',
      'schema_version: 1',
      '',
      '# research:',
      '#   # How far planning research looks, from the newest options to proven ones.',
      '#   depth: standard',
      '',
      '# models:',
      '#   # The model used for routine work.',
      '#   default: x',
      '# our own note',
      '',
    ].join('\n');
    put(MODELS, models);
    expect(sync()).toEqual([]);
    expect(read(MODELS)).toBe(
      [
        '# Which models paqad uses and how deep research goes.',
        'schema_version: 1',
        '',
        '',
        '# models:',
        '#   # The model used for routine work.',
        '#   default: x',
        '# our own note',
        '',
      ].join('\n'),
    );
    const settled = read(MODELS);
    sync();
    expect(read(MODELS)).toBe(settled);
  });

  it('AC-34: removes the copies from a rendered workflow and decisions file, and a group with other children stays', () => {
    const workflow = [
      'schema_version: 1',
      '# stages:',
      '#   review:',
      '#     # The effort.',
      '#     effort: high',
      '#     # Requires an adversarial review pass before a change is delivered.',
      '#     adversarial_pass: required',
      '#   documentation_sync:',
      '#     # Blocks delivery while the project docs are out of date.',
      '#     stale_docs: block',
      '# lanes:',
      '#   # Sends every change through the full lane, the most thorough one.',
      '#   default: auto',
      '',
    ].join('\n');
    put(WORKFLOW, workflow);
    put(
      DECISIONS,
      'schema_version: 1\n# The most decision screens paqad shows for one change.\n# max_screens_per_change: 3\n# Minutes a pending decision waits for an answer before paqad settles it itself.\n# auto_resolve_after_minutes: 30\n',
    );
    sync();
    expect(read(WORKFLOW)).toBe(
      'schema_version: 1\n# stages:\n#   review:\n#     # The effort.\n#     effort: high\n',
    );
    expect(read(DECISIONS)).toBe('schema_version: 1\n');
  });

  it('AC-34: leaves a team-written line that looks like a copy with another value, and a note it does not know', () => {
    const text = 'schema_version: 1\n# We like this one.\n# depth: conservative\n';
    put(MODELS, text);
    sync();
    expect(read(MODELS)).toBe(text);
    const withOwnNote =
      'schema_version: 1\n# research:\n#   # Our reasoning.\n#   depth: standard\n';
    put(MODELS, withOwnNote);
    sync();
    expect(read(MODELS)).toBe('schema_version: 1\n# research:\n#   # Our reasoning.\n');
  });

  it('NFR-3: keeps CRLF line ends through the removal', () => {
    put(
      DECISIONS,
      'schema_version: 1\r\n# The most decision screens paqad shows for one change.\r\n# max_screens_per_change: 3\r\nask: rarely\r\n',
    );
    sync();
    expect(read(DECISIONS)).toBe('schema_version: 1\r\nask: rarely\r\n');
  });

  it('AC-34: deletes a safety file that holds only paqad lines, and names it', () => {
    put(
      SAFETY,
      [
        '# Destructive operations, risky migrations, security findings and database review.',
        "# Every setting is listed with paqad's default. To change one, remove the # in front of it.",
        "# A setting left commented out uses paqad's default, which can improve in a later version.",
        '# Inside a group, also remove the # in front of the group name, such as updates:. paqad-ai update does this for you.',
        'paqad_version: "1.117.0"',
        '',
        '# Requires a database review when a change includes migrations.',
        '# database_review_for_migrations: required',
        '',
        '# A data change that touches more rows than this is treated as risky.',
        '# large_data_change_rows: 10000',
        '',
      ].join('\n'),
    );
    expect(sync()).toEqual([`Removed ${SAFETY}, which paqad doesn't read any more.`]);
    expect(existsSync(join(root, SAFETY))).toBe(false);
    expect(sync()).toEqual([]);
  });

  it('AC-33: deletes a safety file whose only team line is a live removed setting, and names both', () => {
    put(SAFETY, 'schema_version: 1\nrisky_migrations: block\n');
    expect(sync()).toEqual([
      `${SAFETY}: removed risky_migrations, which paqad doesn't read any more.`,
      `Removed ${SAFETY}, which paqad doesn't read any more.`,
    ]);
    expect(existsSync(join(root, SAFETY))).toBe(false);
  });

  it('AC-34: keeps a safety file with team notes, names it once, and a second run writes nothing', () => {
    put(
      SAFETY,
      'paqad_version: "1.117.0"\n# Ask Sam first.\n# A data change that touches more rows than this is treated as risky.\n# large_data_change_rows: 10000\n',
    );
    expect(sync()).toEqual([
      `${SAFETY} holds notes your team wrote, so it stayed. paqad doesn't read it any more.`,
    ]);
    expect(read(SAFETY)).toBe('schema_version: 1\n# Ask Sam first.\n');
    expect(sync()).toEqual([]);
  });

  it('AC-18: leaves a safety file with a higher schema_version alone', () => {
    put(SAFETY, 'schema_version: 2\n');
    expect(sync()).toEqual([
      `${SAFETY} was written by a newer paqad, so it wasn't changed. Update paqad-ai.`,
    ]);
    expect(read(SAFETY)).toBe('schema_version: 2\n');
  });

  it('FR-63: an old .config value is dropped and named, not listed as not a paqad setting', () => {
    put('.paqad/configs/.config.policy', 'research_depth=conservative\nrag_top_n=9\n');
    const result = migrateTeamConfig(root, { version: '1.117.0' });
    expect(result.lines).toContain(
      ".paqad/configs/.config.policy: removed research_depth, which paqad doesn't read any more.",
    );
    expect(result.lines.join('\n')).not.toContain("isn't a paqad setting");
    expect(read('.paqad/configs/.config.app')).not.toContain('research_depth');
  });

  it('FR-63: a local config line goes through the existing prune', () => {
    put('.paqad/.config', 'research_depth=conservative\nrag_top_n=9\n');
    expect(reconcileConfigOverrides(root).flatMap((file) => file.removed)).toEqual([
      'research_depth',
    ]);
  });

  it('AC-33: an update settles in one run, and names each change once', async () => {
    put(DECISIONS, 'schema_version: 1\nmax_screens_per_change: 9\n');
    const update = () => new FrameworkUpdater({ generateCandidates: async () => [] }).run(root);
    const first = await update();
    const named = (first.git_workflow_notes ?? []).filter((note) =>
      note.includes('removed max_screens_per_change'),
    );
    expect(named).toHaveLength(1);
    expect((first.git_workflow_notes ?? []).some((note) => note.startsWith('Commit '))).toBe(true);
    const second = await update();
    expect(second.changed_files).toEqual([]);
  });
});
