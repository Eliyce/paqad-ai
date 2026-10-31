import { lastFiredBySkill } from '../activations.js';
import { readAuthoringConfig } from '../config.js';
import { option, raiseAuthoringDecision, readAuthoringDecision } from '../decisions.js';
import {
  budgetWarningLine,
  buildOverlapReport,
  candidateText,
  discoverInstalledSkills,
  renderOverlapReport,
  shadowingLine,
  type InstalledArtifact,
} from '../overlap.js';
import { readSkillPathContext } from '../paths.js';
import {
  AuthoringRefusal,
  clearWaiting,
  renderGateMarkdown,
  requireEarlierGates,
  setWaiting,
  type SkillWorkspace,
} from '../workspace.js';
import { readWorkspaceIntake } from './intake.js';
import { stageResult, type StageResult } from './result.js';

export const SOURCE_COLUMNS = ['S-ID', 'Fact', 'Origin', 'Date', 'Verified'] as const;
export const MODEL_ORIGIN = 'model';
export const EXTEND_OPTION = 'extend';
export const CREATE_OPTION = 'create-new';

export interface SourceRow {
  id: string;
  fact: string;
  origin: string;
  date: string;
  verified: string;
  line: number;
}

function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/u, '')
    .replace(/\|$/u, '')
    .split('|')
    .map((cell) => cell.trim());
}

export function parseSources(text: string): SourceRow[] {
  const rows: SourceRow[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (!line.trim().startsWith('|')) return;
    const [id, fact, origin, date, verified] = cells(line);
    if (!id || !/^S-\d+$/u.test(id)) return;
    rows.push({
      id,
      fact: fact ?? '',
      origin: origin ?? '',
      date: date ?? '',
      verified: verified ?? '',
      line: index + 1,
    });
  });
  return rows;
}

export function readWorkspaceSources(workspace: SkillWorkspace): SourceRow[] {
  const text = workspace.read('sources.md');
  return text === null ? [] : parseSources(text);
}

export interface EvidenceInput {
  sourcesText: string;
  sourcesKind?: string;
  decision?: string;
  change?: string | null;
  userHome?: string | null;
  installed?: readonly InstalledArtifact[];
}

export interface EvidenceResult extends StageResult {
  extend?: string;
}

function overlapDecision(workspace: SkillWorkspace, decisionId: string): { chosen: string } {
  const record = readAuthoringDecision(workspace.projectRoot, decisionId);
  if (record === null || record.category !== 'authoring.overlap') {
    throw new AuthoringRefusal(`${decisionId} is not an authoring.overlap decision.`);
  }
  if (record.status !== 'resolved' || record.chosen === null) {
    throw new AuthoringRefusal(`${decisionId} is not answered yet. Ask it first, then rerun.`);
  }
  return { chosen: record.chosen };
}

export function runEvidence(workspace: SkillWorkspace, input: EvidenceInput): EvidenceResult {
  requireEarlierGates(workspace, 'S2');
  const rows = parseSources(input.sourcesText);
  if (rows.length === 0) {
    throw new AuthoringRefusal(
      `S2 evidence failed: sources.md has no rows. Use the columns ${SOURCE_COLUMNS.join(' | ')}, one row per fact.`,
    );
  }
  const grounded = rows.filter((row) => row.origin.toLowerCase() !== MODEL_ORIGIN);
  if (grounded.length === 0) {
    throw new AuthoringRefusal(
      'S2 evidence failed: every source has origin "model". Add at least one fact from the trace, ' +
        'the repository, the web or the interview.',
    );
  }
  if (input.sourcesKind !== undefined && input.sourcesKind !== 'no-repo') {
    throw new AuthoringRefusal('--sources-kind only accepts no-repo.', 2);
  }
  const intake = readWorkspaceIntake(workspace);
  if (intake === null) {
    throw new AuthoringRefusal(
      `S2 evidence can't start: ${workspace.relPath('intake.yaml')} is missing. Run paqad-ai skill intake ${workspace.name} <intake.yaml> first.`,
    );
  }
  const config = readAuthoringConfig(workspace.projectRoot);
  const installed =
    input.installed ??
    discoverInstalledSkills(workspace.projectRoot, readSkillPathContext(workspace.projectRoot), {
      userHome: input.userHome,
    });
  const report = buildOverlapReport({
    candidate: {
      kind: 'skill',
      name: workspace.name,
      text: candidateText(intake.purpose, intake.triggers),
      scope: 'project',
    },
    installed,
    threshold: config.authoring_collision_jaccard,
    budgetChars: config.authoring_description_budget_chars,
    lastFired: lastFiredBySkill(workspace.projectRoot),
  });

  const sourcesArtifact = workspace.write('sources.md', input.sourcesText);
  const lines: string[] = [];
  const warning = budgetWarningLine(report.budget);
  if (warning) lines.push(warning);

  const decided = input.decision ? overlapDecision(workspace, input.decision) : null;
  if (decided?.chosen === EXTEND_OPTION && report.collisions.length > 0) {
    const existing = report.collisions[0]!.existing;
    workspace.clear();
    return {
      ok: false,
      extend: existing,
      stopped: true,
      artifacts: [],
      lines: [
        `Extend chosen: I cleared the ${workspace.name} workspace. Continue on the installed skill with paqad-ai skill improve ${existing}.`,
      ],
    };
  }

  let gate: 'passed' | 'failed' | 'waiting' = 'passed';
  let reason: string | undefined;
  if (report.shadowing.length > 0) {
    gate = 'failed';
    reason = 'name shadowing';
    lines.push(...report.shadowing.map(shadowingLine));
  } else if (report.collisions.length > 0 && decided?.chosen !== CREATE_OPTION) {
    gate = 'waiting';
    reason = 'unresolved collision';
  }

  let decisionId: string | undefined;
  if (gate === 'waiting') {
    const collision = report.collisions[0]!;
    decisionId = raiseAuthoringDecision(workspace.projectRoot, {
      category: 'authoring.overlap',
      title: `The new skill ${workspace.name} overlaps ${collision.existing}. Extend ${collision.existing}, or create a new skill?`,
      context:
        `The overlap check scored ${workspace.name} against ${collision.existing} at ` +
        `${collision.score.toFixed(2)}, at or above the collision threshold of ${report.threshold}.`,
      options: [
        option(
          EXTEND_OPTION,
          `Extend ${collision.existing}`,
          `If you pick this, ${collision.existing} is improved instead and no new skill is added.`,
          'You give up: a separate skill for this job.',
        ),
        option(
          CREATE_OPTION,
          'Create a new skill',
          `If you pick this, ${workspace.name} is added beside ${collision.existing}.`,
          'You give up: one place for this job; the two may compete for the same requests.',
        ),
      ],
      recommendation: EXTEND_OPTION,
      change: input.change,
    });
    const resume = `paqad-ai skill evidence ${workspace.name} <sources.md> --decision ${decisionId}`;
    setWaiting(workspace, { stage: 'S2', decision: decisionId, resume });
    lines.push(
      `${workspace.name} collides with ${collision.existing}. S2 is waiting on decision ${decisionId}; once it is answered, run ${resume}.`,
    );
  } else {
    clearWaiting(workspace, 'S2');
  }

  const overlapArtifact = workspace.write(
    'overlap.md',
    renderGateMarkdown(
      {
        gate,
        stage: 'S2',
        ...(reason ? { reason } : {}),
        collisions: report.collisions.length,
        sources: rows.length,
        non_model_sources: grounded.length,
        ...(input.sourcesKind ? { sources_kind: input.sourcesKind } : {}),
        ...(decisionId ? { decision: decisionId } : {}),
        ...(input.decision ? { resolved_by: input.decision } : {}),
      },
      renderOverlapReport(report),
    ),
  );
  if (gate === 'passed') {
    lines.push(
      `S2 evidence passed: ${grounded.length} of ${rows.length} sources come from outside the model and nothing collides.`,
      `Next: paqad-ai skill draft ${workspace.name} --dir <folder> --trace <trace.md>`,
    );
  }
  const result: EvidenceResult = stageResult(gate === 'passed', lines, [
    sourcesArtifact,
    overlapArtifact,
  ]);
  if (decisionId) result.decision = decisionId;
  return result;
}
