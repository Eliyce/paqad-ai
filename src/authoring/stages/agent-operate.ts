import { join } from 'node:path';

import { estimateTokens } from '@/stage-isolation/subagent-completion.js';

import { ACTIVATION_HOOK_HOSTS } from '../catalog.js';
import { readAuthoringConfig } from '../config.js';
import { option, raiseAuthoringDecision, readAuthoringDecision } from '../decisions.js';
import { lastDelegatedByAgent, pruneDelegations } from '../delegations.js';
import { driftLine, listDriftedFacts } from '../drift.js';
import { activeHost, evalTiers } from '../eval/adapters.js';
import { judgeAgentS5Gate, type AgentArmMetrics } from '../eval/passk.js';
import { readTextIfPresent } from '../fs-io.js';
import { lintAgentInProject, POWER_RULES } from '../lint/agent-lint.js';
import { discoverInstalledAgents } from '../overlap.js';
import { readSkillPathContext } from '../paths.js';
import {
  AGENT_TRACKED_ROOT,
  AuthoringRefusal,
  renderGateMarkdown,
  type AuthoringWorkspace,
} from '../workspace.js';
import { agentDraftFile } from './agent-draft.js';
import { latestAgentIteration } from './agent-eval.js';
import { installedAgentFile, runAgentImprove } from './improve.js';
import { IMPROVE_OPTION, LEAVE_OPTION, LEARN_FILE, retirementDecision } from './operate.js';
import type { StageResult } from './result.js';
import { readWorkspaceSources } from './sources.js';

export const DELEGATION_HOOK_HOSTS: readonly string[] = ACTIVATION_HOOK_HOSTS;

interface PendingAgentLearn {
  correction: string;
  scope: string;
  source: string;
  decision: string;
}

export function runAgentLearn(
  workspace: AuthoringWorkspace,
  input: { correction: string; scope: string; source: string; change?: string | null },
): StageResult {
  if (installedAgentFile(workspace) === null) {
    throw new AuthoringRefusal(
      `There is no installed agent named ${workspace.name} to learn from.`,
    );
  }
  if (!/^S-\d+$/u.test(input.source)) {
    throw new AuthoringRefusal(
      '--source must name the trace S-ID the correction comes from (S-<n>).',
      2,
    );
  }
  if (input.correction.trim() === '' || input.scope.trim() === '') {
    throw new AuthoringRefusal('learn needs a correction and --scope naming where it was seen.', 2);
  }
  const decision = raiseAuthoringDecision(workspace.projectRoot, {
    category: 'authoring.improvement',
    title: `Add this correction to ${workspace.name}? "${input.correction}"`,
    context: `Seen in ${input.scope} (${input.source}). On yes it goes under ## Procedure and the evals run again before the change is accepted.`,
    options: [
      option(
        IMPROVE_OPTION,
        'Improve and rerun the evals',
        `If you pick this, the correction is added to ${workspace.name} and its evals run again.`,
        'You give up: the current version as it is.',
      ),
      option(
        LEAVE_OPTION,
        'Leave it',
        `If you pick this, ${workspace.name} does not change.`,
        'You give up: the correction.',
      ),
    ],
    recommendation: IMPROVE_OPTION,
    change: input.change,
  });
  const pending: PendingAgentLearn = {
    correction: input.correction,
    scope: input.scope,
    source: input.source,
    decision,
  };
  workspace.writeJson(LEARN_FILE, pending);
  return {
    ok: false,
    decision,
    artifacts: [workspace.relPath(LEARN_FILE)],
    lines: [
      `Asked decision ${decision}. Once it is answered, run paqad-ai agent learn ${workspace.name} --decision ${decision}.`,
    ],
  };
}

export function appendProcedureLine(agentText: string, line: string): string {
  const lines = agentText.replace(/\s*$/u, '').split('\n');
  const heading = lines.findIndex((entry) => /^##\s+Procedure\s*$/u.test(entry));
  if (heading === -1) return `${lines.join('\n')}\n\n## Procedure\n\n${line}\n`;
  let end = heading + 1;
  while (end < lines.length && !/^#{1,2}\s/u.test(lines[end]!)) end += 1;
  let insertAt = end;
  while (insertAt > heading + 1 && lines[insertAt - 1]!.trim() === '') insertAt -= 1;
  return [...lines.slice(0, insertAt), line, ...lines.slice(insertAt)].join('\n') + '\n';
}

export function resolveAgentLearn(
  workspace: AuthoringWorkspace,
  input: { decision: string; now?: () => Date },
): StageResult {
  const pending = workspace.readJson<PendingAgentLearn>(LEARN_FILE);
  if (pending === null || pending.decision !== input.decision) {
    throw new AuthoringRefusal(`There is no pending correction for decision ${input.decision}.`);
  }
  const record = readAuthoringDecision(workspace.projectRoot, input.decision);
  if (record?.status !== 'resolved') {
    throw new AuthoringRefusal(`${input.decision} is not answered yet. Ask it first, then rerun.`);
  }
  workspace.remove(LEARN_FILE);
  if (record.chosen !== IMPROVE_OPTION) {
    return {
      ok: true,
      artifacts: [],
      lines: [`Left ${workspace.name} unchanged, as the owner chose.`],
    };
  }
  runAgentImprove(workspace);
  const draft = agentDraftFile(workspace);
  const current =
    workspace.read(draft) ??
    readTextIfPresent(join(workspace.projectRoot, installedAgentFile(workspace)!)) ??
    '';
  const date = (input.now ?? (() => new Date()))().toISOString().slice(0, 10);
  workspace.write(
    draft,
    appendProcedureLine(
      current,
      `- learned ${date} in ${pending.scope} (${pending.source}): ${pending.correction}`,
    ),
  );
  return {
    ok: true,
    artifacts: [workspace.relPath(draft)],
    lines: [
      `Added the correction under ## Procedure in the ${workspace.name} draft. Rerun its checks from paqad-ai agent test ${workspace.name}, then eval plan, delegation plan and release.`,
    ],
  };
}

interface ModelStamp {
  model?: string;
  proven_on?: string | null;
  tier?: string | null;
}

export function modelDriftLine(
  name: string,
  stamp: ModelStamp | null,
  tiers: ReadonlyArray<{ tier: string; model: string }>,
): string | null {
  if (stamp?.tier == null || stamp.proven_on == null) return null;
  const now = tiers.find((entry) => entry.tier === stamp.tier)?.model;
  if (now === undefined || now === stamp.proven_on) return null;
  return `${name} was proven on ${stamp.proven_on} (${stamp.tier} tier), but model_routing now names ${now}. Rerun paqad-ai agent eval plan ${name}.`;
}

export function runAgentDrift(
  workspace: AuthoringWorkspace,
  input: { now?: () => Date } = {},
): StageResult {
  const projectRoot = workspace.projectRoot;
  const config = readAuthoringConfig(projectRoot);
  const now = (input.now ?? (() => new Date()))();
  const drifted = listDriftedFacts(
    readWorkspaceSources(workspace),
    now,
    config.authoring_fact_max_age_days,
  );
  const evidence = (() => {
    const text = readTextIfPresent(
      join(projectRoot, AGENT_TRACKED_ROOT, workspace.name, 'evidence.json'),
    );
    try {
      return text === null ? null : (JSON.parse(text) as { model_stamp?: ModelStamp });
    } catch {
      return null;
    }
  })();
  const lines = drifted.map((fact) => driftLine(fact, config.authoring_fact_max_age_days));
  const model = modelDriftLine(
    workspace.name,
    evidence?.model_stamp ?? null,
    evalTiers(projectRoot),
  );
  if (model !== null) lines.push(model);
  const passed = lines.length === 0;
  const artifact = workspace.write(
    'drift.md',
    renderGateMarkdown(
      {
        gate: passed ? 'passed' : 'failed',
        drifted: drifted.length,
        model_changed: model !== null,
      },
      `# Drift: ${workspace.name}\n\n${passed ? 'Every fact is fresh and the model is unchanged.' : lines.map((line) => `- ${line}`).join('\n')}\n`,
    ),
  );
  return {
    ok: passed,
    artifacts: [artifact],
    lines: passed
      ? [`${workspace.name}: every externally verified fact is fresh and the model is unchanged.`]
      : lines,
  };
}

export interface AgentCatalogRow {
  agent: string;
  path: string;
  description_tokens: number;
  last_delegated: string | null;
  dark: boolean;
  expired_power: string[];
}

export interface AgentCatalogReport {
  host: string;
  delegation_data: boolean;
  window_days: number;
  agents: AgentCatalogRow[];
  pruned: number;
}

function expiredPowers(projectRoot: string, path: string): string[] {
  if (!path.endsWith('.md')) return [];
  const lint = lintAgentInProject(projectRoot, join(projectRoot, path));
  return [
    ...new Set(
      lint.findings
        .filter((finding) => finding.severity === 'block' && POWER_RULES.includes(finding.rule))
        .map((finding) => finding.rule),
    ),
  ].sort();
}

export function buildAgentCatalogReport(input: {
  projectRoot: string;
  host: string;
  now: Date;
  darkWindowDays: number;
}): AgentCatalogReport {
  const pruned = pruneDelegations(input.projectRoot, input.now, input.darkWindowDays);
  const hasHook = DELEGATION_HOOK_HOSTS.includes(input.host);
  const last = hasHook ? lastDelegatedByAgent(input.projectRoot) : new Map<string, string>();
  const windowStart = input.now.getTime() - input.darkWindowDays * 86_400_000;
  const installed = discoverInstalledAgents(
    input.projectRoot,
    readSkillPathContext(input.projectRoot),
    { userHome: null },
  ).filter((agent) => agent.scope === 'project');
  const agents = installed.map((agent): AgentCatalogRow => {
    const at = last.get(agent.name) ?? null;
    return {
      agent: agent.name,
      path: agent.path,
      description_tokens: estimateTokens(agent.description),
      last_delegated: at,
      dark: hasHook && (at === null || Date.parse(at) < windowStart),
      expired_power: expiredPowers(input.projectRoot, agent.path),
    };
  });
  return {
    host: input.host,
    delegation_data: hasHook,
    window_days: input.darkWindowDays,
    agents,
    pruned,
  };
}

export function renderAgentCatalogLines(report: AgentCatalogReport): string[] {
  const lines: string[] = [];
  if (!report.delegation_data) {
    lines.push(
      `delegation data: none on ${report.host}, which has no delegation hook, so nothing is recorded`,
    );
  }
  for (const row of report.agents) {
    lines.push(
      `${row.agent}: listing ${row.description_tokens} tokens, last delegated ${row.last_delegated ?? 'never'}` +
        (row.dark ? `, dark for ${report.window_days} days` : '') +
        (row.expired_power.length > 0
          ? `, holds an expired power approval (${row.expired_power.join(', ')})`
          : ''),
    );
  }
  return lines;
}

export function runAgentCatalog(
  projectRoot: string,
  input: { now?: () => Date; proposeRetirement?: boolean; change?: string | null } = {},
): StageResult {
  const config = readAuthoringConfig(projectRoot);
  const report = buildAgentCatalogReport({
    projectRoot,
    host: activeHost(projectRoot),
    now: (input.now ?? (() => new Date()))(),
    darkWindowDays: config.authoring_dark_window_days,
  });
  const lines = renderAgentCatalogLines(report);
  let decision: string | undefined;
  if (input.proposeRetirement) {
    for (const row of report.agents.filter((entry) => entry.dark)) {
      decision = retirementDecision(projectRoot, {
        skill: row.agent,
        kind: 'agent',
        why: `${row.agent} has not been delegated to in ${report.window_days} days and costs ${row.description_tokens} tokens of every listing.`,
        change: input.change,
      });
      lines.push(`Proposed retiring ${row.agent}: decision ${decision}.`);
    }
  }
  const result: StageResult = { ok: true, artifacts: [], lines };
  if (decision) result.decision = decision;
  return result;
}

interface TierMetrics {
  tier: string;
  with_agent: AgentArmMetrics;
}

export function runAgentRegression(workspace: AuthoringWorkspace): StageResult {
  const latest = latestAgentIteration(workspace);
  if (latest === null || latest < 2) {
    throw new AuthoringRefusal(
      `The regression gate needs two recorded iterations of ${workspace.name}. Rerun paqad-ai agent eval plan ${workspace.name} and record it.`,
    );
  }
  type Bench = { registered_tier?: string | null; tiers?: TierMetrics[] } | null;
  const current = workspace.readJson<Bench>(`iteration-${latest}/benchmark.json`) as Bench;
  const previous = workspace.readJson<Bench>(`iteration-${latest - 1}/benchmark.json`) as Bench;
  const tier = previous?.registered_tier ?? current?.registered_tier ?? null;
  const now = current?.tiers?.find((entry) => entry.tier === tier)?.with_agent;
  const before = previous?.tiers?.find((entry) => entry.tier === tier)?.with_agent;
  if (now === undefined || before === undefined) {
    throw new AuthoringRefusal(
      `Iterations ${latest - 1} and ${latest} of ${workspace.name} have no ${tier ?? 'registered'} tier to compare.`,
    );
  }
  const config = readAuthoringConfig(workspace.projectRoot);
  const verdict = judgeAgentS5Gate({
    agent: now,
    baseline: before,
    passKThreshold: config.agent_pass_k_threshold,
    minGainPoints: 0,
    maxCostMultiple: Number.POSITIVE_INFINITY,
    edited: {
      previous: before,
      tolerance: config.authoring_regression_tolerance,
      passKDropAllowed: 0,
    },
  });
  const artifact = workspace.writeJson('regression.json', {
    gate: verdict.passed ? 'passed' : 'failed',
    stage: 'S8',
    tier,
    previous_iteration: latest - 1,
    iteration: latest,
    reasons: verdict.reasons,
    checks_not_measured: verdict.checks_not_measured,
  });
  return {
    ok: verdict.passed,
    artifacts: [artifact],
    lines: verdict.passed
      ? [`${workspace.name} shows no regression on the ${tier} tier.`]
      : [`${workspace.name} regressed: ${verdict.reasons.join('; ')}.`],
  };
}
