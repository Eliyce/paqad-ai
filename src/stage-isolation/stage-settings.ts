import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import {
  resolveStageAgentSettings,
  STAGE_EFFORT_LEVELS,
  STAGE_MODELS,
  type StageAgentSetting,
} from '@/core/framework-config.js';

export const SAFE_SESSION_ID = /^[A-Za-z0-9._-]{1,128}$/;

export function isSafeSessionId(sessionId: string): boolean {
  return SAFE_SESSION_ID.test(sessionId);
}

export const STAGE_SETTINGS_DIR = 'stage-settings.d';

export function stageSettingsPath(projectRoot: string, sessionId: string): string {
  return join(projectRoot, PATHS.AGENCY_SESSION_DIR, STAGE_SETTINGS_DIR, `${sessionId}.json`);
}

export function writeStageSettings(
  projectRoot: string,
  sessionId: string,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, StageAgentSetting> {
  if (!isSafeSessionId(sessionId)) {
    throw new Error('unsafe session id');
  }
  const settings = resolveStageAgentSettings(projectRoot, env);
  const path = stageSettingsPath(projectRoot, sessionId);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  return settings;
}

function effortAdvice(configured: string, fileDefault: string): string {
  if (configured !== 'inherit') {
    return `pass effort ${configured}`;
  }
  if (fileDefault !== 'inherit') {
    return `pass your own current effort level, because its agent file defaults to ${fileDefault} effort and would otherwise run at that`;
  }
  return "pass no effort, so it runs at the session's effort";
}

function modelAdvice(configured: string, fileDefault: string): string {
  if (configured !== 'inherit') {
    return `pass model ${configured}`;
  }
  if (fileDefault !== 'inherit') {
    return `pass your own current model, because its agent file defaults to ${fileDefault} and would otherwise run on that`;
  }
  return "pass no model, so it runs on the session's model";
}

export function stageDispatchLine(
  stage: string,
  setting: StageAgentSetting,
  fileDefault: StageAgentSetting,
): string {
  return (
    `${stage}: effort ${setting.effort}, model ${setting.model}. On its Agent call, ` +
    `${effortAdvice(setting.effort, fileDefault.effort)}; ` +
    `${modelAdvice(setting.model, fileDefault.model)}.`
  );
}

export function stageSettingsReport(settings: Record<string, StageAgentSetting>): string[] {
  const fileDefaults = resolveStageAgentSettings();
  return Object.entries(settings).map(([stage, setting]) =>
    stageDispatchLine(stage, setting, fileDefaults[stage]!),
  );
}

function isStageAgentSetting(value: unknown): value is StageAgentSetting {
  if (!value || typeof value !== 'object') return false;
  const { effort, model } = value as Record<string, unknown>;
  return (
    (STAGE_EFFORT_LEVELS as readonly unknown[]).includes(effort) &&
    (STAGE_MODELS as readonly unknown[]).includes(model)
  );
}

export function readStageSetting(
  projectRoot: string,
  sessionId: string,
  stage: string,
): StageAgentSetting | null {
  if (!isSafeSessionId(sessionId)) return null;
  try {
    const parsed = JSON.parse(
      readFileSync(stageSettingsPath(projectRoot, sessionId), 'utf8'),
    ) as Record<string, unknown> | null;
    const setting = parsed?.[stage];
    return isStageAgentSetting(setting) ? { effort: setting.effort, model: setting.model } : null;
  } catch {
    return null;
  }
}
