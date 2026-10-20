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
const BUNDLE_DOC_TYPE = 'paqad.rag';
const BUNDLE_SCHEMA_VERSION = 2;
const HASH_EXCLUDED = new Set(['ts', 'recorded_at', 'content_hash', 'note']);
const FOLDER_ULID = /-([0-9A-HJKMNP-TV-Z]{26})$/;

function chatDir(projectRoot, sessionId) {
  return join(projectRoot, '.paqad', 'ledger', '_chat', sessionId);
}

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
      return {
        path: join(projectRoot, '.paqad', 'ledger', 'feature-evidence', active, 'rag.jsonl'),
        change: FOLDER_ULID.exec(active)?.[1] ?? active,
      };
    }
  } catch {}
  return { path: join(chatDir(projectRoot, sessionId), 'rag.jsonl'), change: null };
}

export function resolveSeamSessionId(projectRoot, hint) {
  const cleaned = typeof hint === 'string' ? hint.trim() : '';
  const cachePath = join(projectRoot, '.paqad', 'session', 'ledger-session-id');
  if (cleaned) {
    try {
      mkdirSync(join(projectRoot, '.paqad', 'session'), { recursive: true });
      writeFileSync(cachePath, cleaned, 'utf8');
    } catch {}
    return cleaned;
  }
  try {
    const existing = readFileSync(cachePath, 'utf8').trim();
    if (existing) return existing;
  } catch {}
  const minted = `ses_${Date.now().toString(36)}${randomBytes(6).toString('hex')}`;
  try {
    mkdirSync(join(projectRoot, '.paqad', 'session'), { recursive: true });
    writeFileSync(cachePath, minted, 'utf8');
  } catch {}
  return minted;
}

function highestOrdinal(dir) {
  let max = 0;
  try {
    for (const entry of readdirSync(dir)) {
      const match = /^(\d+)\.jsonl$/.exec(entry);
      if (match) max = Math.max(max, Number(match[1]));
    }
  } catch {}
  return max;
}

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

function bundleRow(change, sessionId, row) {
  const body = { ...row };
  delete body.adapter;
  const identity = {
    schema_version: BUNDLE_SCHEMA_VERSION,
    doc_type: BUNDLE_DOC_TYPE,
    change,
    session_id: sessionId,
    ...body,
  };
  return {
    schema_version: BUNDLE_SCHEMA_VERSION,
    doc_type: BUNDLE_DOC_TYPE,
    change,
    session_id: sessionId,
    recorded_at: new Date().toISOString(),
    content_hash: contentHash(identity),
    ...body,
  };
}

function appendRow(home, sessionId, row) {
  let stamped;
  if (home.change !== null) {
    stamped = bundleRow(home.change, sessionId, row);
  } else {
    const base = {
      schema_version: SCHEMA_VERSION,
      doc_type: DOC_TYPE,
      session_id: sessionId,
      ...row,
    };
    stamped = { ...base, ts: new Date().toISOString(), content_hash: contentHash(base) };
  }
  mkdirSync(join(home.path, '..'), { recursive: true });
  appendFileSync(home.path, `${JSON.stringify(stamped)}\n`, 'utf8');
  return stamped;
}

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
