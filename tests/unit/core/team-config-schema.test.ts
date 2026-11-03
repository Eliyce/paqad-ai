import { describe, expect, it } from 'vitest';

import { FRAMEWORK_CONFIG_SPECS } from '@/core/framework-config.js';
import { renderTeamConfigFile } from '@/core/team-config.js';
import { STRUCTURED_TEAM_SETTINGS } from '@/core/team-config-schema.js';
import { TEAM_CONFIG_FILES } from '@/core/team-config-values.js';

describe('team config structured settings', () => {
  it('describe the structured settings of workflow.yaml and checks.yaml', () => {
    const at = (file: string, path: string) =>
      STRUCTURED_TEAM_SETTINGS.find(
        (setting) => setting.file === file && setting.path.join('.') === path,
      )?.schema;
    expect(at('feature-development/workflow.yaml', 'stages.planning.read')).toMatchObject({
      type: 'array',
    });
    expect(
      at('feature-development/workflow.yaml', 'stages.planning.module_attribution'),
    ).toMatchObject({ enum: ['defer', 'stop'] });
    expect(at('feature-development/checks.yaml', 'commands.extra')).toMatchObject({
      type: 'object',
    });
    expect(at('feature-development/checks.yaml', 'on_failure')).toMatchObject({
      enum: ['block', 'warn'],
    });
  });

  it('never lets a structured setting and a registry row claim the same path', () => {
    for (const setting of STRUCTURED_TEAM_SETTINGS) {
      const where = setting.path.join('.');
      for (const spec of FRAMEWORK_CONFIG_SPECS.filter((row) => row.file === setting.file)) {
        const path = spec.path.join('.');
        expect(
          where === path || where.startsWith(`${path}.`) || path.startsWith(`${where}.`),
          `${setting.file}: ${where} and ${spec.key}`,
        ).toBe(false);
      }
    }
  });

  it('renders every team file with its description first and no schema line', () => {
    for (const file of TEAM_CONFIG_FILES) {
      const text = renderTeamConfigFile(file, null);
      expect(text.split('\n')[0], file).toMatch(/^# [A-Z]/u);
      expect(text, file).not.toContain('yaml-language-server');
      expect(text, file).not.toContain('.schema.json');
    }
  });
});
