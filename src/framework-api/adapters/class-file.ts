// Reading `@Deprecated` out of JVM bytecode (issue #398).
//
// `@Deprecated` has RUNTIME retention, so javac writes it into the class file twice over:
// as the legacy `Deprecated` attribute (a bare marker, present since JDK 1.1) and, on
// Java 9+, as a `RuntimeVisibleAnnotations` entry for `Ljava/lang/Deprecated;` carrying
// `since` and `forRemoval`. Both are read here — the marker proves the deprecation, the
// annotation supplies its detail (FR-7).
//
// The class-file layout is the published one (JVMS §4). Every reader here returns null the
// moment it meets something it does not fully understand, because a half-parsed class must
// never become an assertion about symbols that were not seen.

/** What a class file says about one declaration's deprecation. */
export interface ClassFileDeprecation {
  deprecated: boolean;
  since: string | null;
  for_removal: boolean;
}

/** One member (field or method) of a class, with its deprecation. */
export interface ClassFileMember extends ClassFileDeprecation {
  name: string;
}

/** A parsed class file, narrowed to what the framework-API index records. */
export interface ParsedClassFile extends ClassFileDeprecation {
  /** The binary class name, e.g. `org/springframework/boot/SpringApplication`. */
  name: string;
  members: ClassFileMember[];
}

const CLASS_FILE_MAGIC = 0xcafebabe;
const DEPRECATED_ANNOTATION = 'Ljava/lang/Deprecated;';

/** Constant-pool tags whose entry is a fixed width, in bytes after the tag. */
const FIXED_WIDTH_TAGS: Record<number, number> = {
  3: 4, // Integer
  4: 4, // Float
  5: 8, // Long (takes two pool slots)
  6: 8, // Double (takes two pool slots)
  7: 2, // Class
  8: 2, // String
  9: 4, // Fieldref
  10: 4, // Methodref
  11: 4, // InterfaceMethodref
  12: 4, // NameAndType
  15: 3, // MethodHandle
  16: 2, // MethodType
  17: 4, // Dynamic
  18: 4, // InvokeDynamic
  19: 2, // Module
  20: 2, // Package
};

/** A constant-pool entry, kept only in the two shapes this reader resolves. */
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

/** Read the constant pool, or null when it holds a tag this reader does not know. */
function readConstantPool(cursor: Cursor): PoolEntry[] | null {
  const count = u2(cursor);
  // The pool is 1-indexed, and a Long or Double occupies the slot after its own.
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

/** The UTF-8 constant at `index`, or null when it is not one. */
function utf8(pool: PoolEntry[], index: number): string | null {
  const entry = pool[index];
  /* v8 ignore next -- an out-of-range pool index means a class file javac could not have written; the undefined arm keeps that a null rather than a throw. */
  return entry !== undefined && entry.kind === 'utf8' ? entry.value : null;
}

/** Skip one `element_value`, which is recursive through arrays and nested annotations. */
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
  // 'e' (enum) is two indices; every other tag is a single constant-pool index.
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

/**
 * The `since` / `forRemoval` a `Ljava/lang/Deprecated;` annotation carries, or null when
 * the attribute holds no such annotation.
 */
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

/** Read an attribute table and fold it into a deprecation verdict. */
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

/** Read a field or method table. */
function readMembers(cursor: Cursor, pool: PoolEntry[]): ClassFileMember[] {
  const count = u2(cursor);
  const members: ClassFileMember[] = [];
  for (let i = 0; i < count; i += 1) {
    cursor.at += 2; // access_flags
    const name = utf8(pool, u2(cursor));
    cursor.at += 2; // descriptor_index
    const deprecation = readAttributes(cursor, pool);
    if (name !== null) {
      members.push({ name, ...deprecation });
    }
  }
  return members;
}

/**
 * Parse a class file, or null when it is not one this reader understands.
 *
 * Only the class's own name, its members' names, and their deprecation are read: those are
 * the two questions the index answers, and walking the code attributes would cost time the
 * index budget does not have for an answer nobody asked for.
 */
export function parseClassFile(buffer: Buffer): ParsedClassFile | null {
  try {
    const cursor: Cursor = { buffer, at: 0 };
    if (u4(cursor) !== CLASS_FILE_MAGIC) {
      return null;
    }
    cursor.at += 4; // minor + major version
    const pool = readConstantPool(cursor);
    if (pool === null) {
      return null;
    }
    cursor.at += 2; // access_flags
    const thisClass = pool[u2(cursor)];
    cursor.at += 2; // super_class
    // Read the count into a variable first: `cursor.at += 2 * u2(cursor)` would capture
    // the offset BEFORE the read advanced it and silently lose those two bytes, which
    // desyncs every attribute length that follows.
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
    /* v8 ignore next 4 -- every read above is bounds-checked by Buffer itself; this catch turns a truncated or hostile class file into "unreadable" rather than a thrown build. */
  } catch {
    return null;
  }
}
