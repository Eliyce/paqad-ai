export interface ClassFileDeprecation {
  deprecated: boolean;
  since: string | null;
  for_removal: boolean;
}

export interface ClassFileMember extends ClassFileDeprecation {
  name: string;
}

export interface ParsedClassFile extends ClassFileDeprecation {
  name: string;
  members: ClassFileMember[];
}

const CLASS_FILE_MAGIC = 0xcafebabe;
const DEPRECATED_ANNOTATION = 'Ljava/lang/Deprecated;';

const FIXED_WIDTH_TAGS: Record<number, number> = {
  3: 4,
  4: 4,
  5: 8,
  6: 8,
  7: 2,
  8: 2,
  9: 4,
  10: 4,
  11: 4,
  12: 4,
  15: 3,
  16: 2,
  17: 4,
  18: 4,
  19: 2,
  20: 2,
};

type PoolEntry =
  | { kind: 'utf8'; value: string }
  | { kind: 'index'; value: number }
  | { kind: 'integer'; value: number }
  | { kind: 'other' };

interface Cursor {
  buffer: Buffer;
  at: number;
}

function u1(cursor: Cursor): number {
  const value = cursor.buffer.readUInt8(cursor.at);
  cursor.at += 1;
  return value;
}

function u2(cursor: Cursor): number {
  const value = cursor.buffer.readUInt16BE(cursor.at);
  cursor.at += 2;
  return value;
}

function u4(cursor: Cursor): number {
  const value = cursor.buffer.readUInt32BE(cursor.at);
  cursor.at += 4;
  return value;
}

function readConstantPool(cursor: Cursor): PoolEntry[] | null {
  const count = u2(cursor);
  const pool: PoolEntry[] = [{ kind: 'other' }];
  for (let index = 1; index < count; index += 1) {
    const tag = u1(cursor);
    if (tag === 1) {
      const length = u2(cursor);
      pool.push({
        kind: 'utf8',
        value: cursor.buffer.toString('utf8', cursor.at, cursor.at + length),
      });
      cursor.at += length;
      continue;
    }
    const width = FIXED_WIDTH_TAGS[tag];
    if (width === undefined) {
      return null;
    }
    if (tag === 3) {
      pool.push({ kind: 'integer', value: cursor.buffer.readInt32BE(cursor.at) });
    } else if (tag === 7 || tag === 8) {
      pool.push({ kind: 'index', value: cursor.buffer.readUInt16BE(cursor.at) });
    } else {
      pool.push({ kind: 'other' });
    }
    cursor.at += width;
    if (tag === 5 || tag === 6) {
      pool.push({ kind: 'other' });
      index += 1;
    }
  }
  return pool;
}

function utf8(pool: PoolEntry[], index: number): string | null {
  const entry = pool[index];
  /* v8 ignore next -- an out-of-range pool index means a class file javac could not have written; the undefined arm keeps that a null rather than a throw. */
  return entry !== undefined && entry.kind === 'utf8' ? entry.value : null;
}

function skipElementValue(cursor: Cursor): void {
  const tag = String.fromCharCode(u1(cursor));
  if (tag === '[') {
    const count = u2(cursor);
    for (let i = 0; i < count; i += 1) {
      skipElementValue(cursor);
    }
    return;
  }
  if (tag === '@') {
    skipAnnotation(cursor);
    return;
  }
  cursor.at += tag === 'e' ? 4 : 2;
}

function skipAnnotation(cursor: Cursor): void {
  cursor.at += 2;
  const pairs = u2(cursor);
  for (let i = 0; i < pairs; i += 1) {
    cursor.at += 2;
    skipElementValue(cursor);
  }
}

function readDeprecatedAnnotation(
  buffer: Buffer,
  start: number,
  length: number,
  pool: PoolEntry[],
): { since: string | null; for_removal: boolean } | null {
  const cursor: Cursor = { buffer, at: start };
  const end = start + length;
  const count = u2(cursor);
  for (let i = 0; i < count && cursor.at < end; i += 1) {
    const typeIndex = u2(cursor);
    const pairs = u2(cursor);
    const isDeprecated = utf8(pool, typeIndex) === DEPRECATED_ANNOTATION;
    let since: string | null = null;
    let forRemoval = false;
    for (let pair = 0; pair < pairs; pair += 1) {
      const nameIndex = u2(cursor);
      const name = utf8(pool, nameIndex);
      const valueStart = cursor.at;
      skipElementValue(cursor);
      if (!isDeprecated) {
        continue;
      }
      const tag = String.fromCharCode(buffer.readUInt8(valueStart));
      const constant = pool[buffer.readUInt16BE(valueStart + 1)];
      if (name === 'since' && tag === 's' && constant?.kind === 'utf8') {
        since = constant.value;
      }
      if (name === 'forRemoval' && tag === 'Z' && constant?.kind === 'integer') {
        forRemoval = constant.value !== 0;
      }
    }
    if (isDeprecated) {
      return { since, for_removal: forRemoval };
    }
  }
  return null;
}

function readAttributes(cursor: Cursor, pool: PoolEntry[]): ClassFileDeprecation {
  const count = u2(cursor);
  let verdict: ClassFileDeprecation = { deprecated: false, since: null, for_removal: false };
  for (let i = 0; i < count; i += 1) {
    const name = utf8(pool, u2(cursor));
    const length = u4(cursor);
    const start = cursor.at;
    if (name === 'Deprecated') {
      verdict = { ...verdict, deprecated: true };
    } else if (name === 'RuntimeVisibleAnnotations') {
      const annotation = readDeprecatedAnnotation(cursor.buffer, start, length, pool);
      if (annotation !== null) {
        verdict = {
          deprecated: true,
          since: annotation.since,
          for_removal: annotation.for_removal,
        };
      }
    }
    cursor.at = start + length;
  }
  return verdict;
}

function readMembers(cursor: Cursor, pool: PoolEntry[]): ClassFileMember[] {
  const count = u2(cursor);
  const members: ClassFileMember[] = [];
  for (let i = 0; i < count; i += 1) {
    cursor.at += 2;
    const name = utf8(pool, u2(cursor));
    cursor.at += 2;
    const deprecation = readAttributes(cursor, pool);
    if (name !== null) {
      members.push({ name, ...deprecation });
    }
  }
  return members;
}

export function parseClassFile(buffer: Buffer): ParsedClassFile | null {
  try {
    const cursor: Cursor = { buffer, at: 0 };
    if (u4(cursor) !== CLASS_FILE_MAGIC) {
      return null;
    }
    cursor.at += 4;
    const pool = readConstantPool(cursor);
    if (pool === null) {
      return null;
    }
    cursor.at += 2;
    const thisClass = pool[u2(cursor)];
    cursor.at += 2;
    const interfaces = u2(cursor);
    cursor.at += 2 * interfaces;
    const name = thisClass?.kind === 'index' ? utf8(pool, thisClass.value) : null;
    if (name === null) {
      return null;
    }
    const fields = readMembers(cursor, pool);
    const methods = readMembers(cursor, pool);
    const classDeprecation = readAttributes(cursor, pool);
    return { name, ...classDeprecation, members: [...fields, ...methods] };
    /* v8 ignore start -- every read above is bounds-checked by Buffer itself; this catch turns a truncated or hostile class file into "unreadable" rather than a thrown build. */
  } catch {
    return null;
  }
}
/* v8 ignore stop */
