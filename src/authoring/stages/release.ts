import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import { AdapterFactory } from '@/adapters/factory.js';
import { BaseAdapter } from '@/adapters/shared/base-adapter.js';
import { ADAPTER_TYPES, type AdapterType } from '@/core/types/adapter.js';
import { readProjectProfile } from '@/core/project-profile.js';
import {
  NoActiveFeatureError,
  writeSkillRecord,
  type SkillRecordBody,
} from '@/feature-evidence/artifacts.js';
import { splitSkillFrontmatter } from '@/skills/frontmatter-parser.js';

import { lastFiredBySkill } from '../activations.js';
import { readAuthoringConfig } from '../config.js';
import { readAuthoringDecision } from '../decisions.js';
import { driftLine, listDriftedFacts } from '../drift.js';
import { activeHost } from '../eval/adapters.js';
import { hashFolder, hashFolderWithoutDescription, listFolderFiles } from '../hash.js';
import { descriptionLength } from '../lint/fields.js';
import { lintSkillFolder } from '../lint/skill-lint.js';
import { budgetWarningLine, catalogBudget, discoverInstalledSkills } from '../overlap.js';
import { buildPortableSkill } from '../package/portable.js';
import { enabledAdapters, readSkillPathContext, SKILL_FILE } from '../paths.js';
import {
  AuthoringRefusal,
  readOverrides,
  requireEarlierGates,
  TRACKED_ROOT,
  type OverrideRecord,
  type SkillWorkspace,
} from '../workspace.js';
import { draftFolder, draftLintsAsRuntime, runtimeSkillSource } from './draft.js';
import { readWorkspaceSources } from './sources.js';
import { ALLOW_OPTION, RISKY_FILE, testInputsHash } from './test.js';
import type { StageResult } from './result.js';

export const EVIDENCE_SCHEMA_VERSION = '1';
export const UNVERIFIED_LABEL = 'unverified';

interface HashedArtifact {
  gate?: string;
  inputs_hash?: string | null;
}

export interface ReleaseOptions {
  version?: string;
  portable?: boolean;
  sessionId: string;
  now?: () => Date;
}

export function releaseTarget(workspace: SkillWorkspace, host: string): string {
  return runtimeSkillSource(workspace) ?? `${hostRoot(host)}/${workspace.name}`;
}

function hostRoot(host: string): string {
  const type = (ADAPTER_TYPES as readonly string[]).includes(host)
    ? (host as AdapterType)
    : 'claude-code';
  const adapter = AdapterFactory.create(type);
  if (!(adapter instanceof BaseAdapter)) {
    throw new AuthoringRefusal(`the ${host} adapter declares no skills folder.`);
  }
  return adapter.getSkillsRoot();
}

function checkHashes(workspace: SkillWorkspace, folder: string, overridden: Set<string>): void {
  const scriptTests = workspace.readJson<HashedArtifact & { test_location?: string }>(
    'script-tests.json',
  );
  const checks: Array<{
    stage: string;
    command: string;
    recorded: string | null | undefined;
    actual: () => string;
  }> = [
    {
      stage: 'S4',
      command: `paqad-ai skill test ${workspace.name}`,
      recorded: workspace.readJson<{ inputs_hash_without_description?: string }>('lint.json')
        ?.inputs_hash_without_description,
      actual: () => hashFolderWithoutDescription(folder),
    },
    {
      stage: 'S4',
      command: `paqad-ai skill test ${workspace.name}`,
      recorded: scriptTests?.inputs_hash,
      actual: () => testInputsHash(workspace.projectRoot, folder, scriptTests?.test_location ?? ''),
    },
    {
      stage: 'S5',
      command: `paqad-ai skill eval plan ${workspace.name}`,
      recorded: workspace.readJson<HashedArtifact>('benchmark.json')?.inputs_hash,
      actual: () => hashFolderWithoutDescription(folder),
    },
    {
      stage: 'S6',
      command: `paqad-ai skill trigger plan ${workspace.name}`,
      recorded: workspace.readJson<HashedArtifact>('trigger-results.json')?.inputs_hash,
      actual: () => hashFolder(folder),
    },
  ];
  for (const check of checks) {
    if (overridden.has(check.stage)) continue;
    if (!check.recorded || check.recorded !== check.actual()) {
      throw new AuthoringRefusal(
        `Release refused: the skill changed after ${check.stage} judged it. Rerun ${check.stage} (${check.command}) and the stages after it.`,
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

function copyIntoHost(source: string, target: string): void {
  for (const file of listFolderFiles(source)) {
    const abs = join(source, file.rel);
    if (lstatSync(abs).isSymbolicLink()) {
      throw new AuthoringRefusal(`Release refused: ${file.rel} is a symlink.`);
    }
  }
  rmSync(target, { recursive: true, force: true });
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target, { recursive: true, dereference: false, verbatimSymlinks: true });
}

function riskyAllowed(workspace: SkillWorkspace): string[] {
  const entries = workspace.readJson<Array<{ script: string; decision: string }>>(RISKY_FILE) ?? [];
  return entries
    .filter(
      (entry) =>
        readAuthoringDecision(workspace.projectRoot, entry.decision)?.chosen === ALLOW_OPTION,
    )
    .map((entry) => entry.script);
}

function changelogEntry(version: string, evidence: Record<string, unknown>): string {
  const benchmark = evidence.benchmark as { delta_points?: number | null } | null;
  const trigger = evidence.trigger as { validation_score?: number | null } | null;
  const labels = evidence.labels as string[];
  const parts = [
    benchmark?.delta_points == null
      ? 'evals: not measured'
      : `evals: ${benchmark.delta_points} points over the baseline`,
    trigger?.validation_score == null
      ? 'trigger: not measured'
      : `trigger validation score ${trigger.validation_score}`,
    ...(labels.length > 0 ? [`labels: ${labels.join(', ')}`] : []),
  ];
  return `## ${version}\n\n- ${parts.join('; ')}\n`;
}

export function runRelease(workspace: SkillWorkspace, options: ReleaseOptions): StageResult {
  requireEarlierGates(workspace, 'S7');
  const projectRoot = workspace.projectRoot;
  const config = readAuthoringConfig(projectRoot);
  const folder = workspace.path(draftFolder(workspace));
  if (!existsSync(join(folder, SKILL_FILE))) {
    throw new AuthoringRefusal(
      `Release refused: there is no draft in ${workspace.relPath(draftFolder(workspace))}.`,
    );
  }
  const overrides = readOverrides(workspace);
  const overridden = new Set(overrides.map((entry) => entry.gate));

  const lint = lintSkillFolder(folder, {
    projectRoot,
    claudeCode: enabledAdapters(projectRoot).includes('claude-code'),
    bodyMaxTokens: config.skill_body_max_tokens,
    paqadRuntime: draftLintsAsRuntime(workspace),
  });
  if (lint.blocking > 0) {
    throw new AuthoringRefusal(
      `Release refused: the final folder has ${lint.blocking} blocking lint finding(s). Rerun paqad-ai skill test ${workspace.name}.`,
    );
  }
  checkHashes(workspace, folder, overridden);

  const sources = readWorkspaceSources(workspace);
  const drifted = listDriftedFacts(
    sources,
    (options.now ?? (() => new Date()))(),
    config.authoring_fact_max_age_days,
  );
  if (drifted.length > 0) {
    throw new AuthoringRefusal(
      `Release refused: ${drifted.map((fact) => driftLine(fact, config.authoring_fact_max_age_days)).join(' ')}`,
    );
  }

  const host = activeHost(projectRoot);
  const target = releaseTarget(workspace, host);
  const trackedDir = `${TRACKED_ROOT}/${workspace.name}`;
  const evidencePath = `${trackedDir}/evidence.json`;
  const previous = (() => {
    try {
      return JSON.parse(readFileSync(join(projectRoot, evidencePath), 'utf8')) as {
        version?: string;
        folder_hash?: string;
      };
    } catch {
      return null;
    }
  })();
  const folderHash = hashFolder(folder);
  const version =
    previous?.folder_hash === folderHash && options.version === undefined
      ? (previous.version ?? '1.0.0')
      : nextVersion(previous?.version ?? null, options.version);

  const labels = overrides.length > 0 ? [UNVERIFIED_LABEL] : [];
  const evidence = buildSkillEvidence({
    workspace,
    version,
    host,
    folderHash,
    overrides,
    labels,
    lint,
    sources,
    config,
  });
  const evidenceText = `${JSON.stringify(evidence, null, 2)}\n`;
  const lines: string[] = [];

  const unchanged = previous?.version === version && previous.folder_hash === folderHash;
  if (!unchanged) {
    copyIntoHost(folder, join(projectRoot, target));
    mkdirSync(join(projectRoot, trackedDir), { recursive: true });
    writeFileSync(join(projectRoot, evidencePath), evidenceText, 'utf8');
    const changelogPath = join(projectRoot, trackedDir, 'CHANGELOG.md');
    const existing = existsSync(changelogPath)
      ? readFileSync(changelogPath, 'utf8')
      : `# ${workspace.name}\n`;
    const heading = `## ${version}\n`;
    if (!existing.includes(heading)) {
      const [title, ...rest] = existing.split('\n\n');
      writeFileSync(
        changelogPath,
        [(title ?? '').trimEnd(), changelogEntry(version, evidence).trimEnd(), ...rest]
          .join('\n\n')
          .trimEnd() + '\n',
        'utf8',
      );
    }
    lines.push(
      `Released ${workspace.name} ${version} into ${target}; evidence in ${evidencePath}.`,
    );
  } else {
    lines.push(
      `${workspace.name} ${version} is already released with this content; nothing changed.`,
    );
  }

  const record: SkillRecordBody = {
    skill: workspace.name,
    status: overrides.length > 0 ? 'overridden' : 'passed',
    version,
    released_path: target,
    folder_hash: folderHash,
    evidence_path: evidencePath,
    overrides: overrides.map(({ gate, reason, by, at }) => ({ gate, reason, by, at })),
    labels,
  };
  try {
    const written = writeSkillRecord(projectRoot, options.sessionId, record, options.now);
    lines.push(
      written.written ? `Recorded ${written.path}.` : `${written.path} is already current.`,
    );
  } catch (error) {
    if (!(error instanceof NoActiveFeatureError)) throw error;
    lines.push('No change is active, so no bundle record was written.');
  }

  const installed = discoverInstalledSkills(projectRoot, readSkillPathContext(projectRoot), {
    userHome: null,
  });
  const budget = catalogBudget({
    installed,
    budgetChars: config.authoring_description_budget_chars,
    lastFired: lastFiredBySkill(projectRoot),
  });
  const warning = budgetWarningLine(budget);
  if (warning) lines.push(warning);

  if (options.portable) {
    const portable = buildPortableSkill(workspace, folder, {
      unverified: labels.includes(UNVERIFIED_LABEL),
      allowedRiskyScripts: riskyAllowed(workspace),
    });
    if (portable.validation.exitCode !== 0) {
      throw new AuthoringRefusal(
        `The portable copy failed quick-validate: ${portable.validation.message}`,
      );
    }
    lines.push(`Wrote the portable copy to ${portable.path}; quick-validate exits 0.`);
  }
  workspace.writeJson('release.json', {
    gate: 'passed',
    stage: 'S7',
    version,
    path: target,
    evidence: evidencePath,
  });
  return { ok: true, artifacts: [target, evidencePath], lines };
}

interface EvidenceInput {
  workspace: SkillWorkspace;
  version: string;
  host: string;
  folderHash: string;
  overrides: OverrideRecord[];
  labels: string[];
  lint: { blocking: number; warnings: number };
  sources: ReturnType<typeof readWorkspaceSources>;
  config: ReturnType<typeof readAuthoringConfig>;
}

export function buildSkillEvidence(input: EvidenceInput): Record<string, unknown> {
  const { workspace } = input;
  const justification = workspace.read('justification.md') ?? '';
  const baselinePassed = /baseline_passed:\s*(\d+)/u.exec(justification)?.[1];
  const overlap = workspace.read('overlap.md') ?? '';
  const scriptTests = workspace.readJson<{
    test_exit_code?: number;
    scripts?: Array<{ checks: Array<{ status: string }> }>;
  }>('script-tests.json');
  const checks = (scriptTests?.scripts ?? []).flatMap((script) => script.checks);
  const benchmark = workspace.readJson<Record<string, unknown>>('benchmark.json');
  const trigger = workspace.readJson<Record<string, unknown>>('trigger-results.json');
  const history = (benchmark?.history as unknown[] | undefined) ?? [];
  const tokensMeasured = benchmark?.tokens === 'measured';
  const split = splitSkillFrontmatter(
    readFileSync(workspace.path(`${draftFolder(workspace)}/${SKILL_FILE}`), 'utf8'),
  );
  const description =
    split.ok && typeof split.data.description === 'string' ? split.data.description : '';
  const decisions = [
    ...input.overrides.map((entry) => entry.decision),
    ...(/decision:\s*(D-\S+)/u.exec(overlap)?.slice(1) ?? []),
    ...(workspace.readJson<Array<{ decision: string }>>(RISKY_FILE) ?? []).map(
      (entry) => entry.decision,
    ),
  ];
  return {
    schema_version: EVIDENCE_SCHEMA_VERSION,
    skill: workspace.name,
    version: input.version,
    host: input.host,
    folder_hash: input.folderHash,
    baseline: {
      runs: 3,
      passed: baselinePassed === undefined ? null : Number(baselinePassed),
      verdict: input.overrides.some((entry) => entry.gate === 'S0') ? 'overridden' : 'needed',
    },
    sources: {
      count: input.sources.length,
      non_model: input.sources.filter((row) => row.origin.toLowerCase() !== 'model').length,
      kind: /sources_kind:\s*no-repo/u.test(overlap) ? 'no-repo' : 'repo',
    },
    lint: { blocking: input.lint.blocking, warnings: input.lint.warnings },
    script_tests: {
      command: readProjectProfile(workspace.projectRoot)?.commands?.test ?? null,
      tests: checks.length,
      passed: checks.filter((check) => check.status === 'passed').length,
      skipped: checks.filter((check) => check.status === 'skipped').length,
    },
    benchmark: benchmark
      ? {
          iterations: history.length,
          pass_rate_with: benchmark.pass_rate_with ?? null,
          pass_rate_without: benchmark.pass_rate_baseline ?? null,
          delta_points: benchmark.delta_points ?? null,
          token_multiple: benchmark.token_multiple ?? null,
          models: benchmark.models ?? [],
          claude_version: benchmark.claude_version ?? null,
          checks_not_measured: benchmark.checks_not_measured ?? [],
          source: benchmark.adapter ?? null,
        }
      : null,
    trigger: trigger
      ? {
          validation_score: trigger.validation_score ?? null,
          description_chars: descriptionLength(description),
          batch: trigger.batch ?? 'not-offered',
        }
      : null,
    performance: {
      tokens: tokensMeasured ? 'measured' : 'unavailable',
      source: (benchmark?.adapter as string | undefined) ?? 'unavailable',
    },
    creation_cost: {
      S5: 'unavailable',
      S6: trigger?.cost_usd ?? 'unavailable',
      source: 'host-usage',
    },
    overrides: input.overrides.map(({ gate, reason, by, at }) => ({ gate, reason, by, at })),
    decisions: [...new Set(decisions)].sort(),
    labels: input.labels,
  };
}
