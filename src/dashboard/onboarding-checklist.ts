import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';

/**
 * Issue #146 — `/api/onboarding-checklist` (spec section 10).
 *
 * The checklist completes from real events, never from clicks: each step is
 * derived from artifacts on disk. The one exception the server cannot know,
 * "open your first receipt", is tracked client-side; the server reports
 * whether a receipt exists so the client can light the step up only when
 * there is something to open.
 */

export interface ChecklistStep {
  key: 'connect-agent' | 'first-gate' | 'first-decision' | 'first-receipt' | 'edit-instruction';
  /** Benefit-led label, spec section 10 order. */
  label: string;
  /** Where the step happens. */
  route: string;
  /** True when the underlying real event has happened. */
  done: boolean;
  /** One sentence shown under the label. */
  detail: string;
}

export interface OnboardingChecklist {
  steps: ChecklistStep[];
  /** True once every server-knowable step is done. */
  complete: boolean;
  /** A receipt exists, so the client may complete the receipt step on view. */
  receiptAvailable: boolean;
}

function fileHasContent(path: string): boolean {
  try {
    return existsSync(path) && readFileSync(path, 'utf8').trim().length > 0;
  } catch {
    return false;
  }
}

function dirHasEntries(path: string): boolean {
  try {
    return existsSync(path) && readdirSync(path).some((name) => !name.startsWith('.'));
  } catch {
    return false;
  }
}

export function buildOnboardingChecklist(projectRoot: string): OnboardingChecklist {
  const at = (relative: string): string => join(projectRoot, relative);

  const agentConnected =
    [PATHS.CLAUDE_MD, PATHS.AGENTS_MD, PATHS.ANTIGRAVITY_MD, PATHS.GEMINI_MD].some((entry) =>
      existsSync(at(entry)),
    ) && existsSync(at(PATHS.ONBOARDING_MANIFEST));

  const ledger = at(PATHS.EVIDENCE_LEDGER);
  let firstGatePassed = false;
  if (existsSync(ledger)) {
    try {
      firstGatePassed = readFileSync(ledger, 'utf8')
        .split('\n')
        .some((line) => line.includes('"verdict":"pass"') || line.includes('"verdict": "pass"'));
    } catch {
      firstGatePassed = false;
    }
  }

  const firstDecisionResolved = dirHasEntries(at(PATHS.DECISIONS_RESOLVED_DIR));
  const receiptAvailable = fileHasContent(at(PATHS.EVIDENCE_RECEIPT_CHAIN));

  let instructionEdited = false;
  const audit = at(PATHS.AUDIT_LOG);
  if (existsSync(audit)) {
    try {
      instructionEdited = readFileSync(audit, 'utf8').includes('dashboard.instructions.write');
    } catch {
      instructionEdited = false;
    }
  }

  const steps: ChecklistStep[] = [
    {
      key: 'connect-agent',
      label: 'Connect your agent',
      route: '#/setup',
      done: agentConnected,
      detail: agentConnected
        ? 'Your agent reads the entry file on every session.'
        : 'Run paqad-ai onboard so your agent loads the project contract.',
    },
    {
      key: 'first-gate',
      label: 'Watch your first gate pass',
      route: '#/trust',
      done: firstGatePassed,
      detail: firstGatePassed
        ? 'A verification gate has passed and is on the ledger.'
        : 'Ship one verified change and the gate lands here.',
    },
    {
      key: 'first-decision',
      label: 'Approve your first decision',
      route: '#/approvals',
      done: firstDecisionResolved,
      detail: firstDecisionResolved
        ? 'You have resolved a decision. The agent picked it up.'
        : 'When the agent pauses, the question arrives in Approvals.',
    },
    {
      key: 'first-receipt',
      label: 'Open your first receipt',
      route: '#/trust',
      done: false,
      detail: receiptAvailable
        ? 'A sealed receipt is waiting in Trust.'
        : 'Receipts appear after your first verified change.',
    },
    {
      key: 'edit-instruction',
      label: 'Edit one instruction file',
      route: '#/knowledge',
      done: instructionEdited,
      detail: instructionEdited
        ? 'Saved. Agents reload this automatically on their next session.'
        : 'Change one rule here and every agent learns it.',
    },
  ];

  return {
    steps,
    complete: steps.filter((step) => step.key !== 'first-receipt').every((step) => step.done),
    receiptAvailable,
  };
}
