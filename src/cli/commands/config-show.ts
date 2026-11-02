import { isDeepStrictEqual } from 'node:util';
import { join, relative } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import {
  envConfigValue,
  FRAMEWORK_CONFIG_SPECS,
  layeredConfigMap,
  readDotConfig,
  type FrameworkConfigSpec,
} from '@/core/framework-config.js';
import { readTeamConfig } from '@/core/team-config.js';
import { checkYamlValue, toYamlValue, yamlDefault } from '@/core/team-config-values.js';
import { resolveRuleComplianceMode } from '@/kernel/capability.js';
import { resolveStagesMode } from '@/stage-evidence/mode.js';
import { resolveBundleCompletenessMode } from '@/verification/repository/bundle-completeness-mode.js';
import { resolveVisualEvidenceMode } from '@/verification/repository/visual-evidence-mode.js';
import { resolveChecksFlakyMode } from '@/checks/flaky-mode.js';
import { resolveMutationMode } from '@/mutation/mode.js';
import { resolveAiAttributionMode } from '@/delivery/attribution-config.js';

export interface ConfigShowRow {
  file: string;
  path: string;
  key: string;
  value: unknown;
  source: string;
  same_as_default: boolean;
}

export interface ConfigShowResult {
  settings: ConfigShowRow[];
  invalid: string[];
}

type FlooredResolver = (projectRoot: string, env: NodeJS.ProcessEnv) => string;

const FLOORED: Readonly<Record<string, FlooredResolver>> = {
  rule_compliance: resolveRuleComplianceMode,
  stages_mode: resolveStagesMode,
  bundle_completeness: resolveBundleCompletenessMode,
  visual_evidence_mode: resolveVisualEvidenceMode,
  checks_flaky_under_parallel: resolveChecksFlakyMode,
  mutation_mode: resolveMutationMode,
  ai_attribution: resolveAiAttributionMode,
};

function personalIssue(spec: FrameworkConfigSpec, where: string, raw: string): string | null {
  const reason = checkYamlValue(spec, toYamlValue(spec, raw));
  if (reason === null) return null;
  const def = spec.default === undefined ? '(unset)' : String(spec.default);
  return `${where}: ${spec.key} has an invalid value ${raw}, so paqad uses the default ${def}. ${reason}`;
}

export function buildConfigShow(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): ConfigShowResult {
  const team = readTeamConfig(projectRoot);
  const personal = readDotConfig(projectRoot);
  const layered = layeredConfigMap(projectRoot, env);
  const configsDir = join(projectRoot, PATHS.PROJECT_CONFIGS_DIR);
  const invalid = team.issues.map((issue) => issue.message);
  const settings = FRAMEWORK_CONFIG_SPECS.map((spec): ConfigShowRow => {
    const envRaw = envConfigValue(env, spec.key);
    let source = 'default';
    if (envRaw !== undefined && envRaw.trim() !== '') {
      source = `env: ${spec.env}`;
      const issue = personalIssue(spec, `env ${spec.env}`, envRaw);
      if (issue !== null) invalid.push(issue);
    } else if (personal.has(spec.key)) {
      source = `personal: ${PATHS.PROJECT_CONFIG} (${spec.key})`;
      const issue = personalIssue(spec, PATHS.PROJECT_CONFIG, personal.get(spec.key)!);
      if (issue !== null) invalid.push(issue);
    } else if (team.merged.has(spec.key)) {
      source = `team: ${relative(configsDir, team.sources.get(spec.key)!)}`;
    }
    const floored = FLOORED[spec.key];
    const legacy =
      floored !== undefined
        ? floored(projectRoot, env)
        : (layered.get(spec.key) ??
          (spec.default === undefined ? undefined : String(spec.default)));
    const value = legacy === undefined ? null : toYamlValue(spec, legacy);
    const def = yamlDefault(spec) ?? null;
    return {
      file: spec.file,
      path: spec.path.join('.'),
      key: spec.key,
      value,
      source,
      same_as_default: isDeepStrictEqual(value, def),
    };
  });
  return { settings, invalid };
}

function renderValue(value: unknown): string {
  if (value === null) return '(unset)';
  if (Array.isArray(value)) return `[${value.join(', ')}]`;
  return String(value);
}

export function renderConfigShow(result: ConfigShowResult, changedOnly = false): string {
  const rows = result.settings.filter((row) => !changedOnly || !row.same_as_default);
  const where = rows.map((row) => `${row.file}: ${row.path}`);
  const width = Math.max(0, ...where.map((text) => text.length));
  const lines = rows.map((row, index) => {
    const note = row.same_as_default ? ', same as default' : '';
    return `${where[index]!.padEnd(width)}  ${renderValue(row.value)}  (${row.source}${note})`;
  });
  if (result.invalid.length > 0) {
    lines.push('', 'Invalid values:', ...result.invalid.map((message) => `- ${message}`));
  }
  return lines.join('\n');
}
