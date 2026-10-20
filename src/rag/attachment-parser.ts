import { readFile } from 'node:fs/promises';

export const PDF_PAGE_CAP = 2000;

export const ZIP_DECOMPRESSED_LIMIT_BYTES = 500 * 1024 * 1024;

const BINARY_SNIFF_BYTES = 512;

export type AttachmentRejectionOutcome = 'index_failed' | 'format_rejected';

export type AttachmentRejectionReason =
  | 'parse-error'
  | 'encrypted-pdf'
  | 'mime-unrecognised'
  | 'page-cap'
  | 'zip-bomb'
  | 'unsupported-format'
  | 'empty-file';

export type AttachmentContentKind = 'text' | 'pdf';

export interface ParsedAttachment {
  ok: true;
  content: string;
  detectedKind: AttachmentContentKind;
  pageCount?: number;
}

export interface AttachmentRejection {
  ok: false;
  outcome: AttachmentRejectionOutcome;
  reason: AttachmentRejectionReason;
  message: string;
}

export type ParseAttachmentResult = ParsedAttachment | AttachmentRejection;

export interface PdfExtraction {
  text: string;
  pageCount: number;
  encrypted?: boolean;
}

export type PdfTextExtractor = (bytes: Buffer) => Promise<PdfExtraction>;

export interface ArchiveInspection {
  decompressedBytes: number;
}

export type ArchiveInspector = (bytes: Buffer) => Promise<ArchiveInspection>;

export interface ParseAttachmentOptions {
  pdfExtractor?: PdfTextExtractor;
  archiveInspector?: ArchiveInspector;
  bytes?: Buffer;
  pageCap?: number;
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
  return reject(
    'format_rejected',
    'unsupported-format',
    'Archive contents are not indexable as text',
  );
}

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
