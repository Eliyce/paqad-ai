import { join } from 'node:path';

import { EXPERT_OWNS } from '@/spec-pipeline/experts/roster.js';

import { readAuthoringConfig } from '../config.js';
import { option, raiseAuthoringDecision } from '../decisions.js';
import { readTextIfPresent } from '../fs-io.js';
import {
  buildOverlapReport,
  discoverInstalledAgents,
  expertCollisionLine,
  expertCollisions,
  findSubsetOverlaps,
  renderOverlapReport,
  shadowingLine,
  type ExpertCollision,
  type ExpertProfile,
  type InstalledArtifact,
  type OverlapCollision,
} from '../overlap.js';
import { readSkillPathContext } from '../paths.js';
import {
  AuthoringRefusal,
  clearWaiting,
  renderGateMarkdown,
  requireEarlierGates,
  setWaiting,
  type AuthoringWorkspace,
} from '../workspace.js';
import { readAgentIntake } from './agent-intake.js';
import { stageResult, type StageResult } from './result.js';
import { CREATE_OPTION, EXTEND_OPTION, groundedSources, overlapDecision } from './sources.js';

export const LENS_ROOT = 'runtime/base/skills/expert-notes/references/lenses';

export interface AgentEvidenceInput {
  sourcesText: string;
  decision?: string;
  change?: string | null;
  userHome?: string | null;
  installed?: readonly InstalledArtifact[];
  owns?: string;
  lensText?: string;
  roster?: readonly ExpertProfile[];
}

export interface AgentEvidenceResult extends StageResult {
  extend?: string;
}

export function expertRosterProfiles(projectRoot: string): ExpertProfile[] {
  return Object.entries(EXPERT_OWNS).map(([role, owns]) => {
    const lens = readTextIfPresent(join(projectRoot, LENS_ROOT, `${role}.md`));
    return lens === null ? { role, owns } : { role, owns, lens };
  });
}

function expertCandidate(
  workspace: AuthoringWorkspace,
  input: AgentEvidenceInput,
): ExpertProfile | null {
  const owns = input.owns ?? EXPERT_OWNS[workspace.name];
  if (owns === undefined) return null;
  const lens =
    input.lensText ??
    readTextIfPresent(join(workspace.projectRoot, LENS_ROOT, `${workspace.name}.md`));
  return lens === null ? { role: workspace.name, owns } : { role: workspace.name, owns, lens };
}

function mergeCollisions(
  described: readonly OverlapCollision[],
  subsets: readonly OverlapCollision[],
): OverlapCollision[] {
  const seen = new Set(described.map((collision) => collision.existing));
  return [...described, ...subsets.filter((collision) => !seen.has(collision.existing))];
}

function raiseOverlap(
  workspace: AuthoringWorkspace,
  collision: OverlapCollision,
  threshold: number,
  change: string | null | undefined,
): string {
  const why = collision.subset
    ? `${workspace.name}'s tools are all in ${collision.existing} and its job is contained in ` +
      `${collision.existing}'s description at ${collision.score.toFixed(2)}.`
    : `The overlap check scored ${workspace.name} against ${collision.existing} at ` +
      `${collision.score.toFixed(2)}, at or above the collision threshold of ${threshold}.`;
  return raiseAuthoringDecision(workspace.projectRoot, {
    category: 'authoring.overlap',
    title: `The new agent ${workspace.name} overlaps ${collision.existing}. Extend ${collision.existing}, or create a new one?`,
    context: why,
    options: [
      option(
        EXTEND_OPTION,
        `Extend ${collision.existing}`,
        `If you pick this, ${collision.existing} is improved instead and no new agent is added.`,
        'You give up: a separate agent for this job.',
      ),
      option(
        CREATE_OPTION,
        'Create a new one',
        `If you pick this, ${workspace.name} is added beside ${collision.existing}.`,
        'You give up: one agent for this job; the two may compete for the same requests.',
      ),
    ],
    recommendation: EXTEND_OPTION,
    change,
  });
}

function renderExpertSection(collisions: readonly ExpertCollision[]): string {
  if (collisions.length === 0) return '\n## Expert roster\n\nNo expert collision.\n';
  return `\n## Expert roster\n\n${collisions.map((entry) => `- ${expertCollisionLine(entry)}`).join('\n')}\n`;
}

export function runAgentEvidence(
  workspace: AuthoringWorkspace,
  input: AgentEvidenceInput,
): AgentEvidenceResult {
  requireEarlierGates(workspace, 'S2');
  const { rows, grounded } = groundedSources(input.sourcesText);
  const intake = readAgentIntake(workspace);
  if (intake === null) {
    throw new AuthoringRefusal(
      `S2 evidence can't start: ${workspace.relPath('intake.yaml')} is missing. Run paqad-ai agent intake ${workspace.name} <intake.yaml> first.`,
    );
  }
  const config = readAuthoringConfig(workspace.projectRoot);
  const installed =
    input.installed ??
    discoverInstalledAgents(workspace.projectRoot, readSkillPathContext(workspace.projectRoot), {
      userHome: input.userHome,
    });
  const report = buildOverlapReport({
    candidate: { kind: 'agent', name: workspace.name, text: intake.job, scope: 'project' },
    installed,
    threshold: config.authoring_collision_jaccard,
    budgetChars: Number.MAX_SAFE_INTEGER,
  });
  report.collisions = mergeCollisions(
    report.collisions,
    findSubsetOverlaps({ name: workspace.name, job: intake.job, tools: intake.tools }, installed),
  );
  const candidate = expertCandidate(workspace, input);
  const experts =
    candidate === null
      ? []
      : expertCollisions(
          input.roster ?? expertRosterProfiles(workspace.projectRoot),
          config.authoring_collision_jaccard,
          candidate,
        );

  const sourcesArtifact = workspace.write('sources.md', input.sourcesText);
  const lines: string[] = [];
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
        `Extend chosen: I cleared the ${workspace.name} workspace. Continue on the installed agent with paqad-ai agent improve ${existing}.`,
      ],
    };
  }

  let gate: 'passed' | 'failed' | 'waiting' = 'passed';
  let reason: string | undefined;
  if (report.shadowing.length > 0) {
    gate = 'failed';
    reason = 'name shadowing';
    lines.push(...report.shadowing.map(shadowingLine));
  } else if (experts.length > 0) {
    gate = 'failed';
    reason = 'expert collision';
    lines.push(...experts.map(expertCollisionLine));
  } else if (report.collisions.length > 0 && decided?.chosen !== CREATE_OPTION) {
    gate = 'waiting';
    reason = 'unresolved collision';
  }

  let decisionId: string | undefined;
  if (gate === 'waiting') {
    const collision = report.collisions[0]!;
    decisionId = raiseOverlap(workspace, collision, report.threshold, input.change);
    const resume = `paqad-ai agent evidence ${workspace.name} <sources.md> --decision ${decisionId}`;
    setWaiting(workspace, { stage: 'S2', decision: decisionId, resume });
    lines.push(
      `${workspace.name} overlaps ${collision.existing}. S2 is waiting on decision ${decisionId}; once it is answered, run ${resume}.`,
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
        expert_collisions: experts.length,
        sources: rows.length,
        non_model_sources: grounded.length,
        ...(decisionId ? { decision: decisionId } : {}),
        ...(input.decision ? { resolved_by: input.decision } : {}),
      },
      `${renderOverlapReport(report)}${renderExpertSection(experts)}`,
    ),
  );
  if (gate === 'passed') {
    lines.push(
      `S2 evidence passed: ${grounded.length} of ${rows.length} sources come from outside the model and nothing overlaps.`,
      `Next: paqad-ai agent draft ${workspace.name} --file <agent.md> --trace <trace.md>`,
    );
  }
  const result: AgentEvidenceResult = stageResult(gate === 'passed', lines, [
    sourcesArtifact,
    overlapArtifact,
  ]);
  if (decisionId) result.decision = decisionId;
  return result;
}
