import { PATHS } from '@/core/constants/paths.js';
import type { SchemaValidationIssue } from '@/validators/validator.js';

import {
  readManagedFile,
  writeManagedFile,
  type ManagedFile,
  type WriteManagedFileResult,
} from './write-pipeline.js';

/**
 * Issue #146: `/api/config/decision-contract`. The contract is free-form
 * markdown the agent reads verbatim, so the only structural guard is the
 * canonical H1: a save that drops `# Decision Pause Contract` would leave
 * agents unable to recognize the document. Writes carry the raw markdown
 * and run the section 6.2 pipeline: guarded write, audit, SSE (the server
 * broadcasts after every mutation).
 */

const REQUIRED_HEADING = '# Decision Pause Contract';

export class DecisionContractValidationError extends Error {
  readonly issues: SchemaValidationIssue[];

  constructor(message: string, issues: SchemaValidationIssue[]) {
    super(message);
    this.name = 'DecisionContractValidationError';
    this.issues = issues;
  }
}

export function getDecisionContract(projectRoot: string): ManagedFile {
  return readManagedFile(projectRoot, PATHS.DECISION_PAUSE_CONTRACT);
}

export interface PutDecisionContractInput {
  content: string;
  baseHash: string | null;
}

export function putDecisionContract(
  projectRoot: string,
  input: PutDecisionContractInput,
): WriteManagedFileResult {
  if (input.content.trim().length === 0) {
    throw new DecisionContractValidationError('The contract cannot be empty.', [
      { path: '/', message: 'Expected non-empty markdown.' },
    ]);
  }
  const hasHeading = input.content.split(/\r?\n/).some((line) => line.trim() === REQUIRED_HEADING);
  if (!hasHeading) {
    throw new DecisionContractValidationError(
      `The contract must keep the "${REQUIRED_HEADING}" heading.`,
      [{ path: '/', message: `Missing the "${REQUIRED_HEADING}" heading.` }],
    );
  }

  return writeManagedFile(projectRoot, {
    relativePath: PATHS.DECISION_PAUSE_CONTRACT,
    content: input.content,
    baseHash: input.baseHash,
    action: 'dashboard.config.decision-contract.write',
  });
}
