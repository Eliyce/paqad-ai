import { readEvents } from './events.js';
import { foldJourney } from './fold.js';
import { readRun } from './run-store.js';
import { stageDefinition, statusLine } from './stages.js';

export interface NextStep {
  done: boolean;
  stage: string | null;
  status_line: string | null;
  brief: string;
}

export function nextStep(projectRoot: string, now: () => Date): NextStep {
  const run = readRun(projectRoot);
  if (!run) {
    return {
      done: false,
      stage: null,
      status_line: null,
      brief: 'Run `paqad-ai onboarding start` first.',
    };
  }
  const fold = foldJourney(run, readEvents(projectRoot, run.run_id), { now });
  if (fold.current === null) {
    return {
      done: true,
      stage: null,
      status_line: null,
      brief:
        'Every step is done. Ask the commit question and answer with `paqad-ai onboarding commit`.',
    };
  }
  const stage = stageDefinition(fold.current);
  const record = run.stages[fold.current];
  const action =
    record.status === 'not_started'
      ? `Run \`paqad-ai onboarding stage start ${stage.id}\`.`
      : `Continue step ${stage.index} (${stage.name}), then run \`paqad-ai onboarding stage end ${stage.id}\`.`;
  return { done: false, stage: stage.id, status_line: statusLine(stage.id), brief: action };
}
