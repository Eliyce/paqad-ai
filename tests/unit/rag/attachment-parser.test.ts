import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  PDF_PAGE_CAP,
  ZIP_DECOMPRESSED_LIMIT_BYTES,
  parseAttachment,
} from '@/rag/attachment-parser.js';
import type { PdfExtraction } from '@/rag/attachment-parser.js';

const PDF_HEADER = Buffer.from('%PDF-1.7\n');
const ZIP_HEADER = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);

describe('parseAttachment', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-attach-parse-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function write(name: string, body: Buffer | string): string {
    const path = join(root, name);
    writeFileSync(path, body);
    return path;
  }

  it('passes plain UTF-8 text through as content', async () => {
    const path = write('notes.txt', 'hello attachment world');
    const result = await parseAttachment(path);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.content).toBe('hello attachment world');
    expect(result.detectedKind).toBe('text');
  });

  it('returns parse-error when the file cannot be read', async () => {
    const result = await parseAttachment(join(root, 'missing.txt'));
    expect(result).toMatchObject({ ok: false, outcome: 'index_failed', reason: 'parse-error' });
  });

  it('rejects an empty file', async () => {
    const path = write('empty.txt', '');
    const result = await parseAttachment(path);
    expect(result).toMatchObject({ ok: false, outcome: 'index_failed', reason: 'empty-file' });
  });

  it('rejects binary content carrying a NUL byte as mime-unrecognised', async () => {
    const path = write('blob.bin', Buffer.from([0x68, 0x00, 0x69]));
    const result = await parseAttachment(path);
    expect(result).toMatchObject({
      ok: false,
      outcome: 'index_failed',
      reason: 'mime-unrecognised',
    });
  });

  it('rejects non-UTF-8 bytes as mime-unrecognised', async () => {
    // 0xC3 0x28 is an invalid UTF-8 sequence, no NUL byte present.
    const path = write('latin.bin', Buffer.from([0x41, 0xc3, 0x28, 0x42]));
    const result = await parseAttachment(path);
    expect(result).toMatchObject({
      ok: false,
      outcome: 'index_failed',
      reason: 'mime-unrecognised',
    });
  });

  it('accepts supplied bytes without touching disk', async () => {
    const result = await parseAttachment('does-not-matter', { bytes: Buffer.from('inline body') });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.content).toBe('inline body');
  });

  describe('PDF handling', () => {
    it('rejects a PDF as unsupported when no extractor is configured', async () => {
      const path = write('doc.pdf', PDF_HEADER);
      const result = await parseAttachment(path);
      expect(result).toMatchObject({
        ok: false,
        outcome: 'format_rejected',
        reason: 'unsupported-format',
      });
    });

    it('extracts text and page count from a valid PDF via the injected extractor', async () => {
      const path = write('doc.pdf', PDF_HEADER);
      const extraction: PdfExtraction = { text: 'extracted pdf text', pageCount: 12 };
      const result = await parseAttachment(path, { pdfExtractor: async () => extraction });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      expect(result.content).toBe('extracted pdf text');
      expect(result.pageCount).toBe(12);
      expect(result.detectedKind).toBe('pdf');
    });

    it('rejects an encrypted PDF reported via the encrypted flag', async () => {
      const path = write('doc.pdf', PDF_HEADER);
      const result = await parseAttachment(path, {
        pdfExtractor: async () => ({ text: '', pageCount: 0, encrypted: true }),
      });
      expect(result).toMatchObject({ ok: false, outcome: 'index_failed', reason: 'encrypted-pdf' });
    });

    it('classifies a password error thrown by the extractor as encrypted-pdf', async () => {
      const path = write('doc.pdf', PDF_HEADER);
      const result = await parseAttachment(path, {
        pdfExtractor: async () => {
          throw new Error('PDF is password protected');
        },
      });
      expect(result).toMatchObject({ ok: false, outcome: 'index_failed', reason: 'encrypted-pdf' });
    });

    it('classifies any other extractor error as parse-error', async () => {
      const path = write('doc.pdf', PDF_HEADER);
      const result = await parseAttachment(path, {
        pdfExtractor: async () => {
          throw new Error('unexpected token at offset 4');
        },
      });
      expect(result).toMatchObject({ ok: false, outcome: 'index_failed', reason: 'parse-error' });
    });

    it('rejects a PDF beyond the page cap', async () => {
      const path = write('doc.pdf', PDF_HEADER);
      const result = await parseAttachment(path, {
        pdfExtractor: async () => ({ text: 'x', pageCount: PDF_PAGE_CAP + 1 }),
      });
      expect(result).toMatchObject({ ok: false, outcome: 'format_rejected', reason: 'page-cap' });
    });

    it('honours a custom page cap', async () => {
      const path = write('doc.pdf', PDF_HEADER);
      const result = await parseAttachment(path, {
        pageCap: 1,
        pdfExtractor: async () => ({ text: 'x', pageCount: 2 }),
      });
      expect(result).toMatchObject({ ok: false, outcome: 'format_rejected', reason: 'page-cap' });
    });
  });

  describe('archive handling', () => {
    it('rejects an archive as unsupported when no inspector is configured', async () => {
      const path = write('bundle.zip', ZIP_HEADER);
      const result = await parseAttachment(path);
      expect(result).toMatchObject({
        ok: false,
        outcome: 'format_rejected',
        reason: 'unsupported-format',
      });
    });

    it('rejects a zip-bomb above the decompressed ceiling', async () => {
      const path = write('bomb.zip', ZIP_HEADER);
      const result = await parseAttachment(path, {
        archiveInspector: async () => ({ decompressedBytes: ZIP_DECOMPRESSED_LIMIT_BYTES + 1 }),
      });
      expect(result).toMatchObject({ ok: false, outcome: 'format_rejected', reason: 'zip-bomb' });
    });

    it('rejects a within-limit archive as unsupported (not indexable as text)', async () => {
      const path = write('ok.zip', ZIP_HEADER);
      const result = await parseAttachment(path, {
        archiveInspector: async () => ({ decompressedBytes: 1024 }),
      });
      expect(result).toMatchObject({
        ok: false,
        outcome: 'format_rejected',
        reason: 'unsupported-format',
      });
    });

    it('classifies an inspector error as parse-error', async () => {
      const path = write('bad.zip', ZIP_HEADER);
      const result = await parseAttachment(path, {
        archiveInspector: async () => {
          throw new Error('central directory missing');
        },
      });
      expect(result).toMatchObject({ ok: false, outcome: 'index_failed', reason: 'parse-error' });
    });

    it('honours a custom zip-bomb ceiling', async () => {
      const path = write('small.zip', ZIP_HEADER);
      const result = await parseAttachment(path, {
        zipDecompressedLimitBytes: 10,
        archiveInspector: async () => ({ decompressedBytes: 11 }),
      });
      expect(result).toMatchObject({ ok: false, outcome: 'format_rejected', reason: 'zip-bomb' });
    });
  });
});
