import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';

function auditPath(projectRoot: string): string {
  return join(projectRoot, PATHS.AUDIT_LOG);
}

function ts(): string {
  return new Date().toISOString();
}

export function appendAuditLog(
  projectRoot: string,
  previous: string | null,
  updated: string,
): void {
  const path = auditPath(projectRoot);
  mkdirSync(dirname(path), { recursive: true });
  const line = `[${ts()}] INFO silent-update previous=${previous ?? 'unknown'} updated=${updated}\n`;
  appendFileSync(path, line);
}

export function appendAuditLogFailure(
  projectRoot: string,
  previous: string | null,
  target: string,
  error: string,
): void {
  const path = auditPath(projectRoot);
  mkdirSync(dirname(path), { recursive: true });
  const sanitized = error.replace(/"/g, "'");
  const line = `[${ts()}] WARN silent-update-failed previous=${previous ?? 'unknown'} target=${target} error="${sanitized}"\n`;
  appendFileSync(path, line);
}
