import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  KNOB_CONSUMERS,
  resolveEffectiveConfig,
  settingsWithoutConsumer,
} from '@/cli/commands/config.js';
import { FRAMEWORK_CONFIG_SPECS, STAGE_SETTING_STAGES } from '@/core/framework-config.js';
import { RETIRED_TEAM_SETTINGS } from '@/core/team-config-retired.js';

const REPO = resolve(__dirname, '../../..');

const NAMED_READERS: ReadonlyArray<readonly [string, string, string]> = [
  ['team_bootstrap_enabled', 'resolveTeamBootstrapEnabled', 'src/core/framework-config.ts'],
  ['feature_report', 'featureReportEnabled', 'src/feature-evidence/report-writer.ts'],
  [
    'metrics_enabled',
    'runRepositoryVerification',
    'src/verification/repository/run-repository-verification.ts',
  ],
  ['hud_view', 'isHudViewOff', 'runtime/claude-plugin/mod/config.ts'],
  ['hud_chime', 'isChimeOn', 'runtime/claude-plugin/mod/config.ts'],
  ['plugin_migration', 'resolvePluginMigrationConfig', 'src/core/framework-config.ts'],
  ['claude_install_mode', 'resolvePluginMigrationConfig', 'src/core/framework-config.ts'],
  ['rag_relief_floor', 'RagService', 'src/rag/service.ts'],
  ...STAGE_SETTING_STAGES.flatMap((stage) => [
    [`stage_effort_${stage}`, 'resolveStageAgentSettings', 'src/core/framework-config.ts'] as const,
    [`stage_model_${stage}`, 'resolveStageAgentSettings', 'src/core/framework-config.ts'] as const,
  ]),
  ['duplication_mode', 'resolveDuplicationMode', 'src/duplication/config.ts'],
  ['duplication_similarity_threshold', 'resolveDuplicationConfig', 'src/duplication/config.ts'],
  ['duplication_min_lines', 'resolveDuplicationConfig', 'src/duplication/config.ts'],
  ['decision_arm_mode', 'resolveDecisionArmMode', 'src/planning/decision-arm-config.ts'],
  [
    'decision_arm_plan_threshold',
    'resolveDecisionArmConfig',
    'src/planning/decision-arm-config.ts',
  ],
  [
    'decision_arm_max_per_change',
    'resolveDecisionArmConfig',
    'src/planning/decision-arm-config.ts',
  ],
  ['ai_attribution', 'resolveAiAttributionMode', 'src/delivery/attribution-config.ts'],
  ['spec_grounding_budget_ms', 'readPipelineConfig', 'src/spec-pipeline/config.ts'],
  ['decisions_ask_threshold', 'askThresholdForProject', 'src/planning/decision-resolver.ts'],
];

describe('every setting names a real reader', () => {
  it('AC-31: no row prints NOTHING', () => {
    const rows = resolveEffectiveConfig(REPO, {});
    expect(rows.length).toBe(FRAMEWORK_CONFIG_SPECS.length);
    expect(rows.filter((row) => row.consumed_by === 'NOTHING').map((row) => row.key)).toEqual([]);
  });

  it('AC-31: a setting with no consumer listed fails the check', () => {
    expect(settingsWithoutConsumer()).toEqual([]);
    expect(
      settingsWithoutConsumer([...FRAMEWORK_CONFIG_SPECS, { key: 'brand_new_setting' }]),
    ).toEqual(['brand_new_setting']);
  });

  it('AC-32: covers the 29 settings that were listed as unread', () => {
    expect(NAMED_READERS).toHaveLength(29);
  });

  it.each(NAMED_READERS)('AC-32: %s names %s, which exists in %s', (key, reader, file) => {
    expect(KNOB_CONSUMERS[key]).toContain(reader);
    expect(readFileSync(join(REPO, file), 'utf8')).toMatch(
      new RegExp(`(?:function|class) ${reader}\\b`, 'u'),
    );
  });

  it('holds no row for a removed setting', () => {
    for (const { key } of RETIRED_TEAM_SETTINGS) {
      expect(KNOB_CONSUMERS[key]).toBeUndefined();
    }
    expect(RETIRED_TEAM_SETTINGS).toHaveLength(11);
  });
});
