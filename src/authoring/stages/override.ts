import {
  OVERRIDE_ADD_UNVERIFIED,
  raiseOverrideDecision,
  readAuthoringDecision,
} from '../decisions.js';
import type { SkillLintFinding } from '../lint/skill-lint.js';
import {
  AuthoringRefusal,
  clearWaiting,
  OVERRIDES_FILE,
  readOverrides,
  type AuthoringWorkspace,
} from '../workspace.js';
import type { StageResult } from './result.js';

export const SECRET_RULE = 'SK-011';
export const AGENT_SECRET_RULE = 'AG-012';
export const AGENT_PERMISSION_RULES: readonly string[] = ['AG-015', 'AG-018', 'AG-022'];

function secretRuleOf(workspace: AuthoringWorkspace): string {
  return workspace.kind === 'agent' ? AGENT_SECRET_RULE : SECRET_RULE;
}

function assertGate(workspace: AuthoringWorkspace, gate: string): void {
  if (!workspace.stages.some((stage) => stage.id === gate && stage.id !== 'S7')) {
    throw new AuthoringRefusal(
      `--gate must name a stage from S0 to S6 (got "${gate}"). Release itself can't be skipped.`,
      2,
    );
  }
}

function lintRules(workspace: AuthoringWorkspace): string[] {
  const lint = workspace.readJson<{ findings?: SkillLintFinding[] }>('lint.json');
  return (lint?.findings ?? []).map((finding) => finding.rule);
}

export function hasSecretFinding(workspace: AuthoringWorkspace): boolean {
  return lintRules(workspace).includes(secretRuleOf(workspace));
}

function refuseSecrets(workspace: AuthoringWorkspace, gate: string): void {
  if (gate !== 'S4') return;
  if (hasSecretFinding(workspace)) {
    throw new AuthoringRefusal(
      `${workspace.name} holds a secret (${secretRuleOf(workspace)}). A secret can never be approved or skipped: remove the value, rerun paqad-ai ${workspace.kind} draft and paqad-ai ${workspace.kind} test.`,
    );
  }
  if (workspace.kind !== 'agent') return;
  const powers = [...new Set(lintRules(workspace))]
    .filter((rule) => AGENT_PERMISSION_RULES.includes(rule))
    .sort();
  if (powers.length > 0) {
    throw new AuthoringRefusal(
      `${workspace.name} asks for risky powers (${powers.join(', ')}). An override can't clear them: only a resolved authoring.agent_permission packet can, or remove the powers and rerun paqad-ai agent test.`,
    );
  }
}

export function askForOverride(
  workspace: AuthoringWorkspace,
  input: { gate: string; why: string; change?: string | null },
): StageResult {
  assertGate(workspace, input.gate);
  refuseSecrets(workspace, input.gate);
  const decision = raiseOverrideDecision(workspace.projectRoot, {
    kind: workspace.kind,
    skill: workspace.name,
    gate: input.gate,
    why: input.why,
    change: input.change,
  });
  return {
    ok: false,
    decision,
    artifacts: [],
    lines: [
      `Asked decision ${decision}. Once it is answered, run paqad-ai ${workspace.kind} override ${workspace.name} --gate ${input.gate} --decision ${decision}.`,
    ],
  };
}

export function recordOverride(
  workspace: AuthoringWorkspace,
  input: { gate: string; decision: string },
): StageResult {
  assertGate(workspace, input.gate);
  refuseSecrets(workspace, input.gate);
  const record = readAuthoringDecision(workspace.projectRoot, input.decision);
  if (record === null) {
    throw new AuthoringRefusal(`There is no decision ${input.decision}.`);
  }
  if (record.category !== 'authoring.override') {
    throw new AuthoringRefusal(
      `${input.decision} is a ${record.category} decision, not authoring.override.`,
    );
  }
  if (record.status !== 'resolved') {
    throw new AuthoringRefusal(`${input.decision} is not answered yet. Ask it first, then rerun.`);
  }
  if (record.chosen !== OVERRIDE_ADD_UNVERIFIED) {
    throw new AuthoringRefusal(
      `The owner chose not to add ${workspace.name} (${input.decision}), so no override is recorded.`,
    );
  }
  if (record.resolvedBy === null || record.resolvedAt === null) {
    throw new AuthoringRefusal(`${input.decision} does not say who answered it or when.`);
  }
  const override = {
    gate: input.gate,
    reason:
      record.rationale && record.rationale.trim() !== ''
        ? record.rationale
        : `decision ${input.decision}`,
    by: record.resolvedBy,
    at: record.resolvedAt,
    decision: input.decision,
  };
  const rest = readOverrides(workspace).filter((entry) => entry.gate !== input.gate);
  const artifact = workspace.writeJson(OVERRIDES_FILE, [...rest, override]);
  clearWaiting(workspace, input.gate);
  return {
    ok: true,
    artifacts: [artifact],
    lines: [
      `Recorded the ${input.gate} override from ${input.decision} (by ${override.by}). ${workspace.name} is labelled unverified and stays in this project.`,
    ],
  };
}
