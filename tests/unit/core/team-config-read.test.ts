import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { layeredConfigMap, readConfigsDir } from '@/core/framework-config.js';
import { readTeamConfig } from '@/core/team-config.js';
import { resolveAiAttributionMode } from '@/delivery/attribution-config.js';
import { resolveStagesMode } from '@/stage-evidence/mode.js';

let root: string;

function write(rel: string, text: string): void {
  const path = join(root, rel);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text, 'utf8');
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'team-config-read-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('readTeamConfig', () => {
  it('turns YAML values back into flat keys and today values', () => {
    write(
      '.paqad/configs/feature-development/workflow.yaml',
      'stage_tracking: block\nstage_helpers:\n  on_lanes: [full, standard]\nlanes:\n  default: full\n',
    );
    write(
      '.paqad/configs/feature-development/checks.yaml',
      'max_processes: auto\nflaky_tests: block\n',
    );
    write('.paqad/configs/paqad.yaml', 'enabled: false\nhud:\n  band: false\n');
    const team = readTeamConfig(root);
    expect(team.merged.get('stages_mode')).toBe('strict');
    expect(team.merged.get('stage_isolation_lanes')).toBe('full,standard');
    expect(team.merged.get('full_lane_default')).toBe('true');
    expect(team.merged.get('checks_max_processes')).toBe('0');
    expect(team.merged.get('checks_flaky_under_parallel')).toBe('fail');
    expect(team.merged.get('paqad_enable')).toBe('false');
    expect(team.merged.get('hud_view')).toBe('false');
    expect(team.sources.get('stages_mode')).toBe(
      join(root, '.paqad/configs/feature-development/workflow.yaml'),
    );
    expect(team.collisions).toEqual([]);
    expect(readConfigsDir(root).merged.get('stages_mode')).toBe('strict');
  });

  it('falls back to the default for an invalid value and reports it', () => {
    write('.paqad/configs/feature-development/workflow.yaml', 'stage_tracking: blocky\n');
    const team = readTeamConfig(root);
    expect(team.merged.has('stages_mode')).toBe(false);
    expect(team.issues.map((issue) => issue.message)).toEqual([
      'feature-development/workflow.yaml: stage_tracking has an invalid value blocky, so paqad uses the default block. It must be one of: off, warn, block.',
    ]);
    expect(resolveStagesMode(root, {})).toBe('strict');
  });

  it('skips a file that is not valid YAML and reports it', () => {
    write('.paqad/configs/retrieval.yaml', 'enabled: true\nmatch: [unclosed\n');
    write('.paqad/configs/models.yaml', 'research:\n  depth: conservative\n');
    const team = readTeamConfig(root);
    expect(team.merged.has('rag_enabled')).toBe(false);
    expect(team.merged.get('research_depth')).toBe('conservative');
    expect(team.issues).toHaveLength(1);
    expect(team.issues[0]!.message).toMatch(
      /^retrieval\.yaml isn't valid YAML, so none of its settings are used: /u,
    );
  });

  it('still reads the old team files where YAML sets nothing, and YAML wins', () => {
    write('.paqad/configs/.config.policy', 'stages_mode=warn\nrule_compliance=strict\n');
    write('.paqad/configs/feature-development/rules.yaml', 'enforcement: off\n');
    const team = readTeamConfig(root);
    expect(team.merged.get('stages_mode')).toBe('warn');
    expect(team.merged.get('rule_compliance')).toBe('off');
  });

  it('ignores the migrated stub', () => {
    write(
      '.paqad/configs/.config.app',
      '# paqad-migrated-stub\nminimum_version=9.9.9\n# Not carried over (not paqad settings):\n',
    );
    expect(readTeamConfig(root).merged.has('minimum_version')).toBe(false);
  });
});

describe('personal and env values', () => {
  it('resolves stages_mode=block and stages_mode=strict to strict', () => {
    write('.paqad/.config', 'stages_mode=block\n');
    expect(resolveStagesMode(root, {})).toBe('strict');
    expect(layeredConfigMap(root, {}).get('stages_mode')).toBe('strict');
    write('.paqad/.config', 'stages_mode=strict\n');
    expect(resolveStagesMode(root, {})).toBe('strict');
    expect(resolveStagesMode(root, { PAQAD_STAGES_MODE: 'block' })).toBe('strict');
  });

  it('keeps the env comma list working', () => {
    const map = layeredConfigMap(root, { PAQAD_SPEC_PIPELINE_STANDING_EXPERTS: 'a,b' });
    expect(map.get('spec_pipeline_standing_experts')).toBe('a,b');
  });

  it('keeps the team floor over a weaker personal value', () => {
    write('.paqad/configs/feature-development/workflow.yaml', 'stage_tracking: block\n');
    write('.paqad/.config', 'stages_mode=off\n');
    expect(resolveStagesMode(root, { PAQAD_STAGES_MODE: 'warn' })).toBe('strict');
  });

  it('falls back to the default for an invalid personal value', () => {
    write('.paqad/.config', 'stages_mode=blocky\n');
    expect(resolveStagesMode(root, {})).toBe('strict');
  });

  it('resolves ai_attribution from commits.yaml with the personal and env layers as today', () => {
    write('.paqad/configs/git-workflow/commits.yaml', 'ai_attribution: keep\n');
    expect(resolveAiAttributionMode(root, {})).toBe('keep');
    expect(resolveAiAttributionMode(root, { PAQAD_AI_ATTRIBUTION: 'strip' })).toBe('strip');
    write('.paqad/configs/git-workflow/commits.yaml', 'ai_attribution: strip\n');
    write('.paqad/.config', 'ai_attribution=keep\n');
    expect(resolveAiAttributionMode(root, {})).toBe('strip');
  });
});

describe('a legacy project', () => {
  it('reads the fixture as before', () => {
    cpSync(join(__dirname, '../../fixtures/team-config/legacy-project'), root, {
      recursive: true,
    });
    const map = layeredConfigMap(root, {});
    expect(map.get('stages_mode')).toBe('warn');
    expect(map.get('spec_pipeline_standing_experts')).toBe('product-owner, qa-engineer');
    expect(map.get('rag_top_n')).toBe('12');
  });
});
