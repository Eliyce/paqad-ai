import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import {
  AGENT_RECORD_WRITER,
  NoActiveFeatureError,
  writeAgentRecord,
  type AgentRecordBody,
} from '@/feature-evidence/artifacts.js';

import { readAuthoringConfig } from '../config.js';
import type { AgentArmMetrics } from '../eval/passk.js';
import {
  EXPLORE_NAME,
  EXPLORE_PASS_K_MIN,
  exploreRegistrationProblem,
  hostAllowsBuiltinOverride,
} from '../explore.js';
import { AGENT_PERMISSION_ALLOW, readAuthoringDecision } from '../decisions.js';
import { driftLine, listDriftedFacts } from '../drift.js';
import { readTextIfPresent, writeFileAtomic } from '../fs-io.js';
import { hashAgentFile, hashText } from '../hash.js';
import { lintAgentInProject, PERMISSIONS_FILE, type AgentLintResult } from '../lint/agent-lint.js';
import {
  AGENT_HOST_TARGETS,
  parseAgentSource,
  renderProducedAgent,
  type AgentSource,
} from '../package/agent-render.js';
import {
  buildAgentDefinition,
  SDK_DEFINITION_CHECKED,
  sdkRunOptions,
  uncarriedRules,
} from '../package/sdk-definition.js';
import { enabledAdapters, isPaqadRepository, PAQAD_REPO_AGENT_ROOTS } from '../paths.js';
import {
  AGENT_TRACKED_ROOT,
  AuthoringRefusal,
  readOverrides,
  requireEarlierGates,
  type AuthoringWorkspace,
  type OverrideRecord,
} from '../workspace.js';
import { agentDraftFile, readAgentDraftSource } from './agent-draft.js';
import { AGENT_S5_TASK_TYPE, readAgentIntake, type AgentIntake } from './agent-intake.js';
import {
  agentTestInputsHash,
  draftAgentHash,
  draftAgentHashWithoutDescription,
  draftHookScripts,
} from './agent-test.js';
import { DRAFT_DIR } from './draft.js';
import { DELEGATION_RESULTS_FILE } from './delegation.js';
import { EVIDENCE_SCHEMA_VERSION, UNVERIFIED_LABEL } from './release.js';
import type { StageResult } from './result.js';
import { readWorkspaceSources } from './sources.js';
import { RISKY_FILE } from './test.js';

export const PLUGIN_AGENT_ROOT = 'runtime/claude-plugin/agents/';
export const SDK_FORM_SUFFIX = '.agent.json';
export const AUTO_MEMORY_SETTING = 'autoMemoryEnabled';

export interface AgentReleaseOptions {
  version?: string;
  sessionId: string;
  now?: () => Date;
}

interface HashedRecord {
  gate?: string;
  inputs_hash?: string | null;
  inputs_hash_without_description?: string | null;
  test_location?: string;
}

export interface ReleasedHostFile {
  adapter: string;
  path: string;
  content: string;
}

export interface AgentReleasePlan {
  files: ReleasedHostFile[];
  deployable: Record<string, boolean>;
  host_notes: Record<string, string[]>;
  proposals: string[];
  plugin: { settings_hooks: PluginSettingsHook[] } | null;
  primary: string;
}

export interface PluginSettingsHook {
  event: 'SubagentStart' | 'SubagentStop';
  matcher: string;
  command: string;
  replaces: string;
}

function checkHashes(workspace: AuthoringWorkspace, overridden: Set<string>): void {
  const lint = workspace.readJson<HashedRecord>('lint.json');
  const tests = workspace.readJson<HashedRecord>('script-tests.json');
  const delegation = workspace.readJson<HashedRecord & { skipped?: string }>(
    DELEGATION_RESULTS_FILE,
  );
  const checks: Array<{
    stage: string;
    command: string;
    recorded: string | null | undefined;
    actual: () => string;
  }> = [
    {
      stage: 'S4',
      command: `paqad-ai agent test ${workspace.name}`,
      recorded: lint?.inputs_hash_without_description,
      actual: () => draftAgentHashWithoutDescription(workspace),
    },
    {
      stage: 'S4',
      command: `paqad-ai agent test ${workspace.name}`,
      recorded: tests?.inputs_hash,
      actual: () => agentTestInputsHash(workspace, tests?.test_location ?? ''),
    },
    {
      stage: 'S5',
      command: `paqad-ai agent eval plan ${workspace.name}`,
      recorded: workspace.readJson<HashedRecord>('benchmark.json')?.inputs_hash,
      actual: () => draftAgentHashWithoutDescription(workspace),
    },
    {
      stage: 'S6',
      command: `paqad-ai agent delegation plan ${workspace.name}`,
      recorded: delegation?.inputs_hash,
      actual: () => draftAgentHash(workspace),
    },
  ];
  for (const check of checks) {
    if (overridden.has(check.stage)) continue;
    if (!check.recorded || check.recorded !== check.actual()) {
      throw new AuthoringRefusal(
        `Release refused: the agent or a hook script it names changed after ${check.stage} judged it. Rerun ${check.stage} (${check.command}) and the stages after it.`,
      );
    }
  }
}

function nextVersion(previous: string | null, requested: string | undefined): string {
  if (requested !== undefined) {
    if (!/^\d+\.\d+\.\d+$/u.test(requested)) {
      throw new AuthoringRefusal(`--version must look like 1.2.3 (got "${requested}").`, 2);
    }
    return requested;
  }
  if (previous === null) return '1.0.0';
  const [major, minor] = previous.split('.').map(Number);
  return `${major}.${(minor ?? 0) + 1}.0`;
}

export function runtimeAgentSource(workspace: AuthoringWorkspace): string | null {
  const file = readAgentDraftSource(workspace)?.file;
  if (file === undefined || !isPaqadRepository(workspace.projectRoot)) return null;
  const inRoot = PAQAD_REPO_AGENT_ROOTS.some((root) => {
    const pattern = new RegExp(`^${root.replace('*', '[^/]+')}/[^/]+$`, 'u');
    return pattern.test(file);
  });
  return inRoot ? file : null;
}

function doNotItems(body: string): number {
  const lines = body.split('\n');
  const start = lines.findIndex((line) => /^##\s+Do not\s*$/u.test(line));
  if (start === -1) return 0;
  let count = 0;
  for (const line of lines.slice(start + 1)) {
    if (/^##\s/u.test(line)) break;
    if (/^\s*(?:[-*+]|\d+[.)])\s+/u.test(line)) count += 1;
  }
  return count;
}

export function reliedRestrictions(source: AgentSource, lint: AgentLintResult): string[] {
  const relied: string[] = [];
  for (const [event, entries] of Object.entries(source.hooks ?? {})) {
    if (event !== 'PreToolUse' || !Array.isArray(entries)) continue;
    for (const entry of entries as Array<{ matcher?: unknown }>) {
      relied.push(
        `the blocking PreToolUse hook (${typeof entry?.matcher === 'string' ? entry.matcher : '*'})`,
      );
    }
  }
  for (const tool of source.tools ?? []) {
    if (/^(?:Bash|PowerShell)\(.+\)$/u.test(tool)) relied.push(`the tool allowlist ${tool}`);
  }
  if ((source.disallowedTools ?? []).length > 0) {
    relied.push(`disallowedTools ${source.disallowedTools!.join(', ')}`);
  }
  const unenforced = lint.findings.filter((finding) => finding.rule === 'AG-021').length;
  const enforced = doNotItems(source.body) - unenforced;
  if (enforced > 0 && (source.tools !== undefined || source.hooks !== undefined)) {
    relied.push(
      `${enforced} Do not item${enforced === 1 ? '' : 's'} enforced by the tool list or a hook`,
    );
  }
  return relied;
}

function pluginHooks(source: AgentSource): PluginSettingsHook[] {
  const moved: PluginSettingsHook[] = [];
  for (const [event, entries] of Object.entries(source.hooks ?? {})) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries as Array<{ matcher?: unknown; hooks?: unknown }>) {
      const matcher = typeof entry?.matcher === 'string' ? entry.matcher : '*';
      const inner = Array.isArray(entry?.hooks)
        ? (entry.hooks as Array<{ command?: unknown }>)
        : [];
      for (const hook of inner) {
        if (typeof hook?.command !== 'string') continue;
        moved.push({
          event: event === 'Stop' || event === 'SubagentStop' ? 'SubagentStop' : 'SubagentStart',
          matcher: `^(paqad:)?${source.name}$`,
          command: hook.command,
          replaces: `${event} (${matcher})`,
        });
      }
    }
  }
  return moved;
}

export function planAgentRelease(input: {
  workspace: AuthoringWorkspace;
  source: AgentSource;
  draftText: string;
  lint: AgentLintResult;
  adapters: readonly string[];
}): AgentReleasePlan {
  const { workspace, source, lint } = input;
  const permissionApproved = lint.powers.includes('bypassPermissions') && lint.blocking === 0;
  const runtime = runtimeAgentSource(workspace);
  if (runtime !== null) {
    if (!runtime.startsWith(PLUGIN_AGENT_ROOT)) {
      return {
        files: [{ adapter: 'paqad-runtime', path: runtime, content: input.draftText }],
        deployable: { 'paqad-runtime': true },
        host_notes: {},
        proposals: [],
        plugin: null,
        primary: runtime,
      };
    }
    const stripped: AgentSource = { ...source };
    delete stripped.hooks;
    delete stripped.permissionMode;
    const rendered = renderProducedAgent(stripped, 'claude-code');
    return {
      files: [{ adapter: 'claude-plugin', path: runtime, content: rendered.content }],
      deployable: { 'claude-plugin': true },
      host_notes: {
        'claude-plugin': [
          'hooks, mcpServers and permissionMode are not relied on in a plugin agent; must-not rules moved to SubagentStart and SubagentStop settings hooks',
        ],
      },
      proposals: [],
      plugin: { settings_hooks: pluginHooks(source) },
      primary: runtime,
    };
  }
  const files: ReleasedHostFile[] = [];
  const deployable: Record<string, boolean> = {};
  const hostNotes: Record<string, string[]> = {};
  const proposals: string[] = [];
  const builtinOverride = workspace.name === EXPLORE_NAME;
  for (const adapter of input.adapters) {
    const host = AGENT_HOST_TARGETS.find((target) => target.adapter === adapter);
    if (builtinOverride && !hostAllowsBuiltinOverride(adapter)) {
      deployable[adapter] = false;
      proposals.push(
        `${adapter} cannot override its built-in ${EXPLORE_NAME}, so ${EXPLORE_NAME} is not deployable there and nothing is written.`,
      );
      continue;
    }
    if (host === undefined) {
      deployable[adapter] = false;
      proposals.push(
        `${adapter} runs no subagents, so ${source.name} is not deployable there. Propose a skill for ${adapter} instead (paqad-ai skill justify ${source.name}).`,
      );
      continue;
    }
    const rendered = renderProducedAgent(source, host, { permissionApproved });
    if (host.extension === 'toml') {
      const relied = reliedRestrictions(source, lint);
      if (relied.length > 0) {
        deployable[adapter] = false;
        hostNotes[adapter] = [
          ...rendered.host_notes,
          `not written: the Codex form drops ${relied.join('; ')}, so it would run with wider powers than the Claude Code file`,
        ];
        proposals.push(
          `${source.name} is not deployable on ${adapter}: its form would drop ${relied.join('; ')}. Propose a skill for ${adapter} instead (paqad-ai skill justify ${source.name}).`,
        );
        continue;
      }
    }
    deployable[adapter] = true;
    hostNotes[adapter] = rendered.host_notes;
    const verbatim =
      host.extension === 'md' && (source.permissionMode === undefined || permissionApproved);
    files.push({
      adapter,
      path: rendered.path,
      content: verbatim ? input.draftText : rendered.content,
    });
  }
  if (files.length === 0) {
    proposals.push(
      `No enabled host runs subagents, so only the SDK form of ${source.name} is written.`,
    );
  }
  return {
    files,
    deployable,
    host_notes: hostNotes,
    proposals,
    plugin: null,
    primary: files[0]?.path ?? '',
  };
}

export function autoMemoryOff(projectRoot: string): boolean {
  for (const file of ['.claude/settings.json', '.claude/settings.local.json']) {
    const text = readTextIfPresent(join(projectRoot, file));
    if (text === null) continue;
    try {
      if ((JSON.parse(text) as Record<string, unknown>)[AUTO_MEMORY_SETTING] === false) return true;
    } catch {
      throw new AuthoringRefusal(`Release refused: ${file} is not valid JSON.`);
    }
  }
  return false;
}

function permissionDecisions(workspace: AuthoringWorkspace): string[] {
  return (workspace.readJson<string[]>(PERMISSIONS_FILE) ?? []).filter(
    (id) => readAuthoringDecision(workspace.projectRoot, id)?.chosen === AGENT_PERMISSION_ALLOW,
  );
}

function writeIfChanged(projectRoot: string, rel: string, content: string | Buffer): boolean {
  const abs = join(projectRoot, rel);
  if (existsSync(abs) && readFileSync(abs).equals(Buffer.from(content))) return false;
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
  return true;
}

function writeHookScripts(workspace: AuthoringWorkspace): string[] {
  const written: string[] = [];
  for (const script of draftHookScripts(workspace)) {
    const draft = workspace.path(`${DRAFT_DIR}/${script}`);
    if (!existsSync(draft)) continue;
    if (writeIfChanged(workspace.projectRoot, script, readFileSync(draft))) written.push(script);
  }
  return written;
}

function changelogEntry(version: string, evidence: AgentEvidence): string {
  const reliability = evidence.reliability as { pass_hat_k?: number | null } | null;
  const parts = [
    reliability?.pass_hat_k == null ? 'evals: not measured' : `pass^3 ${reliability.pass_hat_k}`,
    `deployable: ${Object.entries(evidence.deployable)
      .map(([host, ok]) => `${host} ${ok ? 'yes' : 'no'}`)
      .join(', ')}`,
    ...(evidence.labels.length > 0 ? [`labels: ${evidence.labels.join(', ')}`] : []),
  ];
  return `## ${version}\n\n- ${parts.join('; ')}\n`;
}

function writeChangelog(path: string, name: string, version: string, entry: string): void {
  const existing = readTextIfPresent(path) ?? `# ${name}\n`;
  if (existing.includes(`## ${version}\n`)) return;
  const [title, ...rest] = existing.split('\n\n');
  writeFileAtomic(
    path,
    [(title ?? '').trimEnd(), entry.trimEnd(), ...rest].join('\n\n').trimEnd() + '\n',
  );
}

export type AgentEvidence = Record<string, unknown> & {
  deployable: Record<string, boolean>;
  labels: string[];
};

interface EvidenceInput {
  workspace: AuthoringWorkspace;
  intake: AgentIntake | null;
  version: string;
  fileHash: string;
  plan: AgentReleasePlan;
  source: AgentSource;
  lint: AgentLintResult;
  overrides: OverrideRecord[];
  labels: string[];
  sdkPath: string;
  maxBudgetUsd: number;
  autoMemoryOff: boolean;
}

function number(value: unknown): number | 'unavailable' {
  return typeof value === 'number' && Number.isFinite(value) ? value : 'unavailable';
}

export function buildAgentEvidence(input: EvidenceInput): AgentEvidence {
  const { workspace, intake } = input;
  const baselineRuns = workspace.readJson<Array<{ passed?: unknown }>>('baseline/verdicts.json');
  const benchmark = workspace.readJson<Record<string, unknown>>('benchmark.json');
  const delegation = workspace.readJson<Record<string, unknown>>(DELEGATION_RESULTS_FILE);
  const tests = workspace.readJson<{
    test_command?: string | null;
    scripts?: Array<{ checks: Array<{ status: string }> }>;
  }>('script-tests.json');
  const checks = (tests?.scripts ?? []).flatMap((script) => script.checks);
  const performance = (benchmark?.performance as Record<string, unknown> | undefined) ?? null;
  const returned = performance?.returned_to_main_tokens as { value?: unknown } | undefined;
  const memory = benchmark?.memory as { kept?: boolean } | null | undefined;
  const creationS5 = (benchmark?.creation_cost_usd as { S5?: unknown } | undefined)?.S5;
  const creationS6 = (delegation?.creation_cost_usd as { S6?: unknown } | undefined)?.S6;
  const decisions = [
    ...input.overrides.map((entry) => entry.decision),
    ...(workspace.readJson<Array<{ decision: string }>>(RISKY_FILE) ?? []).map(
      (entry) => entry.decision,
    ),
    ...(workspace.readJson<string[]>(PERMISSIONS_FILE) ?? []),
  ];
  return {
    schema_version: EVIDENCE_SCHEMA_VERSION,
    agent: workspace.name,
    version: input.version,
    file_hash: input.fileHash,
    released_path: input.plan.primary,
    files: input.plan.files.map((file) => file.path),
    pattern: intake?.pattern ?? null,
    class: intake?.class ?? null,
    invocation: intake?.invocation ?? null,
    baseline: {
      arm: (benchmark?.baseline_arm as string | undefined) ?? null,
      runs: baselineRuns?.length ?? 0,
      passed: baselineRuns?.filter((run) => run.passed === true).length ?? 'unavailable',
      verdict: input.overrides.some((entry) => entry.gate === 'S0') ? 'overridden' : 'needed',
    },
    reliability: benchmark
      ? {
          pass_hat_k: benchmark.pass_hat_k ?? null,
          threshold: benchmark.threshold ?? null,
          registered_tier: benchmark.registered_tier ?? null,
          table: benchmark.reliability ?? [],
        }
      : null,
    delegation:
      delegation?.skipped === 'dispatched'
        ? { skipped: 'dispatched' }
        : delegation
          ? {
              validation_score: delegation.chosen_score ?? null,
              chosen_iteration: delegation.chosen_iteration ?? null,
              threshold: delegation.threshold ?? null,
            }
          : null,
    memory:
      memory === null || memory === undefined
        ? 'none'
        : {
            ...memory,
            decision: memory.kept ? 'kept' : 'dropped',
            ...(memory.kept && input.autoMemoryOff
              ? { unmet: 'auto memory is off in this project' }
              : {}),
          },
    returned_to_main_tokens_median: number(returned?.value),
    host_notes: input.plan.host_notes,
    deployable: input.plan.deployable,
    proposals: input.plan.proposals,
    sdk: {
      path: input.sdkPath,
      fields_checked: SDK_DEFINITION_CHECKED,
      run_options: { maxBudgetUsd: input.maxBudgetUsd },
      uncarried_rules: uncarriedRules(input.source),
    },
    ...(input.plan.plugin === null ? {} : { plugin: input.plan.plugin }),
    model_stamp: {
      model: input.source.model ?? 'inherit',
      proven_on: benchmark?.registered_model ?? null,
      tier: benchmark?.registered_tier ?? null,
    },
    performance:
      performance === null
        ? { source: 'unavailable' }
        : {
            task_type: intake === null ? null : AGENT_S5_TASK_TYPE[intake.class],
            ...performance,
          },
    batch: benchmark?.batch ?? 'unavailable',
    creation_cost: {
      S5: number(creationS5),
      S6: delegation?.skipped === 'dispatched' ? 0 : number(creationS6),
      source: 'host-usage',
    },
    lint: { blocking: input.lint.blocking, warnings: input.lint.warnings },
    script_tests: {
      command: tests?.test_command ?? null,
      tests: checks.length,
      passed: checks.filter((check) => check.status === 'passed').length,
    },
    permission_decisions: permissionDecisions(workspace),
    overrides: input.overrides.map(({ gate, reason, by, at }) => ({ gate, reason, by, at })),
    decisions: [...new Set(decisions)].sort(),
    labels: input.labels,
  };
}

function refuseUnmetMemory(workspace: AuthoringWorkspace, overridden: Set<string>): boolean {
  const memory = workspace.readJson<{ memory?: { kept?: boolean } | null }>(
    'benchmark.json',
  )?.memory;
  const off = autoMemoryOff(workspace.projectRoot);
  if (memory?.kept === true && off && !overridden.has('S5')) {
    throw new AuthoringRefusal(
      `Release refused: S5 kept the memory arm, but auto memory is off in this project (${AUTO_MEMORY_SETTING}: false), so the memory need is unmet. Turn auto memory on, or ask for an S5 override with paqad-ai agent override ${workspace.name} S5 --reason <text>.`,
    );
  }
  return off;
}

export function runAgentRelease(
  workspace: AuthoringWorkspace,
  options: AgentReleaseOptions,
): StageResult {
  requireEarlierGates(workspace, 'S7');
  const projectRoot = workspace.projectRoot;
  const config = readAuthoringConfig(projectRoot);
  const draft = agentDraftFile(workspace);
  if (!workspace.exists(draft)) {
    throw new AuthoringRefusal(
      `Release refused: there is no draft in ${workspace.relPath(draft)}. Run paqad-ai agent draft ${workspace.name} first.`,
    );
  }
  const overrides = readOverrides(workspace);
  const overridden = new Set(overrides.map((entry) => entry.gate));
  const lint = lintAgentInProject(projectRoot, workspace.path(draft));
  if (lint.blocking > 0) {
    throw new AuthoringRefusal(
      `Release refused: the agent has ${lint.blocking} blocking lint finding(s) (${[
        ...new Set(
          lint.findings.filter((entry) => entry.severity === 'block').map((entry) => entry.rule),
        ),
      ].join(', ')}). Rerun paqad-ai agent test ${workspace.name}.`,
    );
  }
  checkHashes(workspace, overridden);
  if (workspace.name === EXPLORE_NAME && !overridden.has('S5')) {
    const benchmark = workspace.readJson<{
      registered_tier?: string | null;
      tiers?: Array<{ tier: string; with_agent?: AgentArmMetrics; baseline?: AgentArmMetrics }>;
    }>('benchmark.json');
    const tier = benchmark?.tiers?.find((entry) => entry.tier === benchmark.registered_tier);
    const problem = exploreRegistrationProblem({
      agent: tier?.with_agent,
      builtin: tier?.baseline,
    });
    if (problem !== null) {
      throw new AuthoringRefusal(
        `Release refused: the ${EXPLORE_NAME} override is registered only at pass^3 ${EXPLORE_PASS_K_MIN} for a lower median cost than the built-in, and ${problem}.`,
      );
    }
  }
  const memoryOff = refuseUnmetMemory(workspace, overridden);
  const drifted = listDriftedFacts(
    readWorkspaceSources(workspace),
    (options.now ?? (() => new Date()))(),
    config.authoring_fact_max_age_days,
  );
  if (drifted.length > 0) {
    throw new AuthoringRefusal(
      `Release refused: ${drifted.map((fact) => driftLine(fact, config.authoring_fact_max_age_days)).join(' ')}`,
    );
  }

  const draftText = workspace.read(draft)!;
  const source = parseAgentSource(draftText);
  const plan = planAgentRelease({
    workspace,
    source,
    draftText,
    lint,
    adapters: enabledAdapters(projectRoot),
  });
  const trackedDir = `${AGENT_TRACKED_ROOT}/${workspace.name}`;
  const evidencePath = `${trackedDir}/evidence.json`;
  const sdkPath = `${trackedDir}/${workspace.name}${SDK_FORM_SUFFIX}`;
  const scripts = draftHookScripts(workspace);
  const fileHash = draftAgentHash(workspace);
  const previous = (() => {
    const text = readTextIfPresent(join(projectRoot, evidencePath));
    if (text === null) return null;
    try {
      return JSON.parse(text) as { version?: string; file_hash?: string };
    } catch {
      return null;
    }
  })();
  const version =
    previous?.file_hash === fileHash && options.version === undefined
      ? (previous.version ?? '1.0.0')
      : nextVersion(previous?.version ?? null, options.version);
  const labels = overrides.length > 0 ? [UNVERIFIED_LABEL] : [];
  const evidence = buildAgentEvidence({
    workspace,
    intake: readAgentIntake(workspace),
    version,
    fileHash,
    plan,
    source,
    lint,
    overrides,
    labels,
    sdkPath,
    maxBudgetUsd: sdkRunOptions(config).maxBudgetUsd,
    autoMemoryOff: memoryOff,
  });

  const lines: string[] = [];
  const changed: string[] = [];
  for (const file of plan.files) {
    if (writeIfChanged(projectRoot, file.path, file.content)) changed.push(file.path);
  }
  changed.push(...writeHookScripts(workspace));
  if (
    writeIfChanged(
      projectRoot,
      sdkPath,
      `${JSON.stringify(buildAgentDefinition(source), null, 2)}\n`,
    )
  ) {
    changed.push(sdkPath);
  }
  const unchanged = previous?.version === version && previous.file_hash === fileHash;
  const evidenceMissing = !existsSync(join(projectRoot, evidencePath));
  if (writeIfChanged(projectRoot, evidencePath, `${JSON.stringify(evidence, null, 2)}\n`)) {
    changed.push(evidencePath);
  }
  if (!unchanged || evidenceMissing) {
    writeChangelog(
      join(projectRoot, trackedDir, 'CHANGELOG.md'),
      workspace.name,
      version,
      changelogEntry(version, evidence),
    );
  }
  lines.push(
    changed.length === 0 && unchanged
      ? `${workspace.name} ${version} is already released with this content; nothing changed.`
      : unchanged && changed.length === 1 && changed[0] === evidencePath
        ? `${workspace.name} ${version} is unchanged; its evidence in ${evidencePath} was rewritten from the recorded gates.`
        : `Released ${workspace.name} ${version} into ${plan.files.map((file) => file.path).join(', ') || 'no host folder'}; the SDK form is ${sdkPath} and the evidence is ${evidencePath}.`,
  );
  lines.push(...plan.proposals);
  if (plan.plugin !== null && plan.plugin.settings_hooks.length > 0) {
    lines.push(
      `${workspace.name} is a plugin agent: add these SubagentStart and SubagentStop settings hooks, recorded in ${evidencePath}: ${plan.plugin.settings_hooks.map((hook) => `${hook.event} ${hook.matcher} ${hook.command}`).join('; ')}.`,
    );
  }

  const releasedHash = (path: string): string =>
    hashAgentFile(projectRoot, path, path.endsWith('.toml') ? [] : scripts);
  const record: AgentRecordBody = {
    agent: workspace.name,
    status: overrides.length > 0 ? 'overridden' : 'passed',
    version,
    released_path: plan.primary,
    file_hash: plan.primary === '' ? hashText(draftText) : releasedHash(plan.primary),
    hook_scripts: scripts,
    files: plan.files.map((file) => ({ path: file.path, hash: releasedHash(file.path) })),
    evidence_path: evidencePath,
    overrides: overrides.map(({ gate, reason, by, at }) => ({ gate, reason, by, at })),
    labels,
  };
  try {
    const written = writeAgentRecord(projectRoot, options.sessionId, record, options.now);
    lines.push(
      written.written ? `Recorded ${written.path}.` : `${written.path} is already current.`,
    );
  } catch (error) {
    if (!(error instanceof NoActiveFeatureError)) throw error;
    lines.push(`No change is active, so ${AGENT_RECORD_WRITER} wrote no bundle record.`);
  }
  workspace.writeJson('release.json', {
    gate: 'passed',
    stage: 'S7',
    version,
    paths: plan.files.map((file) => file.path),
    evidence: evidencePath,
    sdk: sdkPath,
  });
  return {
    ok: true,
    artifacts: [...plan.files.map((file) => file.path), sdkPath, evidencePath],
    lines,
  };
}
