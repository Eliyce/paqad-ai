// Pure-mjs RAG-evidence recorder for the prompt seam (issue #249 P2).
//
// The UserPromptSubmit seam runs from the global hook install, which has no compiled
// `dist`, so it cannot import the TS recorder. This is a small, self-contained writer
// that produces rows in EXACTLY the format the TS reader (`src/rag-ledger/fold.ts`) reads
// and the AJV schema (`src/rag-ledger/schema.ts`) validates: same envelope, same identity
// hash (excludes ts/content_hash/note). A cross-format test keeps the two in lock-step.
//
// Issue #468 Phase C — the retrieval rows now live in the per-feature bundle: each row is
// written to the two-home `rag.jsonl` (the active feature's bundle when the session marks
// one, else the session's `_chat` home), mirroring the TS `resolveRagHome`/`mirrorRagRow`.
// The conversation ordinal `.open` pointer + allocation are re-homed to `_chat/<session>/`
// (the retired `paqad.rag-evidence/<session>/` substrate is gone). The reader folds the two
// homes, so the fold sees a seam-written row wherever the feature was active at write time.
//
// Best-effort and silent — recording must never break a prompt turn.

import { createHash, randomBytes } from 'node:crypto';
import {
  appendFileSync,
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

const DOC_TYPE = 'paqad.rag-evidence';
const SCHEMA_VERSION = 1;
const HASH_EXCLUDED = new Set(['ts', 'content_hash', 'note']);

/**
 * The `_chat` home for a session — where the conversation-ordinal `.open` pointer and the
 * exclusive-create allocation markers live (issue #468 Phase C). This mirrors the TS
 * `chatDir` (`.paqad/ledger/_chat/<session>`), which the canonical session-ledger allocator
 * also resolves to via docType `_chat`, so the mjs seam and the TS recorder share one home.
 */
function chatDir(projectRoot, sessionId) {
  return join(projectRoot, '.paqad', 'ledger', '_chat', sessionId);
}

/**
 * The project-relative two-home `rag.jsonl` a row belongs to: the ACTIVE feature's bundle
 * when `_session/<session>.json`.active names one, else the session's `_chat` home. A pure
 * mirror of the TS `resolveRagHome` (src/feature-evidence/bundle-ledgers.ts) — the extended
 * cross-format test pins the two to the same on-disk result. Best-effort: any read/parse
 * failure falls back to the `_chat` home so a row is never lost.
 */
function resolveRagHome(projectRoot, sessionId) {
  try {
    const control = join(
      projectRoot,
      '.paqad',
      'ledger',
      'feature-evidence',
      '_session',
      `${sessionId}.json`,
    );
    const parsed = JSON.parse(readFileSync(control, 'utf8'));
    const active = typeof parsed?.active === 'string' ? parsed.active.trim() : '';
    if (active) {
      return join(projectRoot, '.paqad', 'ledger', 'feature-evidence', active, 'rag.jsonl');
    }
  } catch {
    // No control file / not JSON / no active feature — fall through to the chat home.
  }
  return join(chatDir(projectRoot, sessionId), 'rag.jsonl');
}

/** Resolve the session id: host hint, else the cached/minted local id (worker-aligned). */
export function resolveSeamSessionId(projectRoot, hint) {
  const cleaned = typeof hint === 'string' ? hint.trim() : '';
  const cachePath = join(projectRoot, '.paqad', 'session', 'ledger-session-id');
  if (cleaned) {
    // Persist the host id so the background worker (which reads this cache) aligns.
    try {
      mkdirSync(join(projectRoot, '.paqad', 'session'), { recursive: true });
      writeFileSync(cachePath, cleaned, 'utf8');
    } catch {
      /* best-effort */
    }
    return cleaned;
  }
  try {
    const existing = readFileSync(cachePath, 'utf8').trim();
    if (existing) return existing;
  } catch {
    /* mint below */
  }
  // crypto random (not Math.random) — id minting is treated as a security context.
  const minted = `ses_${Date.now().toString(36)}${randomBytes(6).toString('hex')}`;
  try {
    mkdirSync(join(projectRoot, '.paqad', 'session'), { recursive: true });
    writeFileSync(cachePath, minted, 'utf8');
  } catch {
    /* best-effort */
  }
  return minted;
}

function highestOrdinal(dir) {
  let max = 0;
  try {
    for (const entry of readdirSync(dir)) {
      const match = /^(\d+)\.jsonl$/.exec(entry);
      if (match) max = Math.max(max, Number(match[1]));
    }
  } catch {
    /* no dir yet */
  }
  return max;
}

/**
 * Allocate a fresh conversation ordinal in the session's `_chat` home (exclusive-create,
 * race-safe with the background worker + TS recorder), update the `.open` pointer, and
 * return the ordinal (issue #468 Phase C). The `<ordinal>.jsonl` file is the atomic
 * allocation marker; the rows themselves land in the two-home `rag.jsonl` (see `appendRow`).
 */
function allocateOrdinal(projectRoot, sessionId) {
  const dir = chatDir(projectRoot, sessionId);
  mkdirSync(dir, { recursive: true });
  let ordinal = highestOrdinal(dir) + 1;
  for (;;) {
    try {
      closeSync(openSync(join(dir, `${ordinal}.jsonl`), 'wx'));
      writeFileSync(join(dir, '.open'), String(ordinal), 'utf8');
      return ordinal;
    } catch (error) {
      if (error && error.code === 'EEXIST') {
        ordinal++;
        continue;
      }
      throw error;
    }
  }
}

function contentHash(row) {
  const identity = {};
  for (const key of Object.keys(row).sort()) {
    if (!HASH_EXCLUDED.has(key)) identity[key] = row[key];
  }
  return createHash('sha256').update(JSON.stringify(identity)).digest('hex');
}

/** Stamp the envelope and append the row to `home` (a project-absolute `rag.jsonl`). */
function appendRow(home, sessionId, row) {
  const base = {
    schema_version: SCHEMA_VERSION,
    doc_type: DOC_TYPE,
    session_id: sessionId,
    ...row,
  };
  const stamped = { ...base, ts: new Date().toISOString(), content_hash: contentHash(base) };
  mkdirSync(join(home, '..'), { recursive: true });
  appendFileSync(home, `${JSON.stringify(stamped)}\n`, 'utf8');
  return stamped;
}

/**
 * Open a new conversation (per prompt) and record the `used`/`fallback` outcome on it.
 * The ordinal is allocated in `_chat`; both the `open` and outcome rows are written to the
 * two-home `rag.jsonl` resolved once at record time (issue #468 Phase C). Returns the
 * stamped used/fallback row, or null on any failure (best-effort).
 */
export function recordSeamOutcome(
  projectRoot,
  { sessionId, ragEnabled, adapter, kind, fields = {} },
) {
  try {
    const ordinal = allocateOrdinal(projectRoot, sessionId);
    const home = resolveRagHome(projectRoot, sessionId);
    appendRow(home, sessionId, {
      kind: 'open',
      conversation_ordinal: ordinal,
      rag_enabled: Boolean(ragEnabled),
      adapter,
    });
    return appendRow(home, sessionId, {
      kind,
      conversation_ordinal: ordinal,
      rag_enabled: Boolean(ragEnabled),
      adapter,
      ...fields,
    });
  } catch {
    return null;
  }
}

/** Parse which sections a composed `[paqad-context]` block carries (best-effort). */
export function sectionsFromBlock(block) {
  const sections = [];
  if (/^##\s+.*rule manifest/im.test(block) || /^##\s+Loaded rule text/im.test(block)) {
    sections.push('rules');
  }
  if (/^##\s+Codebase memory/im.test(block)) sections.push('memory');
  if (/^##\s+Retrieved context/im.test(block)) sections.push('retrieval');
  if (/^##\s+Base drift/im.test(block)) sections.push('drift');
  return sections;
}
