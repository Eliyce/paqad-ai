import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { recordRagEvidenceFromAudit } from '@/rag-ledger/audit-bridge.js';

import { redactSecrets } from './secrets.js';

function sanitize(value: unknown): string {
  return String(value).replace(/[\r\n"]/g, (match) => {
    if (match === '"') return "'";
    return ' ';
  });
}

export function appendRagAudit(
  projectRoot: string,
  level: 'INFO' | 'WARN',
  event: string,
  fields: Record<string, unknown> = {},
): void {
  const path = join(projectRoot, PATHS.AUDIT_LOG);
  mkdirSync(dirname(path), { recursive: true });
  const ts = new Date().toISOString();
  const suffix = Object.entries(fields)
    .map(([key, value]) => {
      const redacted = redactSecrets(String(value), projectRoot);
      return `${key}="${sanitize(redacted)}"`;
    })
    .join(' ');
  appendFileSync(path, `[${ts}] ${level} ${event}${suffix ? ` ${suffix}` : ''}\n`);
  // Issue #249 — also record the structured rag-evidence equivalent. Best-effort: the
  // flat line above is unconditional, so a recorder failure never loses the event.
  recordRagEvidenceFromAudit(projectRoot, event, fields);
}
