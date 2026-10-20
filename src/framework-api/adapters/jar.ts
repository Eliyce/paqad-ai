import { inflateRawSync } from 'node:zlib';

export interface ZipEntry {
  name: string;
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

export function readZipDirectory(buffer: Buffer): ZipEntry[] | null {
  const start = findEndRecord(buffer);
  if (start === null) {
    return null;
  }
  if (start >= 20 && buffer.readUInt32LE(start - 20) === ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR) {
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

function findEndRecord(buffer: Buffer): number | null {
  const earliest = Math.max(0, buffer.length - 0xffff - 22);
  for (let i = buffer.length - 22; i >= earliest; i -= 1) {
    if (buffer.readUInt32LE(i) === END_OF_CENTRAL_DIRECTORY) {
      return i;
    }
  }
  return null;
}

export function readZipEntry(buffer: Buffer, entry: ZipEntry): Buffer | null {
  const header = entry.localHeaderOffset;
  if (header + 30 > buffer.length || buffer.readUInt32LE(header) !== LOCAL_FILE_HEADER) {
    return null;
  }
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
