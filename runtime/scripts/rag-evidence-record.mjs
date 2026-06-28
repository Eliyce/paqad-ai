// Pure-mjs RAG-evidence recorder for the prompt seam (issue #249 P2).
//
// The UserPromptSubmit seam runs from the global hook install, which has no compiled
// `dist`, so it cannot import the TS recorder. This is a small, self-contained writer
// that produces rows in EXACTLY the format the TS substrate (`src/session-ledger`) reads
// and the AJV schema (`src/rag-ledger/schema.ts`) validates: same path layout, same
// envelope, same identity hash (excludes ts/content_hash/note). A cross-format test keeps
// the two in lock-step.
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

function sessionDir(projectRoot, sessionId) {
  return join(projectRoot, '.paqad', 'ledger', DOC_TYPE, sessionId);
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

/** Allocate a fresh ordinal (exclusive-create), update the `.open` pointer. */
function allocateOrdinal(projectRoot, sessionId) {
  const dir = sessionDir(projectRoot, sessionId);
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

function appendRow(projectRoot, sessionId, ordinal, row) {
  const base = {
    schema_version: SCHEMA_VERSION,
    doc_type: DOC_TYPE,
    session_id: sessionId,
    ...row,
  };
  const stamped = { ...base, ts: new Date().toISOString(), content_hash: contentHash(base) };
  const dir = sessionDir(projectRoot, sessionId);
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, `${ordinal}.jsonl`), `${JSON.stringify(stamped)}\n`, 'utf8');
  return stamped;
}

/**
 * Open a new conversation (per prompt) and record the `used`/`fallback` outcome on it.
 * Returns the stamped used/fallback row, or null on any failure (best-effort).
 */
export function recordSeamOutcome(
  projectRoot,
  { sessionId, ragEnabled, adapter, kind, fields = {} },
) {
  try {
    const ordinal = allocateOrdinal(projectRoot, sessionId);
    appendRow(projectRoot, sessionId, ordinal, {
      kind: 'open',
      conversation_ordinal: ordinal,
      rag_enabled: Boolean(ragEnabled),
      adapter,
    });
    return appendRow(projectRoot, sessionId, ordinal, {
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
