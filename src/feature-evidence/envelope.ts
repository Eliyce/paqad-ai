// The one bundle envelope (issue #581, FR-5).
//
// Every file in a feature bundle carries the same six-field header, in this order:
// `schema_version`, `doc_type`, `change`, `session_id`, `recorded_at`, `content_hash`.
// Before this each writer stamped its own subset (`ulid` here, `ts` there, `created_at`,
// `captured_at`, `generated_at` elsewhere), so no reader could ask one question of every
// file. This module is the only place the header is built; writers hand it a body and get
// the stamped document or row back, so no writer builds a header by hand (INV-3).
//
// Reuse over reinvention: a JSON document is hashed with the existing
// {@link computeContentHash}, a JSONL row with the existing {@link computeSessionRowHash},
// and a text body (Markdown, HTML) with the existing {@link sha256Hex}. `recorded_at` is in
// both hash-exclusion sets, so an identity hash stays time-free exactly as `created_at` / `ts`
// kept it before.
//
// Readers are tolerant (INV-8): {@link readEnvelope}, {@link rowRecordedAt} and
// {@link docRecordedAt} accept the old keys too, so a bundle written before #581 still reads.
//
// Standard formats keep their own shape and carry the header where that format allows it:
// CycloneDX `metadata.properties` (`paqad:<field>`), the receipt's top-level `paqad` block,
// YAML front matter for `.md`, and a `<script id="paqad-header">` tag for `report.html`.

import { sha256Hex } from '@/compliance/markdown.js';
import type { CycloneDxProperty } from '@/evidence/receipt/ai-bom.js';
import { computeSessionRowHash } from '@/session-ledger/ledger.js';

import { computeContentHash } from './mint.js';

/** The six header fields, in the fixed order every bundle file carries them. */
export const ENVELOPE_HEADER_KEYS = [
  'schema_version',
  'doc_type',
  'change',
  'session_id',
  'recorded_at',
  'content_hash',
] as const;

export type EnvelopeHeaderKey = (typeof ENVELOPE_HEADER_KEYS)[number];

/** The six-field header on every bundle document and row. */
export interface EnvelopeHeader {
  schema_version: number;
  doc_type: string;
  /** The change key: the ULID at the end of the bundle's folder name (INV-4). */
  change: string;
  /** The session that wrote this document or row. */
  session_id: string;
  /** ISO-8601 UTC, stamped by the writer script (never the model). */
  recorded_at: string;
  /** Lowercase hex SHA-256 over the file's identity (volatile time fields excluded). */
  content_hash: string;
}

/**
 * Doc types renamed by #581 so `doc_type` equals `paqad.<file-stem>`. A reader maps the old
 * name to the new one through {@link normalizeDocType}, so a pre-#581 row still matches.
 */
export const LEGACY_DOC_TYPE_ALIASES: Readonly<Record<string, string>> = {
  'paqad.duplication-run': 'paqad.duplication',
  'paqad.rag-evidence': 'paqad.rag',
};

/** The current doc type for a possibly legacy one; unknown names pass through unchanged. */
export function normalizeDocType(docType: string): string {
  return LEGACY_DOC_TYPE_ALIASES[docType] ?? docType;
}

/** The header inputs every builder shares. */
export interface EnvelopeIdentity {
  docType: string;
  change: string;
  sessionId: string;
  schemaVersion: number;
  /** Clock seam for tests. */
  now?: () => Date;
}

const HEADER_KEY_SET: ReadonlySet<string> = new Set(ENVELOPE_HEADER_KEYS);

/** A body must not carry its own header keys: the envelope owns them. A clash is a script bug. */
function assertNoHeaderKeys(body: Record<string, unknown>, what: string): void {
  const clash = Object.keys(body).filter((key) => HEADER_KEY_SET.has(key));
  if (clash.length > 0) {
    throw new Error(`${what} body carries envelope header keys: ${clash.join(', ')}`);
  }
}

function stampTime(now: (() => Date) | undefined): string {
  return (now ?? (() => new Date()))().toISOString();
}

/**
 * Build the header from an already-computed content hash. The primitive the standard-format
 * helpers below share: each of those formats decides what its hash covers, then carries the
 * same six fields in its own slot.
 */
export function buildEnvelopeHeader(
  identity: EnvelopeIdentity & { contentHash: string },
): EnvelopeHeader {
  return {
    schema_version: identity.schemaVersion,
    doc_type: identity.docType,
    change: identity.change,
    session_id: identity.sessionId,
    recorded_at: stampTime(identity.now),
    content_hash: identity.contentHash,
  };
}

/**
 * Build a JSON bundle document: the six header fields first, in fixed order, then the body.
 * `content_hash` is {@link computeContentHash} over the header identity plus the body, so a
 * hand edit to any identifying byte is detectable and a re-write at a new time is not a change.
 */
export function buildDocumentEnvelope<B extends Record<string, unknown>>(
  input: EnvelopeIdentity & { body: B },
): EnvelopeHeader & B {
  assertNoHeaderKeys(input.body, input.docType);
  const identity: Record<string, unknown> = {
    schema_version: input.schemaVersion,
    doc_type: input.docType,
    change: input.change,
    session_id: input.sessionId,
    ...input.body,
  };
  const header = buildEnvelopeHeader({ ...input, contentHash: computeContentHash(identity) });
  return { ...header, ...input.body };
}

/** Returns `[]` when the row is valid, or a list of human-readable errors. */
export type BundleRowValidator = (row: EnvelopeHeader & Record<string, unknown>) => string[];

/**
 * Stamp one JSONL bundle row: the six header fields first, then the row's own fields.
 * `content_hash` is {@link computeSessionRowHash} over everything but the volatile keys, the
 * same identity rule the session ledger uses. Throws when the validator rejects the row (a
 * script bug, never silently swallowed).
 */
export function stampBundleRow(
  input: EnvelopeIdentity & { row: Record<string, unknown>; validate?: BundleRowValidator },
): EnvelopeHeader & Record<string, unknown> {
  assertNoHeaderKeys(input.row, input.docType);
  const identity: Record<string, unknown> = {
    schema_version: input.schemaVersion,
    doc_type: input.docType,
    change: input.change,
    session_id: input.sessionId,
    ...input.row,
  };
  const header = buildEnvelopeHeader({ ...input, contentHash: computeSessionRowHash(identity) });
  const stamped = { ...header, ...input.row };
  const errors = input.validate?.(stamped) ?? [];
  if (errors.length > 0) {
    throw new Error(`Invalid ${input.docType} row: ${errors.join('; ')}`);
  }
  return stamped;
}

function stringField(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** When a bundle row was written: `recorded_at`, else the pre-#581 `ts`, else null. */
export function rowRecordedAt(row: Record<string, unknown>): string | null {
  return stringField(row.recorded_at) ?? stringField(row.ts);
}

/**
 * When a bundle document was written: `recorded_at`, else the pre-#581 `created_at`,
 * `captured_at` or `generated_at` (whichever the old writer used), else null.
 */
export function docRecordedAt(doc: Record<string, unknown>): string | null {
  return (
    stringField(doc.recorded_at) ??
    stringField(doc.created_at) ??
    stringField(doc.captured_at) ??
    stringField(doc.generated_at)
  );
}

/** A header read tolerantly: any field an old file never carried is null. */
export interface ReadEnvelope {
  schema_version: number | null;
  /** Normalised through {@link LEGACY_DOC_TYPE_ALIASES}. */
  doc_type: string | null;
  /** `change`, else the pre-#581 `ulid` field. */
  change: string | null;
  /** `session_id`, else the pre-#581 `session_first_seen` field of `feature.json`. */
  session_id: string | null;
  recorded_at: string | null;
  content_hash: string | null;
}

/**
 * Read the header of any bundle document or row, old or new (INV-8). Returns null only for a
 * value that is not an object; a missing field reads null rather than failing the read.
 */
export function readEnvelope(value: unknown): ReadEnvelope | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const doc = value as Record<string, unknown>;
  const docType = stringField(doc.doc_type);
  return {
    schema_version: typeof doc.schema_version === 'number' ? doc.schema_version : null,
    doc_type: docType === null ? null : normalizeDocType(docType),
    change: stringField(doc.change) ?? stringField(doc.ulid),
    session_id: stringField(doc.session_id) ?? stringField(doc.session_first_seen),
    recorded_at: rowRecordedAt(doc) ?? docRecordedAt(doc),
    content_hash: stringField(doc.content_hash),
  };
}

// ── Text documents: YAML front matter (.md) and the report.html header tag ──────────────

/**
 * The header for a text document (`request.md`, `spec.md`, `report.html`). `content_hash` is
 * {@link sha256Hex} over the body only, the bytes after the front matter, so for `spec.md` it
 * equals the frozen `spec_hash` of the same source.
 */
export function buildTextHeader(input: EnvelopeIdentity & { body: string }): EnvelopeHeader {
  return buildEnvelopeHeader({ ...input, contentHash: sha256Hex(input.body) });
}

const FRONT_MATTER_FENCE = '---';

/**
 * Render a Markdown document with the header as YAML front matter. Every value is written as
 * a JSON scalar, which is also valid YAML (a double-quoted string or a plain number), so the
 * reader below parses it back without a YAML dependency.
 */
export function renderFrontMatter(header: EnvelopeHeader, body: string): string {
  const lines = ENVELOPE_HEADER_KEYS.map((key) => `${key}: ${JSON.stringify(header[key])}`);
  return `${FRONT_MATTER_FENCE}\n${lines.join('\n')}\n${FRONT_MATTER_FENCE}\n${body}`;
}

export interface SplitFrontMatter {
  /** The parsed front-matter fields, or null when the text has no front matter. */
  header: Record<string, string | number> | null;
  /** Everything after the closing fence (the whole text when there is no front matter). */
  body: string;
}

function parseFrontMatterValue(raw: string): string | number {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'string' || typeof parsed === 'number') {
      return parsed;
    }
  } catch {
    // Not a JSON scalar: a hand-written plain YAML value. Kept as its trimmed text below.
  }
  return raw;
}

/** The front matter block: an opening fence line, the header lines, a closing fence line. */
const FRONT_MATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/;

/**
 * Split a Markdown document into its front matter and body. Text with no opening fence, or
 * an opening fence that never closes, is all body, so a pre-#581 file reads unchanged. The
 * body is returned byte-for-byte (line endings included), because for `spec.md` it is the
 * signed source whose sha256 must equal `spec_hash`.
 */
export function splitFrontMatter(text: string): SplitFrontMatter {
  const match = FRONT_MATTER_PATTERN.exec(text);
  if (!match) {
    return { header: null, body: text };
  }
  const header: Record<string, string | number> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    header[line.slice(0, colon).trim()] = parseFrontMatterValue(line.slice(colon + 1).trim());
  }
  return { header, body: text.slice(match[0].length) };
}

/** The id of the JSON header tag embedded in `report.html`. */
export const REPORT_HEADER_SCRIPT_ID = 'paqad-header';

/**
 * The `<script type="application/json" id="paqad-header">` tag carrying the header in
 * `report.html`. `<` is escaped so no header value can close the tag early.
 */
export function renderHeaderScript(header: EnvelopeHeader): string {
  const ordered = Object.fromEntries(ENVELOPE_HEADER_KEYS.map((key) => [key, header[key]]));
  const json = JSON.stringify(ordered).replace(/</g, '\\u003c');
  return `<script type="application/json" id="${REPORT_HEADER_SCRIPT_ID}">${json}</script>`;
}

const HEADER_SCRIPT_PATTERN = new RegExp(
  `<script type="application/json" id="${REPORT_HEADER_SCRIPT_ID}">([\\s\\S]*?)</script>`,
);

/** Read the header tag back out of `report.html`, or null when absent or unparseable. */
export function readHeaderScript(html: string): Record<string, unknown> | null {
  const match = HEADER_SCRIPT_PATTERN.exec(html);
  if (!match) return null;
  try {
    const parsed: unknown = JSON.parse(match[1]!);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

// ── Standard formats: CycloneDX AI-BOM and the DSSE receipt ────────────────────────────

/** The CycloneDX property-name prefix the header fields carry in `ai-bom.json`. */
export const AI_BOM_HEADER_PREFIX = 'paqad:';

/** The header as CycloneDX `metadata.properties` entries, `paqad:<field>`, in fixed order. */
export function toAiBomProperties(header: EnvelopeHeader): CycloneDxProperty[] {
  return ENVELOPE_HEADER_KEYS.map((key) => ({
    name: `${AI_BOM_HEADER_PREFIX}${key}`,
    value: String(header[key]),
  }));
}

/**
 * Read the header back out of CycloneDX `metadata.properties`, or null when no `paqad:`
 * header field is present (a pre-#581 AI-BOM). `schema_version` is returned as a number.
 */
export function fromAiBomProperties(
  properties: readonly CycloneDxProperty[] | undefined,
): Partial<EnvelopeHeader> | null {
  const header: Record<string, string | number> = {};
  for (const property of properties ?? []) {
    if (!property.name.startsWith(AI_BOM_HEADER_PREFIX)) continue;
    const key = property.name.slice(AI_BOM_HEADER_PREFIX.length);
    if (!HEADER_KEY_SET.has(key)) continue;
    header[key] = key === 'schema_version' ? Number(property.value) : property.value;
  }
  return Object.keys(header).length > 0 ? (header as Partial<EnvelopeHeader>) : null;
}

/**
 * The receipt's top-level `paqad` block with the header fields first, then the block's own
 * chain fields (`signing_mode`, `prev_receipt_hash`, `receipt_hash`). The block sits outside
 * the signed DSSE payload, so adding the header never changes the bytes the chain covers.
 */
export function withReceiptHeader<B extends Record<string, unknown>>(
  header: EnvelopeHeader,
  block: B,
): EnvelopeHeader & B {
  assertNoHeaderKeys(block, header.doc_type);
  return { ...header, ...block };
}
