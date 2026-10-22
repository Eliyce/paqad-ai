import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { ulid } from '@/core/ids/ulid.js';
import { readSessionControl } from '@/feature-evidence/session-control.js';

export function persistLedgerSessionId(projectRoot: string, sessionId?: string | null): boolean {
  const cleaned = sessionId?.trim();
  if (!cleaned) return false;
  try {
    const path = join(projectRoot, PATHS.LEDGER_SESSION_ID);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, cleaned, 'utf8');
    return true;
    /* v8 ignore start -- best-effort cache write; a fs failure is not reproduced in tests */
  } catch {
    return false;
  }
}
/* v8 ignore stop */

export function resolveSessionId(projectRoot: string, hint?: string | null): string {
  const path = join(projectRoot, PATHS.LEDGER_SESSION_ID);
  const cleaned = hint?.trim();
  if (cleaned) {
    try {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, cleaned, 'utf8');
      /* v8 ignore start -- best-effort cache write; a fs failure is not reproduced in tests */
    } catch {}
    return cleaned;
  }
  /* v8 ignore stop */
  try {
    const existing = readFileSync(path, 'utf8').trim();
    if (existing) {
      return existing;
    }
  } catch {}
  const minted = `ses_${ulid().toLowerCase()}`;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, minted, 'utf8');
    /* v8 ignore start -- best-effort cache write; a fs failure is not reproduced in tests */
  } catch {}
  return minted;
}
/* v8 ignore stop */

export function readLedgerSessionId(projectRoot: string): string | null {
  try {
    const existing = readFileSync(join(projectRoot, PATHS.LEDGER_SESSION_ID), 'utf8').trim();
    return existing === '' ? null : existing;
  } catch {
    return null;
  }
}

export interface HookSessionPayload {
  session_id?: unknown;
}

function cleanSessionId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim();
  return cleaned === '' ? null : cleaned;
}

export function hookSessionCandidates(
  projectRoot: string,
  payload: HookSessionPayload | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const ordered = [
    cleanSessionId(payload?.session_id),
    cleanSessionId(env.SE_SESSION),
    cleanSessionId(env.CLAUDE_SESSION_ID),
    readLedgerSessionId(projectRoot),
  ];
  return [...new Set(ordered.filter((id): id is string => id !== null))];
}

export function resolveHookSession(
  projectRoot: string,
  payload: HookSessionPayload | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const candidates = hookSessionCandidates(projectRoot, payload, env);
  const inFlight = candidates.find((id) => readSessionControl(projectRoot, id).active !== null);
  if (inFlight !== undefined) return inFlight;
  return readLedgerSessionId(projectRoot) ?? resolveSessionId(projectRoot, null);
}

function readCacheBytes(path: string): Buffer | null {
  try {
    return readFileSync(path);
  } catch {
    return null;
  }
}

export function keepingLedgerSessionCache<T>(projectRoot: string, run: () => T): T {
  const path = join(projectRoot, PATHS.LEDGER_SESSION_ID);
  const before = readCacheBytes(path);
  try {
    return run();
  } finally {
    const after = readCacheBytes(path);
    if (before === null && after !== null) {
      rmSync(path, { force: true });
    } else if (before !== null && (after === null || !after.equals(before))) {
      writeFileSync(path, before);
    }
  }
}
