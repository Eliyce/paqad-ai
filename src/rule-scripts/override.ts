import { timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { toProjectRelativePath } from '@/core/path-utils.js';
import { appendRuleOverride, type RuleOverrideRow } from '@/feature-evidence/rule-overrides.js';
import { currentFeature } from '@/feature-evidence/stage-ledger.js';
import { markRuleStopTokenUsed, readRuleStopRecord } from '@/hud/last-block.js';
import { defaultManagedSettingsPaths } from '@/install/plugin-migration.js';
import { resolveSessionId } from '@/rag-ledger/session.js';

export const MANAGED_HOOK_MARKER = 'paqad-ai hook --managed';

export interface RuleOverrideRequest {
  projectRoot: string;
  sessionHint: string | null;
  rule: string;
  file: string;
  token: string;
  toolUseId?: string;
  reason?: string;
  managedSettingsPaths?: string[];
  now?: () => Date;
}

export type RuleOverrideOutcome =
  { ok: true; row: RuleOverrideRow; dirName: string } | { ok: false; reason: string };

function hookCommands(value: unknown): string[] {
  const hooks = value && typeof value === 'object' ? (value as { hooks?: unknown }).hooks : null;
  if (!hooks || typeof hooks !== 'object') return [];
  return Object.values(hooks as Record<string, unknown>).flatMap((entries) =>
    (Array.isArray(entries) ? entries : []).flatMap((entry) => {
      const inner =
        entry && typeof entry === 'object' ? (entry as { hooks?: unknown }).hooks : null;
      return (Array.isArray(inner) ? inner : []).flatMap((hook) => {
        const command =
          hook && typeof hook === 'object' ? (hook as { command?: unknown }).command : null;
        return typeof command === 'string' ? [command] : [];
      });
    }),
  );
}

export function managedSettingsEnforcePaqad(paths: string[]): boolean {
  return paths.some((path) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      return false;
    }
    return hookCommands(parsed).some((command) => command.includes(MANAGED_HOOK_MARKER));
  });
}

function sameToken(expected: string, given: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function applyRuleOverride(request: RuleOverrideRequest): RuleOverrideOutcome {
  const { projectRoot } = request;
  const hint = request.sessionHint?.trim() ?? '';
  if (hint === '') {
    return { ok: false, reason: 'no session id, so there is no rule stop to answer' };
  }
  const file = toProjectRelativePath(projectRoot, request.file);
  if (file === null) {
    return { ok: false, reason: `${request.file} is outside this project` };
  }
  const record = readRuleStopRecord(projectRoot, hint);
  if (!record) {
    return { ok: false, reason: 'no rule stop is recorded for this session' };
  }
  if (
    record.managed ||
    managedSettingsEnforcePaqad(request.managedSettingsPaths ?? defaultManagedSettingsPaths())
  ) {
    return { ok: false, reason: "this rule is enforced by your organization's settings" };
  }
  if (!record.sole) {
    return {
      ok: false,
      reason: 'another paqad gate also stopped this edit, so it cannot be allowed once',
    };
  }
  const recordFile = toProjectRelativePath(projectRoot, record.file);
  if (record.rule !== request.rule || recordFile !== file) {
    return { ok: false, reason: 'the last rule stop was for a different rule or file' };
  }
  if (request.toolUseId !== undefined && record.tool_use_id !== request.toolUseId) {
    return { ok: false, reason: 'the last rule stop was for a different tool call' };
  }
  if (record.used || !sameToken(record.token, request.token)) {
    return { ok: false, reason: 'the override token is missing, wrong or already used' };
  }
  const dirName = currentFeature(projectRoot, resolveSessionId(projectRoot, hint));
  if (!dirName) {
    return { ok: false, reason: 'no active change to record the override in' };
  }
  markRuleStopTokenUsed(projectRoot, record);
  const row = appendRuleOverride(projectRoot, dirName, {
    rule: record.rule,
    file,
    toolUseId: record.tool_use_id,
    reason: request.reason?.trim() || undefined,
    sessionId: hint,
    now: request.now,
  });
  return { ok: true, row, dirName };
}
