// Reading a jar (issue #398).
//
// A jar is a zip, and its interface layer is inside it: `META-INF/maven/**/pom.properties`
// holds the version Maven stamped at build time (FR-4), and each `.class` entry holds the
// `Deprecated` attribute and the `RuntimeVisibleAnnotations` entry the compiler emitted for
// `@Deprecated` (FR-7).
//
// The research note names ASM, which is a Java library needing a JVM this Node CLI cannot
// assume (`typescript` is paqad-ai's only optional peer, kept optional so an any-stack
// install pays no toolchain tax). There is no zip dependency either — so the two formats
// are read here, from `node:zlib` and the published layouts. Both readers return null on
// anything they do not fully understand, because the adapter's contract is that an
// unreadable artifact is `blocked`, never an assertion about symbols it could not see.

import { inflateRawSync } from 'node:zlib';

/** One entry of a zip's central directory. */
export interface ZipEntry {
  name: string;
  /** Offset of the local file header, from the start of the archive. */
  localHeaderOffset: number;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
}

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR = 0x07064b50;
const CENTRAL_FILE_HEADER = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;
const STORED = 0;
const DEFLATED = 8;

/**
 * The zip's central directory, or null when the archive is not one this reader understands
 * (including a zip64 archive, which no framework jar in practice is).
 *
 * The end-of-central-directory record is found by scanning backwards from the end, because
 * it is the only fixed anchor in the format and a trailing comment may follow it.
 */
export function readZipDirectory(buffer: Buffer): ZipEntry[] | null {
  const start = findEndRecord(buffer);
  if (start === null) {
    return null;
  }
  if (start >= 20 && buffer.readUInt32LE(start - 20) === ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR) {
    // zip64 puts the real sizes and offsets in a different record; rather than half-read
    // it, the caller is told this archive could not be read.
    return null;
  }
  const count = buffer.readUInt16LE(start + 10);
  let offset = buffer.readUInt32LE(start + 16);
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== CENTRAL_FILE_HEADER) {
      return null;
    }
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    entries.push({
      name: buffer.toString('utf8', offset + 46, offset + 46 + nameLength),
      compressionMethod: buffer.readUInt16LE(offset + 10),
      compressedSize: buffer.readUInt32LE(offset + 20),
      uncompressedSize: buffer.readUInt32LE(offset + 24),
      localHeaderOffset: buffer.readUInt32LE(offset + 42),
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** The end-of-central-directory record's offset, scanning back over any trailing comment. */
function findEndRecord(buffer: Buffer): number | null {
  const earliest = Math.max(0, buffer.length - 0xffff - 22);
  for (let i = buffer.length - 22; i >= earliest; i -= 1) {
    if (buffer.readUInt32LE(i) === END_OF_CENTRAL_DIRECTORY) {
      return i;
    }
  }
  return null;
}

/**
 * One entry's bytes, or null when the entry is stored with a method this reader does not
 * implement (only `stored` and `deflate` are, which covers every jar a build tool writes).
 */
export function readZipEntry(buffer: Buffer, entry: ZipEntry): Buffer | null {
  const header = entry.localHeaderOffset;
  if (header + 30 > buffer.length || buffer.readUInt32LE(header) !== LOCAL_FILE_HEADER) {
    return null;
  }
  // The local header repeats the name and extra-field lengths, and they may differ from the
  // central directory's, so the data offset is computed from the LOCAL header.
  const nameLength = buffer.readUInt16LE(header + 26);
  const extraLength = buffer.readUInt16LE(header + 28);
  const dataStart = header + 30 + nameLength + extraLength;
  const data = buffer.subarray(dataStart, dataStart + entry.compressedSize);
  if (entry.compressionMethod === STORED) {
    return Buffer.from(data);
  }
  if (entry.compressionMethod !== DEFLATED) {
    return null;
  }
  try {
    return inflateRawSync(data);
  } catch {
    return null;
  }
}
