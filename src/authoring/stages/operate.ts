import { join } from 'node:path';

import { buildSkillCatalogReport, renderCatalogLines } from '../catalog.js';
import { readAuthoringConfig } from '../config.js';
import { option, raiseAuthoringDecision, readAuthoringDecision } from '../decisions.js';
import { driftLine, listDriftedFacts } from '../drift.js';
import { activeHost } from '../eval/adapters.js';
import { listFolderFiles } from '../hash.js';
import { SKILL_FILE } from '../paths.js';
import { AuthoringRefusal, renderGateMarkdown, type SkillWorkspace } from '../workspace.js';
import { draftFolder } from './draft.js';
import { installedSkillFolder, runImprove } from './improve.js';
import type { StageResult } from './result.js';
import { readWorkspaceSources } from './sources.js';

export const LEARN_FILE = 'learn.json';
export const IMPROVE_OPTION = 'improve';
export const LEAVE_OPTION = 'leave';
export const RETIRE_OPTION = 'retire';
export const KEEP_OPTION = 'keep';

interface PendingLearn {
  correction: string;
  scope: string;
  source: string;
  decision: string;
}

export function runLearn(
  workspace: SkillWorkspace,
  input: { correction: string; scope: string; source: string; change?: string | null },
): StageResult {
  if (installedSkillFolder(workspace) === null) {
    throw new AuthoringRefusal(
      `There is no installed skill named ${workspace.name} to learn from.`,
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
    context: `Seen in ${input.scope} (${input.source}). On yes it goes under ## Gotchas and the evals run again before the change is accepted.`,
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
  const pending: PendingLearn = {
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
      `Asked decision ${decision}. Once it is answered, run paqad-ai skill learn ${workspace.name} --decision ${decision}.`,
    ],
  };
}

export function gotchaLine(pending: PendingLearn, date: string): string {
  return `- learned ${date} in ${pending.scope} (${pending.source}): ${pending.correction}`;
}

export function appendGotcha(skillText: string, line: string): string {
  const lines = skillText.replace(/\s*$/u, '').split('\n');
  const heading = lines.findIndex((entry) => /^##\s+Gotchas\s*$/u.test(entry));
  if (heading === -1) return `${lines.join('\n')}\n\n## Gotchas\n\n${line}\n`;
  let end = heading + 1;
  while (end < lines.length && !/^#{1,2}\s/u.test(lines[end]!)) end += 1;
  let insertAt = end;
  while (insertAt > heading + 1 && lines[insertAt - 1]!.trim() === '') insertAt -= 1;
  const before = lines.slice(0, insertAt);
  if (before.at(-1)?.trim() === lines[heading]) before.push('');
  return [...before, line, ...lines.slice(insertAt)].join('\n') + '\n';
}

export function resolveLearn(
  workspace: SkillWorkspace,
  input: { decision: string; now?: () => Date },
): StageResult {
  const pending = workspace.readJson<PendingLearn>(LEARN_FILE);
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
  runImprove(workspace);
  const source = installedSkillFolder(workspace)!;
  const target = draftFolder(workspace);
  if (!workspace.exists(`${target}/${SKILL_FILE}`)) {
    for (const file of listFolderFiles(join(workspace.projectRoot, source))) {
      workspace.write(`${target}/${file.rel}`, file.bytes.toString('utf8'));
    }
  }
  const date = (input.now ?? (() => new Date()))().toISOString().slice(0, 10);
  const skillText = workspace.read(`${target}/${SKILL_FILE}`) ?? '';
  workspace.write(`${target}/${SKILL_FILE}`, appendGotcha(skillText, gotchaLine(pending, date)));
  return {
    ok: true,
    artifacts: [workspace.relPath(`${target}/${SKILL_FILE}`)],
    lines: [
      `Added the correction under ## Gotchas in the ${workspace.name} draft. Rerun its checks from paqad-ai skill test ${workspace.name}, then eval plan, trigger plan and release.`,
    ],
  };
}

export function runDrift(workspace: SkillWorkspace, input: { now?: () => Date } = {}): StageResult {
  const config = readAuthoringConfig(workspace.projectRoot);
  const now = (input.now ?? (() => new Date()))();
  const drifted = listDriftedFacts(
    readWorkspaceSources(workspace),
    now,
    config.authoring_fact_max_age_days,
  );
  const body =
    drifted.length === 0
      ? 'Every externally verified fact is fresh.\n'
      : `${drifted.map((fact) => `- ${driftLine(fact, config.authoring_fact_max_age_days)}`).join('\n')}\n`;
  const artifact = workspace.write(
    'drift.md',
    renderGateMarkdown(
      { gate: drifted.length === 0 ? 'passed' : 'failed', drifted: drifted.length },
      `# Drift: ${workspace.name}\n\n${body}`,
    ),
  );
  return {
    ok: drifted.length === 0,
    artifacts: [artifact],
    lines:
      drifted.length === 0
        ? [`${workspace.name}: every externally verified fact is fresh.`]
        : drifted.map((fact) => driftLine(fact, config.authoring_fact_max_age_days)),
  };
}

export function retirementDecision(
  projectRoot: string,
  input: { skill: string; why: string; change?: string | null },
): string {
  return raiseAuthoringDecision(projectRoot, {
    category: 'authoring.retirement',
    title: `Retire the skill ${input.skill}?`,
    context: input.why,
    options: [
      option(
        RETIRE_OPTION,
        'Retire it',
        `If you pick this, ${input.skill} is removed from the catalog.`,
        'You give up: the skill.',
      ),
      option(
        KEEP_OPTION,
        'Keep it',
        `If you pick this, ${input.skill} stays as it is.`,
        'You give up: its listing space.',
      ),
    ],
    recommendation: RETIRE_OPTION,
    change: input.change,
  });
}

export function runCatalog(
  projectRoot: string,
  input: { now?: () => Date; proposeRetirement?: boolean; change?: string | null } = {},
): StageResult {
  const config = readAuthoringConfig(projectRoot);
  const report = buildSkillCatalogReport({
    projectRoot,
    host: activeHost(projectRoot),
    now: (input.now ?? (() => new Date()))(),
    darkWindowDays: config.authoring_dark_window_days,
    collisionThreshold: config.authoring_collision_jaccard,
  });
  const lines = renderCatalogLines(report);
  let decision: string | undefined;
  if (input.proposeRetirement) {
    for (const row of report.skills.filter((entry) => entry.dark)) {
      decision = retirementDecision(projectRoot, {
        skill: row.skill,
        why: `${row.skill} has not fired in ${report.window_days} days and costs ${row.listing_chars} characters of every listing.`,
        change: input.change,
      });
      lines.push(`Proposed retiring ${row.skill}: decision ${decision}.`);
    }
  }
  const result: StageResult = { ok: true, artifacts: [], lines };
  if (decision) result.decision = decision;
  return result;
}
