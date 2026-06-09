// PQD-331 — parse a user-attached file into chunkable plain text, with the
// format guards the ticket requires (PDF page cap, zip-bomb ceiling, encrypted
// and corrupt detection, MIME sniffing).
//
// Design choice (recorded as a non-blocking decision): the engine does NOT take
// a hard dependency on a PDF or ZIP library. Shipping `pdf-parse`/`pdfjs-dist`
// and an archive expander inside a published npm package is a bundle-size and
// security-surface decision the analysis flags as open (§8 Q2/Q5) — and the
// hard rule is "additive, backward-compatible, no new third-party attack
// surface unless required". So heavy extraction is INJECTABLE: the consumer
// (desktop) supplies a `pdfExtractor` / `archiveInspector`. The engine owns the
// orchestration and every guard (page cap, zip-bomb ceiling, encrypted/corrupt
// classification, the text/code/json/yaml/markdown native path) regardless of
// which library the consumer plugs in.

import { readFile } from 'node:fs/promises';

/** Hard cap on PDF pages before the file is rejected (spec: 2,000 pages). */
export const PDF_PAGE_CAP = 2000;

/** Decompressed-size ceiling for archives before zip-bomb rejection (500 MB). */
export const ZIP_DECOMPRESSED_LIMIT_BYTES = 500 * 1024 * 1024;

/** How many leading bytes are scanned for a NUL when sniffing binary content. */
const BINARY_SNIFF_BYTES = 512;

/**
 * Whether a rejection should surface as `attachment.index_failed` (the file is
 * broken or unreadable) or `attachment.format_rejected` (the file is well-formed
 * but its shape is disallowed — too many pages, zip-bomb, unsupported format).
 */
export type AttachmentRejectionOutcome = 'index_failed' | 'format_rejected';

/** Stable, routable reason for a parse rejection. */
export type AttachmentRejectionReason =
  | 'parse-error'
  | 'encrypted-pdf'
  | 'mime-unrecognised'
  | 'page-cap'
  | 'zip-bomb'
  | 'unsupported-format'
  | 'empty-file';

/** The detected high-level kind of the attachment's content. */
export type AttachmentContentKind = 'text' | 'pdf';

/** Successful parse: plain text ready for the chunker. */
export interface ParsedAttachment {
  ok: true;
  content: string;
  detectedKind: AttachmentContentKind;
  pageCount?: number;
}

/** A parse that produced no indexable content, with a routable reason. */
export interface AttachmentRejection {
  ok: false;
  outcome: AttachmentRejectionOutcome;
  reason: AttachmentRejectionReason;
  message: string;
}

export type ParseAttachmentResult = ParsedAttachment | AttachmentRejection;

/** Text + page count a consumer-supplied PDF extractor returns. */
export interface PdfExtraction {
  text: string;
  pageCount: number;
  /** Set true when the PDF is password-protected and could not be read. */
  encrypted?: boolean;
}

/** Consumer-supplied PDF text extractor. Throws or sets `encrypted` on failure. */
export type PdfTextExtractor = (bytes: Buffer) => Promise<PdfExtraction>;

/** What a consumer-supplied archive inspector reports for zip-bomb defence. */
export interface ArchiveInspection {
  /** Total bytes the archive expands to (measured during a guarded expansion). */
  decompressedBytes: number;
}

/** Consumer-supplied archive inspector. Used only to enforce the zip-bomb cap. */
export type ArchiveInspector = (bytes: Buffer) => Promise<ArchiveInspection>;

export interface ParseAttachmentOptions {
  /** Injected PDF extractor; PDFs are rejected as unsupported when absent. */
  pdfExtractor?: PdfTextExtractor;
  /** Injected archive inspector; archives are rejected as unsupported when absent. */
  archiveInspector?: ArchiveInspector;
  /** Supply the file bytes directly, skipping the disk read. */
  bytes?: Buffer;
  /** Override the PDF page cap (defaults to {@link PDF_PAGE_CAP}). */
  pageCap?: number;
  /** Override the zip-bomb ceiling (defaults to {@link ZIP_DECOMPRESSED_LIMIT_BYTES}). */
  zipDecompressedLimitBytes?: number;
}

const PDF_MAGIC = Buffer.from('%PDF');
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

function reject(
  outcome: AttachmentRejectionOutcome,
  reason: AttachmentRejectionReason,
  message: string,
): AttachmentRejection {
  return { ok: false, outcome, reason, message };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A PDF extractor failure that signals a password/encryption problem. */
function looksEncrypted(error: unknown): boolean {
  return /encrypt|password|protected/i.test(errorMessage(error));
}

function sniffKind(bytes: Buffer): AttachmentContentKind | 'zip' {
  if (bytes.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)) {
    return 'pdf';
  }
  if (bytes.subarray(0, ZIP_MAGIC.length).equals(ZIP_MAGIC)) {
    return 'zip';
  }
  return 'text';
}

function hasNullByte(bytes: Buffer): boolean {
  return bytes.subarray(0, BINARY_SNIFF_BYTES).includes(0x00);
}

/**
 * Round-trip the bytes through UTF-8: if re-encoding the decoded string does not
 * reproduce the original bytes, the input was not valid UTF-8 text (it carried
 * undecodable sequences that `toString` replaced with U+FFFD).
 */
function isValidUtf8(bytes: Buffer): boolean {
  return Buffer.from(bytes.toString('utf8'), 'utf8').equals(bytes);
}

async function parsePdf(
  bytes: Buffer,
  options: ParseAttachmentOptions,
): Promise<ParseAttachmentResult> {
  if (!options.pdfExtractor) {
    return reject(
      'format_rejected',
      'unsupported-format',
      'PDF attachments require a consumer-supplied pdfExtractor',
    );
  }
  let extraction: PdfExtraction;
  try {
    extraction = await options.pdfExtractor(bytes);
  } catch (error) {
    if (looksEncrypted(error)) {
      return reject('index_failed', 'encrypted-pdf', `Encrypted PDF: ${errorMessage(error)}`);
    }
    return reject('index_failed', 'parse-error', `Could not parse PDF: ${errorMessage(error)}`);
  }
  if (extraction.encrypted) {
    return reject('index_failed', 'encrypted-pdf', 'Encrypted PDF could not be read');
  }
  const cap = options.pageCap ?? PDF_PAGE_CAP;
  if (extraction.pageCount > cap) {
    return reject(
      'format_rejected',
      'page-cap',
      `PDF has ${extraction.pageCount} pages; the cap is ${cap}`,
    );
  }
  return {
    ok: true,
    content: extraction.text,
    detectedKind: 'pdf',
    pageCount: extraction.pageCount,
  };
}

async function parseArchive(
  bytes: Buffer,
  options: ParseAttachmentOptions,
): Promise<ParseAttachmentResult> {
  const limit = options.zipDecompressedLimitBytes ?? ZIP_DECOMPRESSED_LIMIT_BYTES;
  if (!options.archiveInspector) {
    return reject(
      'format_rejected',
      'unsupported-format',
      'Archive attachments require a consumer-supplied archiveInspector',
    );
  }
  let inspection: ArchiveInspection;
  try {
    inspection = await options.archiveInspector(bytes);
  } catch (error) {
    return reject(
      'index_failed',
      'parse-error',
      `Could not inspect archive: ${errorMessage(error)}`,
    );
  }
  if (inspection.decompressedBytes > limit) {
    return reject(
      'format_rejected',
      'zip-bomb',
      `Archive decompresses to ${inspection.decompressedBytes} bytes; the limit is ${limit}`,
    );
  }
  // Even a within-limit archive is not indexable as plain text by the engine.
  return reject(
    'format_rejected',
    'unsupported-format',
    'Archive contents are not indexable as text',
  );
}

/**
 * Parse `filePath` into plain text for the chunker, applying every format guard.
 * Returns a {@link ParsedAttachment} on success, or a {@link AttachmentRejection}
 * carrying a stable `outcome`/`reason` the indexer maps to an attachment event.
 * Never throws for a bad file — read/parse failures become typed rejections.
 */
export async function parseAttachment(
  filePath: string,
  options: ParseAttachmentOptions = {},
): Promise<ParseAttachmentResult> {
  let bytes: Buffer;
  try {
    bytes = options.bytes ?? (await readFile(filePath));
  } catch (error) {
    return reject(
      'index_failed',
      'parse-error',
      `Could not read attachment: ${errorMessage(error)}`,
    );
  }
  if (bytes.length === 0) {
    return reject('index_failed', 'empty-file', 'Attachment is empty');
  }

  const kind = sniffKind(bytes);
  if (kind === 'pdf') {
    return parsePdf(bytes, options);
  }
  if (kind === 'zip') {
    return parseArchive(bytes, options);
  }

  if (hasNullByte(bytes) || !isValidUtf8(bytes)) {
    return reject(
      'index_failed',
      'mime-unrecognised',
      'Attachment is not valid UTF-8 text and no extractor handles its format',
    );
  }
  return { ok: true, content: bytes.toString('utf8'), detectedKind: 'text' };
}
