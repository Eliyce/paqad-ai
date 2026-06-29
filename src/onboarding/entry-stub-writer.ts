import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { toPosixPath } from '@/core/path-utils.js';
import { appendPlanningAudit } from '@/planning/audit.js';

// Issue #242 — when a project already ships an entry file authored by another
// tool (a `laravel new --boost` app's `CLAUDE.md`/`AGENTS.md`, say), onboarding
// must still establish the documented entry-file contract: "open
// `.paqad/framework-path.txt`, resolve it, load the bootstrap". The file-writer
// leaves a pre-existing entry file untouched (PQD-424: never clobber a
// project-owned file), so without this step the contract is never written and a
// provider whose only seam is the entry file silently never loads paqad.
//
// This wires paqad's lean stub into a marker-fenced managed block APPENDED to the
// existing file, preserving the prior content above it. It mirrors the
// gitignore-writer managed-block pattern (begin/end markers, idempotent,
// re-onboard-safe) the issue cites as precedent.

const MANAGED_BEGIN = '<!-- >>> paqad-ai managed entry stub (do not edit between markers) >>> -->';
const MANAGED_END = '<!-- <<< paqad-ai managed entry stub <<< -->';

export interface EntryStub {
  /** Project-relative path to the provider entry file (`CLAUDE.md`, `AGENTS.md`, …). */
  path: string;
  /**
   * The lean entry-stub body the adapter rendered (the bootstrap pointer + the
   * graceful-degradation fallback clause + the `Adapter:` footer). Reused verbatim
   * inside the managed block so the wired contract is byte-identical to what a
   * fresh onboard would have written.
   */
  content: string;
}

/** Files the writer wired (gained or refreshed the managed block) on this run. */
export interface EntryStubWireResult {
  wired: string[];
}

/**
 * Wire paqad's lean entry stub into pre-existing provider entry files as a
 * marker-fenced managed block (issue #242), preserving the prior content above it.
 *
 * Only acts on a file that ALREADY EXISTS but does not yet wire paqad:
 *   - a file carrying the managed markers is reconciled in place (idempotent);
 *   - a file that already carries the bootstrap pointer (a bare paqad stub a fresh
 *     onboard wrote) is left untouched — wiring it again would duplicate the
 *     contract;
 *   - any other existing file (foreign content) gets the managed block appended;
 *   - a missing file is left for the normal `generateConfig` write path, which
 *     creates the bare lean stub.
 *
 * Returns the project-relative paths that were wired, so the caller can surface
 * them instead of leaving the change silent.
 */
export function wireEntryStubs(projectRoot: string, stubs: EntryStub[]): EntryStubWireResult {
  const wired: string[] = [];

  for (const stub of stubs) {
    const target = join(projectRoot, stub.path);
    // Single read, catch ENOENT — never `existsSync(path) ? readFileSync(path)`.
    // The check-then-write pair is a TOCTOU file-system race (CWE-367,
    // CodeQL js/file-system-race).
    const existing = readTextOrEmpty(target);

    // Missing file: the bare lean stub is created by the generateConfig write
    // path. Already wired by a bare stub (the pointer is present, no markers):
    // leave it so the contract is not duplicated.
    if (existing === '' || (!existing.includes(MANAGED_BEGIN) && existing.includes(PATHS.FRAMEWORK_PATH))) {
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

/**
 * Reconcile paqad's managed entry-stub block inside an existing entry file.
 * Replaces an existing block in place (keeping content before and after it), or
 * appends the block after the preserved content when none is present. Idempotent:
 * a file whose block already matches is returned unchanged.
 */
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

/** Read a UTF-8 file, returning `''` when it does not exist (ENOENT). */
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
