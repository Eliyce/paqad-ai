import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';

function sanitize(value: unknown): string {
  return String(value).replace(/[\r\n"]/g, (match) => {
    if (match === '"') return "'";
    return ' ';
  });
}

export function appendPlanningAudit(
  projectRoot: string,
  level: 'INFO' | 'WARN',
  event: string,
  fields: Record<string, unknown> = {},
): void {
  const target = join(projectRoot, PATHS.AUDIT_LOG);
  mkdirSync(dirname(target), { recursive: true });
  const suffix = Object.entries(fields)
    .map(([key, value]) => `${key}="${sanitize(value)}"`)
    .join(' ');
  appendFileSync(
    target,
    `[${new Date().toISOString()}] ${level} ${event}${suffix ? ` ${suffix}` : ''}\n`,
    'utf8',
  );
}
