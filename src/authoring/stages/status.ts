import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { readAuthoringDecision } from '../decisions.js';
import {
  allStageStates,
  gateSatisfied,
  readMode,
  type AuthoringWorkspace,
  type SkillWorkspace,
  type StageState,
} from '../workspace.js';
import { latestIteration, PARTIAL_FILE } from './eval.js';
import { installedSkillFolder, isRegisteredSkill } from './improve.js';

export interface SkillStatus {
  skill: string;
  entry: 'justify' | 'improve';
  stages: StageState[];
  next: string | null;
  lines: string[];
}

function stateWords(workspace: AuthoringWorkspace, state: StageState): string {
  switch (state.state) {
    case 'passed':
      return 'passed';
    case 'overridden':
      return 'overridden (unverified)';
    case 'skipped':
      return `skipped (${state.detail ?? 'improve mode'})`;
    case 'not-run':
      return 'not run yet';
    case 'failed':
      return `failed${state.detail ? `: ${state.detail}` : ''}`;
    case 'stopped':
      return `stopped${state.detail ? `: ${state.detail}` : ''}`;
    case 'waiting': {
      const record = state.decision
        ? readAuthoringDecision(workspace.projectRoot, state.decision)
        : null;
      const answered = record?.status === 'resolved';
      return answered
        ? `decision ${state.decision} is answered; resume with ${state.detail}`
        : `waiting on decision ${state.decision}; once it is answered, run ${state.detail}`;
    }
  }
}

export function skillStatus(workspace: SkillWorkspace): SkillStatus {
  const registered = isRegisteredSkill(workspace);
  return authoringStatus(workspace, registered, () => installedSkillFolder(workspace));
}

export function agentStatus(workspace: AuthoringWorkspace): SkillStatus {
  const registered = existsSync(
    join(workspace.projectRoot, workspace.trackedRoot, workspace.name, 'evidence.json'),
  );
  return authoringStatus(workspace, registered, () => null);
}

function authoringStatus(
  workspace: AuthoringWorkspace,
  registered: boolean,
  installedFolder: () => string | null,
): SkillStatus {
  const kind = workspace.kind;
  const improve = readMode(workspace).entry === 'improve';
  const entry: SkillStatus['entry'] = registered || improve ? 'improve' : 'justify';
  const stages = allStageStates(workspace);
  const lines: string[] = [];
  if (entry === 'improve') {
    const folder = installedFolder();
    lines.push(
      improve
        ? `Entry: improve mode on ${workspace.name}.`
        : `Entry: paqad-ai ${kind} improve ${workspace.name} (the ${kind} is already installed${folder ? ` at ${folder}` : ''}).`,
    );
  } else {
    lines.push(`Entry: paqad-ai ${kind} justify ${workspace.name} (a new ${kind}).`);
  }
  for (const state of stages) {
    lines.push(
      `${state.stage.id} ${state.stage.name}: ${stateWords(workspace, state)} (${state.artifact})`,
    );
  }
  const iteration = latestIteration(workspace);
  const partial = iteration !== null && workspace.exists(`iteration-${iteration}/${PARTIAL_FILE}`);
  if (partial) {
    lines.push(
      `Iteration ${iteration} is partial: some runs are missing, so it was not aggregated (${workspace.relPath(`iteration-${iteration}/${PARTIAL_FILE}`)}).`,
    );
  }
  const stopped = stages.find((state) => state.state === 'stopped');
  let next: string | null = null;
  if (stopped) {
    lines.push(`The pipeline stopped at ${stopped.stage.id}, so no ${kind} will be added.`);
  } else {
    const first = stages.find((state) => !gateSatisfied(state.state));
    if (first?.state === 'waiting') {
      next = first.detail;
      lines.push(`Next: answer decision ${first.decision}, then run ${first.detail}.`);
    } else if (first) {
      next =
        first.stage.id === 'S0' && entry === 'improve'
          ? `paqad-ai ${kind} improve ${workspace.name}`
          : first.stage.id === 'S5' && partial
            ? `paqad-ai ${kind} eval record ${workspace.name}`
            : first.stage.command(workspace.name);
      lines.push(`Next: ${first.stage.id} ${first.stage.name}, run ${next}.`);
    } else {
      lines.push('Every stage has passed.');
    }
  }
  return { skill: workspace.name, entry, stages, next, lines };
}
