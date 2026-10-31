import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';

export const AUTHORING_LEDGER_DIR = `${PATHS.EVIDENCE_LEDGER_DIR}/authoring`;
export const DEFECTS_LEDGER = `${AUTHORING_LEDGER_DIR}/defects.jsonl`;

export interface AuthoringDefect {
  skill: string;
  gate: string;
  evidence_path: string;
  at: string;
}

export function appendAuthoringDefect(projectRoot: string, defect: AuthoringDefect): void {
  const path = join(projectRoot, DEFECTS_LEDGER);
  mkdirSync(dirname(path), { recursive: true });
  const line = JSON.stringify({
    skill: defect.skill,
    gate: defect.gate,
    evidence_path: defect.evidence_path,
    at: defect.at,
  });
  appendFileSync(path, `${line}\n`, 'utf8');
}

function isDefect(value: unknown): value is AuthoringDefect {
  const row = value as Partial<AuthoringDefect> | null;
  return (
    typeof row === 'object' &&
    row !== null &&
    typeof row.skill === 'string' &&
    typeof row.gate === 'string' &&
    typeof row.evidence_path === 'string' &&
    typeof row.at === 'string'
  );
}

export function readAuthoringDefects(projectRoot: string): AuthoringDefect[] {
  let text: string;
  try {
    text = readFileSync(join(projectRoot, DEFECTS_LEDGER), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const defects: AuthoringDefect[] = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (isDefect(parsed)) defects.push(parsed);
  }
  return defects;
}

export function gateFailureReceiptLine(skill: string, gate: string, evidencePath: string): string {
  return (
    `I couldn't get the skill ${skill} through its ${gate} check, so I didn't add it. ` +
    `The evidence is in ${evidencePath}. This is ours to fix, not yours.`
  );
}

export function recordGateFailure(
  projectRoot: string,
  input: { skill: string; gate: string; evidencePath: string; now?: () => Date },
): string {
  appendAuthoringDefect(projectRoot, {
    skill: input.skill,
    gate: input.gate,
    evidence_path: input.evidencePath,
    at: (input.now ?? (() => new Date()))().toISOString(),
  });
  return gateFailureReceiptLine(input.skill, input.gate, input.evidencePath);
}
