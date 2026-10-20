import { sha256Hex } from '@/compliance/markdown.js';
import type { CycloneDxProperty } from '@/evidence/receipt/ai-bom.js';
import { computeSessionRowHash } from '@/session-ledger/ledger.js';

import { computeContentHash } from './mint.js';

export const ENVELOPE_HEADER_KEYS = [
  'schema_version',
  'doc_type',
  'change',
  'session_id',
  'recorded_at',
  'content_hash',
] as const;

export type EnvelopeHeaderKey = (typeof ENVELOPE_HEADER_KEYS)[number];

export interface EnvelopeHeader {
  schema_version: number;
  doc_type: string;
  change: string;
  session_id: string;
  recorded_at: string;
  content_hash: string;
}

export const LEGACY_DOC_TYPE_ALIASES: Readonly<Record<string, string>> = {
  'paqad.duplication-run': 'paqad.duplication',
  'paqad.rag-evidence': 'paqad.rag',
};

export function normalizeDocType(docType: string): string {
  return LEGACY_DOC_TYPE_ALIASES[docType] ?? docType;
}

export interface EnvelopeIdentity {
  docType: string;
  change: string;
  sessionId: string;
  schemaVersion: number;
  now?: () => Date;
}

const HEADER_KEY_SET: ReadonlySet<string> = new Set(ENVELOPE_HEADER_KEYS);

function assertNoHeaderKeys(body: Record<string, unknown>, what: string): void {
  const clash = Object.keys(body).filter((key) => HEADER_KEY_SET.has(key));
  if (clash.length > 0) {
    throw new Error(`${what} body carries envelope header keys: ${clash.join(', ')}`);
  }
}

function stampTime(now: (() => Date) | undefined): string {
  return (now ?? (() => new Date()))().toISOString();
}

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

export type BundleRowValidator = (row: EnvelopeHeader & Record<string, unknown>) => string[];

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

export function rowRecordedAt(row: Record<string, unknown>): string | null {
  return stringField(row.recorded_at) ?? stringField(row.ts);
}

export function docRecordedAt(doc: Record<string, unknown>): string | null {
  return (
    stringField(doc.recorded_at) ??
    stringField(doc.created_at) ??
    stringField(doc.captured_at) ??
    stringField(doc.generated_at)
  );
}

export interface ReadEnvelope {
  schema_version: number | null;
  doc_type: string | null;
  change: string | null;
  session_id: string | null;
  recorded_at: string | null;
  content_hash: string | null;
}

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

function carriesEnvelopeHeader(value: unknown): value is EnvelopeHeader & Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const doc = value as Record<string, unknown>;
  return (
    typeof doc.doc_type === 'string' &&
    typeof doc.change === 'string' &&
    typeof doc.recorded_at === 'string' &&
    typeof doc.content_hash === 'string'
  );
}

export function documentHashMatches(doc: unknown): boolean | null {
  if (!carriesEnvelopeHeader(doc)) return null;
  return computeContentHash(doc) === doc.content_hash;
}

export function rowHashMatches(row: unknown): boolean | null {
  if (!carriesEnvelopeHeader(row)) return null;
  return computeSessionRowHash(row) === row.content_hash;
}

export function buildTextHeader(input: EnvelopeIdentity & { body: string }): EnvelopeHeader {
  return buildEnvelopeHeader({ ...input, contentHash: sha256Hex(input.body) });
}

const FRONT_MATTER_FENCE = '---';

export function renderFrontMatter(header: EnvelopeHeader, body: string): string {
  const lines = ENVELOPE_HEADER_KEYS.map((key) => `${key}: ${JSON.stringify(header[key])}`);
  return `${FRONT_MATTER_FENCE}\n${lines.join('\n')}\n${FRONT_MATTER_FENCE}\n${body}`;
}

export interface SplitFrontMatter {
  header: Record<string, string | number> | null;
  body: string;
}

function parseFrontMatterValue(raw: string): string | number {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'string' || typeof parsed === 'number') {
      return parsed;
    }
  } catch {}
  return raw;
}

const FRONT_MATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/;

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

export function textHashMatches(text: string): boolean | null {
  const { header, body } = splitFrontMatter(text);
  if (header?.change === undefined || typeof header.content_hash !== 'string') return null;
  return sha256Hex(body) === header.content_hash;
}

export const REPORT_HEADER_SCRIPT_ID = 'paqad-header';

export function renderHeaderScript(header: EnvelopeHeader): string {
  const ordered = Object.fromEntries(ENVELOPE_HEADER_KEYS.map((key) => [key, header[key]]));
  const json = JSON.stringify(ordered).replace(/</g, '\\u003c');
  return `<script type="application/json" id="${REPORT_HEADER_SCRIPT_ID}">${json}</script>`;
}

const HEADER_SCRIPT_PATTERN = new RegExp(
  `<script type="application/json" id="${REPORT_HEADER_SCRIPT_ID}">([\\s\\S]*?)</script>`,
);

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

export const AI_BOM_HEADER_PREFIX = 'paqad:';

export function toAiBomProperties(header: EnvelopeHeader): CycloneDxProperty[] {
  return ENVELOPE_HEADER_KEYS.map((key) => ({
    name: `${AI_BOM_HEADER_PREFIX}${key}`,
    value: String(header[key]),
  }));
}

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

export function withReceiptHeader<B extends Record<string, unknown>>(
  header: EnvelopeHeader,
  block: B,
): EnvelopeHeader & B {
  assertNoHeaderKeys(block, header.doc_type);
  return { ...header, ...block };
}
