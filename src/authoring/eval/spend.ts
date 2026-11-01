import { option, raiseAuthoringDecision } from '../decisions.js';
import type { AuthoringWorkspace } from '../workspace.js';

export const SPEND_FILE = 'spend.json';
export const SPEND_CONTINUE = 'continue';
export const SPEND_STOP = 'stop';

export interface SpendRecord {
  planned: Record<string, number>;
  spent: Record<string, number>;
  decision: string | null;
}

export function readSpend(workspace: AuthoringWorkspace): SpendRecord {
  const stored = workspace.readJson<Partial<SpendRecord>>(SPEND_FILE);
  return {
    planned: stored?.planned ?? {},
    spent: stored?.spent ?? {},
    decision: stored?.decision ?? null,
  };
}

function sum(values: Record<string, number>): number {
  return Math.round(Object.values(values).reduce((total, value) => total + value, 0) * 1e6) / 1e6;
}

export function worstCaseTotal(record: SpendRecord): number {
  return sum(record.planned);
}

export function spentTotal(record: SpendRecord): number {
  return sum(record.spent);
}

export function planSpend(
  workspace: AuthoringWorkspace,
  key: string,
  worstCaseUsd: number,
): number {
  const record = readSpend(workspace);
  record.planned[key] = worstCaseUsd;
  workspace.writeJson(SPEND_FILE, record);
  return worstCaseTotal(record);
}

export interface SpendCheck {
  spent_usd: number;
  worst_case_usd: number;
  decision: string | null;
  raised: boolean;
}

export function recordSpend(
  workspace: AuthoringWorkspace,
  key: string,
  usd: number,
  change?: string | null,
): SpendCheck {
  const record = readSpend(workspace);
  record.spent[key] = usd;
  const spent = spentTotal(record);
  const worst = worstCaseTotal(record);
  let raised = false;
  if (record.decision === null && worst > 0 && spent >= worst) {
    record.decision = raiseAuthoringDecision(workspace.projectRoot, {
      category: 'authoring.override',
      title: `Creating the ${workspace.kind} ${workspace.name} has spent $${spent}, the worst case printed up front. Continue?`,
      context: `The planned runs could cost at most $${worst}, and the real spend has reached $${spent}.`,
      options: [
        option(
          SPEND_CONTINUE,
          'Continue',
          'If you pick this, the remaining runs go ahead.',
          'You give up: the money the remaining runs cost.',
        ),
        option(
          SPEND_STOP,
          'Stop here',
          `If you pick this, no more runs start and ${workspace.name} is judged on what ran.`,
          'You give up: the iterations that did not run.',
        ),
      ],
      recommendation: SPEND_STOP,
      change,
    });
    raised = true;
  }
  workspace.writeJson(SPEND_FILE, record);
  return { spent_usd: spent, worst_case_usd: worst, decision: record.decision, raised };
}
