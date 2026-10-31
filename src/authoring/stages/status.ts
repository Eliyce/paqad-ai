import { readAuthoringDecision } from '../decisions.js';
import {
  allStageStates,
  gateSatisfied,
  readMode,
  type SkillWorkspace,
  type StageState,
} from '../workspace.js';
import { installedSkillFolder, isRegisteredSkill } from './improve.js';

export interface SkillStatus {
  skill: string;
  entry: 'justify' | 'improve';
  stages: StageState[];
  next: string | null;
  lines: string[];
}

function stateWords(workspace: SkillWorkspace, state: StageState): string {
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
  const improve = readMode(workspace).entry === 'improve';
  const entry: SkillStatus['entry'] = registered || improve ? 'improve' : 'justify';
  const stages = allStageStates(workspace);
  const lines: string[] = [];
  if (entry === 'improve') {
    const folder = installedSkillFolder(workspace);
    lines.push(
      improve
        ? `Entry: improve mode on ${workspace.name}.`
        : `Entry: paqad-ai skill improve ${workspace.name} (the skill is already installed${folder ? ` at ${folder}` : ''}).`,
    );
  } else {
    lines.push(`Entry: paqad-ai skill justify ${workspace.name} (a new skill).`);
  }
  for (const state of stages) {
    lines.push(
      `${state.stage.id} ${state.stage.name}: ${stateWords(workspace, state)} (${state.artifact})`,
    );
  }
  const stopped = stages.find((state) => state.state === 'stopped');
  let next: string | null = null;
  if (stopped) {
    lines.push(`The pipeline stopped at ${stopped.stage.id}, so no skill will be added.`);
  } else {
    const first = stages.find((state) => !gateSatisfied(state.state));
    if (first?.state === 'waiting') {
      next = first.detail;
      lines.push(`Next: answer decision ${first.decision}, then run ${first.detail}.`);
    } else if (first) {
      next =
        first.stage.id === 'S0' && entry === 'improve'
          ? `paqad-ai skill improve ${workspace.name}`
          : first.stage.command(workspace.name);
      lines.push(`Next: ${first.stage.id} ${first.stage.name}, run ${next}.`);
    } else {
      lines.push('Every stage has passed.');
    }
  }
  return { skill: workspace.name, entry, stages, next, lines };
}
