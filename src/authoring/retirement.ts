import { raiseTechDebt } from '@/tech-debt/index.js';

import { forEachActivation } from './activations.js';
import { retirementDecision } from './stages/operate.js';

export const RETIREMENT_WINDOW_DAYS = 30;
const DAY_MS = 86_400_000;

export interface RetirementStepInput {
  projectRoot: string;
  skills: readonly string[];
  now: Date;
  change?: string | null;
}

export type RetirementStepResult =
  | { outcome: 'follow-up'; due: string; debtId: string }
  | { outcome: 'packets'; decisions: { skill: string; decision: string }[] };

interface ActivationLog {
  firstAt: number | null;
  fired: Set<string>;
}

function readActivationLog(projectRoot: string, windowStart: number, end: number): ActivationLog {
  const log: ActivationLog = { firstAt: null, fired: new Set() };
  forEachActivation(projectRoot, (row) => {
    const at = Date.parse(row.at);
    if (Number.isNaN(at)) return;
    if (log.firstAt === null || at < log.firstAt) log.firstAt = at;
    if (at >= windowStart && at <= end) log.fired.add(row.skill);
  });
  return log;
}

function isoDay(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

export function runRetirementStep(input: RetirementStepInput): RetirementStepResult {
  const end = input.now.getTime();
  const windowMs = RETIREMENT_WINDOW_DAYS * DAY_MS;
  const log = readActivationLog(input.projectRoot, end - windowMs, end);
  const firstAt = log.firstAt ?? end;
  if (end - firstAt < windowMs) {
    const due = isoDay(firstAt + windowMs);
    const debt = raiseTechDebt(
      input.projectRoot,
      {
        title: `Raise the skill retirement packets once the activation log holds ${RETIREMENT_WINDOW_DAYS} days (due ${due})`,
        kind: 'follow-up',
        severity: 'low',
        files: [],
        body:
          `The activation log is younger than ${RETIREMENT_WINDOW_DAYS} days, so a never-fired ` +
          `skill cannot be told apart from a new log. On ${due}, run the retirement step again.\n`,
        foundIn: { change: input.change ?? null, issue: null, stage: null },
      },
      input.now,
    );
    return { outcome: 'follow-up', due, debtId: debt.id };
  }
  const decisions = [...new Set(input.skills)]
    .filter((skill) => !log.fired.has(skill))
    .sort()
    .map((skill) => ({
      skill,
      decision: retirementDecision(input.projectRoot, {
        skill,
        why: `${skill} has not fired in the ${RETIREMENT_WINDOW_DAYS} days up to ${isoDay(end)}.`,
        change: input.change,
      }),
    }));
  return { outcome: 'packets', decisions };
}
