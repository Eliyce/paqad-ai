import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { readAllFeatureEvidence } from '@/feature-evidence/projections.js';
import { readAllFeatureReceipts } from '@/feature-evidence/receipt.js';

export interface ChecklistStep {
  key: 'connect-agent' | 'first-gate' | 'first-decision' | 'first-receipt' | 'edit-instruction';
  label: string;
  route: string;
  done: boolean;
  detail: string;
}

export interface OnboardingChecklist {
  steps: ChecklistStep[];
  complete: boolean;
  receiptAvailable: boolean;
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

  const firstGatePassed = readAllFeatureEvidence(projectRoot).some((row) => row.verdict === 'pass');

  const firstDecisionResolved = dirHasEntries(at(PATHS.DECISIONS_RESOLVED_DIR));
  const receiptAvailable = readAllFeatureReceipts(projectRoot).length > 0;

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
