import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { toPosixPath } from '@/core/path-utils.js';
import { appendPlanningAudit } from '@/planning/audit.js';

const MANAGED_BEGIN = '<!-- >>> paqad-ai managed entry stub (do not edit between markers) >>> -->';
const MANAGED_END = '<!-- <<< paqad-ai managed entry stub <<< -->';

export interface EntryStub {
  path: string;
  content: string;
}

export interface EntryStubWireResult {
  wired: string[];
}

export function wireEntryStubs(projectRoot: string, stubs: EntryStub[]): EntryStubWireResult {
  const wired: string[] = [];

  for (const stub of stubs) {
    const target = join(projectRoot, stub.path);
    const existing = readTextOrEmpty(target);

    if (
      existing === '' ||
      (!existing.includes(MANAGED_BEGIN) && existing.includes(PATHS.FRAMEWORK_PATH))
    ) {
      continue;
    }

    const next = reconcileManagedBlock(existing, stub.content);
    if (next !== existing) {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, next);
    }
    wired.push(toPosixPath(stub.path));
  }

  if (wired.length > 0) {
    appendPlanningAudit(projectRoot, 'INFO', 'onboarding.entry-stub-wired', {
      paths: wired.join(','),
      count: wired.length,
    });
  }

  return { wired };
}

function reconcileManagedBlock(existing: string, stubBody: string): string {
  const block = `${MANAGED_BEGIN}\n${stubBody.replace(/\n+$/, '')}\n${MANAGED_END}`;
  const beginIdx = existing.indexOf(MANAGED_BEGIN);
  const endIdx = existing.indexOf(MANAGED_END);

  if (beginIdx !== -1 && endIdx > beginIdx) {
    const before = existing.slice(0, beginIdx);
    const after = existing.slice(endIdx + MANAGED_END.length);
    return ensureTrailingNewline(`${before}${block}${after}`);
  }

  const trimmed = existing.replace(/\s+$/, '');
  const prefix = trimmed.length > 0 ? `${trimmed}\n\n` : '';
  return `${prefix}${block}\n`;
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith('\n') ? value : `${value}\n`;
}

function readTextOrEmpty(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return '';
    }
    throw error;
  }
}
