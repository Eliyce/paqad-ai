import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { FRAMEWORK_CONFIG_SPECS } from '@/core/framework-config.js';
import { teamConfigHeader, teamConfigSchemaRef } from '@/core/team-config.js';
import {
  generateTeamConfigSchema,
  STRUCTURED_TEAM_SETTINGS,
  teamConfigSchemaPath,
  writeTeamConfigSchemas,
} from '@/core/team-config-schema.js';
import {
  TEAM_CONFIG_FILES,
  yamlDefault,
  type OwnTeamConfigFile,
} from '@/core/team-config-values.js';

type Node = Record<string, unknown>;

function leaf(schema: Node, path: readonly string[]): Node | undefined {
  let node: Node | undefined = schema;
  for (const segment of path) {
    node = (node?.properties as Record<string, Node> | undefined)?.[segment];
  }
  return node;
}

describe('team config schemas', () => {
  it('puts every registry row in its file schema with its description, default and enum (AC-67)', () => {
    for (const spec of FRAMEWORK_CONFIG_SPECS) {
      if (spec.file === 'git-workflow/commits.yaml') continue;
      const node = leaf(generateTeamConfigSchema(spec.file as OwnTeamConfigFile), spec.path);
      expect(node, spec.key).toBeDefined();
      expect(node!.description).toBe(spec.comment);
      expect(node!.default).toEqual(yamlDefault(spec));
    }
    const stageTracking = leaf(generateTeamConfigSchema('feature-development/workflow.yaml'), [
      'stage_tracking',
    ]);
    expect(stageTracking).toMatchObject({ enum: ['off', 'warn', 'block'], default: 'block' });
  });

  it('allows keys from a newer paqad', () => {
    for (const file of TEAM_CONFIG_FILES) {
      expect(generateTeamConfigSchema(file).additionalProperties).toBe(true);
    }
  });

  it('includes the structured settings of workflow.yaml and checks.yaml', () => {
    const workflow = generateTeamConfigSchema('feature-development/workflow.yaml');
    expect(leaf(workflow, ['stages', 'planning', 'read'])).toMatchObject({ type: 'array' });
    expect(leaf(workflow, ['stages', 'planning', 'module_attribution'])).toMatchObject({
      enum: ['defer', 'stop'],
    });
    const checks = generateTeamConfigSchema('feature-development/checks.yaml');
    expect(leaf(checks, ['commands', 'extra'])).toMatchObject({ type: 'object' });
    expect(leaf(checks, ['on_failure'])).toMatchObject({ enum: ['block', 'warn'] });
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

  it('writes one schema per file where the file header points', () => {
    const root = mkdtempSync(join(tmpdir(), 'team-config-schema-'));
    try {
      writeTeamConfigSchemas(root);
      for (const file of TEAM_CONFIG_FILES) {
        const path = teamConfigSchemaPath(root, file);
        expect(existsSync(path)).toBe(true);
        expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(generateTeamConfigSchema(file));
        const fromFile = join(root, '.paqad/configs', file, '..', teamConfigSchemaRef(file));
        expect(fromFile).toBe(path);
        expect(teamConfigHeader(file)).toContain(teamConfigSchemaRef(file));
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
