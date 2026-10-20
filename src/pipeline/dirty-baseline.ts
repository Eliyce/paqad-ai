import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { resolveSessionId } from '@/rag-ledger/session.js';
import { sessionLedgerDir } from '@/session-ledger/ledger.js';
import { STAGE_EVIDENCE_DOC_TYPE } from '@/stage-evidence/types.js';

import { readGitStatusFiles } from './change-evidence.js';

const BASELINE_FILE = '.dirty-baseline.json';

export interface DirtyBaseline {
  captured_at: string;
  files: Record<string, string>;
}

function baselinePath(projectRoot: string, sessionId: string): string {
  return join(projectRoot, sessionLedgerDir(STAGE_EVIDENCE_DOC_TYPE, sessionId), BASELINE_FILE);
}

export function digestFile(projectRoot: string, relativePath: string): string | null {
  try {
    return createHash('sha256')
      .update(readFileSync(join(projectRoot, relativePath)))
      .digest('hex');
  } catch {
    return null;
  }
}

export async function captureSessionDirtyBaseline(
  projectRoot: string,
  sessionHint: string | null,
): Promise<void> {
  const sessionId = resolveSessionId(projectRoot, sessionHint);
  const path = baselinePath(projectRoot, sessionId);
  const dirty = await readGitStatusFiles(projectRoot);
  const files: Record<string, string> = {};
  for (const relativePath of dirty) {
    const digest = digestFile(projectRoot, relativePath);
    if (digest !== null) {
      files[relativePath] = digest;
    }
  }
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      `${JSON.stringify({ captured_at: new Date().toISOString(), files }, null, 2)}\n`,
      { flag: 'wx' },
    );
  } catch {}
}

export function readSessionDirtyBaseline(
  projectRoot: string,
  sessionHint: string | null,
): DirtyBaseline | null {
  const sessionId = resolveSessionId(projectRoot, sessionHint);
  try {
    const parsed = JSON.parse(
      readFileSync(baselinePath(projectRoot, sessionId), 'utf8'),
    ) as unknown;
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      typeof (parsed as DirtyBaseline).files === 'object' &&
      (parsed as DirtyBaseline).files !== null
    ) {
      return parsed as DirtyBaseline;
    }
  } catch {}
  return null;
}

export function subtractUnchangedBaselineFiles(
  projectRoot: string,
  sessionHint: string | null,
  files: readonly string[],
): string[] {
  const baseline = readSessionDirtyBaseline(projectRoot, sessionHint);
  if (baseline === null) {
    return [...files];
  }
  return files.filter((relativePath) => {
    const baselineDigest = baseline.files[relativePath];
    if (baselineDigest === undefined) {
      return true;
    }
    const currentDigest = digestFile(projectRoot, relativePath);
    if (currentDigest === null) {
      return true;
    }
    return currentDigest !== baselineDigest;
  });
}
