import { appendFileSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import { LEGACY_TEAM_CONFIG_READ_UNTIL } from '@/core/framework-config.js';
import { setTeamConfigClock } from '@/core/team-config-legacy.js';
import { ensureTeamConfigFiles } from '@/core/team-config.js';
import {
  FEATURE_DEVELOPMENT_VIEW_HEADER,
  featureDevelopmentViewPath,
  viewHash,
} from '@/pipeline/feature-development-view.js';
import { teamConfigHealth } from '@/health/team-config-check.js';

const INSIDE = '2026-12-01';
const AFTER = '2027-12-01';
let root: string;

function write(rel: string, text: string): void {
  const path = join(root, PATHS.PROJECT_CONFIGS_DIR, rel);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text, 'utf8');
}

function migrated(): void {
  ensureTeamConfigFiles(root);
}

function rows(): Array<[string, string]> {
  return teamConfigHealth(root).map((result) => [result.status, result.detail]);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'team-config-doctor-'));
  mkdirSync(join(root, PATHS.PROJECT_CONFIGS_DIR), { recursive: true });
  setTeamConfigClock({ today: () => INSIDE, releaseDate: () => INSIDE });
});

afterEach(() => {
  setTeamConfigClock(null);
  rmSync(root, { recursive: true, force: true });
});

describe('doctor: team-config', () => {
  it('is silent when there is no configs folder', () => {
    rmSync(join(root, PATHS.PROJECT_CONFIGS_DIR), { recursive: true });
    expect(teamConfigHealth(root)).toEqual([]);
  });

  it('passes for a migrated project', () => {
    migrated();
    expect(teamConfigHealth(root)).toEqual([
      expect.objectContaining({ name: 'team-config', status: 'pass' }),
    ]);
  });

  it('warns about a missing file (AC-70)', () => {
    migrated();
    unlinkSync(join(root, PATHS.PROJECT_CONFIGS_DIR, 'models.yaml'));
    expect(rows()).toEqual([
      ['warning', '.paqad/configs/models.yaml is missing. Run paqad-ai update to create it.'],
    ]);
  });

  it('warns about an invalid value and an invalid file (AC-70)', () => {
    migrated();
    write('feature-development/workflow.yaml', 'stage_tracking: sometimes\n');
    write('models.yaml', 'a: [\n');
    const details = rows();
    expect(details).toHaveLength(2);
    expect(details[0]![0]).toBe('warning');
    expect(details[0]![1]).toMatch(
      /^models\.yaml isn't valid YAML, so none of its settings are used: /u,
    );
    expect(details[1]![1]).toMatch(
      /^feature-development\/workflow\.yaml: stage_tracking has an invalid value sometimes, so paqad uses the default /u,
    );
  });

  it('warns about a setting paqad does not know, but not about structured settings (AC-70)', () => {
    migrated();
    write(
      'feature-development/workflow.yaml',
      'stage_tracking: off\nstages:\n  planning:\n    read: [a.md]\n    colour: red\nmystery: 1\n',
    );
    expect(rows()).toEqual([
      [
        'warning',
        "feature-development/workflow.yaml has a setting paqad doesn't know: stages.planning.colour. It may be from a newer paqad or a typo.",
      ],
      [
        'warning',
        "feature-development/workflow.yaml has a setting paqad doesn't know: mystery. It may be from a newer paqad or a typo.",
      ],
    ]);
  });

  it('warns about old settings inside the window (AC-66, AC-70)', () => {
    write('.config.policy', 'stages_mode=warn\n');
    expect(rows()).toContainEqual([
      'warning',
      'Old settings in .paqad/configs/.config.policy should be moved. Run paqad-ai config migrate.',
    ]);
  });

  it('fails about old settings only when this paqad was released after the window (AC-66, AC-70)', () => {
    write('.config.policy', 'stages_mode=warn\n');
    setTeamConfigClock({ today: () => AFTER, releaseDate: () => LEGACY_TEAM_CONFIG_READ_UNTIL });
    expect(rows()).toContainEqual([
      'warning',
      'Old settings in .paqad/configs/.config.policy should be moved. Run paqad-ai config migrate.',
    ]);
    setTeamConfigClock({ today: () => AFTER, releaseDate: () => AFTER });
    expect(rows()).toContainEqual([
      'fail',
      'Old settings in .paqad/configs/.config.policy should be moved. Run paqad-ai config migrate.',
    ]);
  });

  it('warns when the feature-development view was edited by hand (AC-70)', () => {
    migrated();
    const view = featureDevelopmentViewPath(root);
    const text = `${FEATURE_DEVELOPMENT_VIEW_HEADER}stages: {}\n`;
    mkdirSync(join(view, '..'), { recursive: true });
    writeFileSync(view, text, 'utf8');
    mkdirSync(join(root, PATHS.FEATURE_DEVELOPMENT_VIEW_HASH, '..'), { recursive: true });
    writeFileSync(join(root, PATHS.FEATURE_DEVELOPMENT_VIEW_HASH), viewHash(text), 'utf8');
    expect(teamConfigHealth(root)[0]!.status).toBe('pass');
    appendFileSync(view, '# my edit\n');
    expect(rows()).toEqual([
      [
        'warning',
        'docs/instructions/workflows/feature-development.yaml was edited by hand. Changes go in .paqad/configs/feature-development/; it is regenerated on the next session.',
      ],
    ]);
  });
});
