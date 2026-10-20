import { deflateRawSync } from 'node:zlib';

const LOCAL_FILE_HEADER = 0x04034b50;
const CENTRAL_FILE_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const ZIP64_LOCATOR = 0x07064b50;

export interface ZipFixtureEntry {
  name: string;
  data: Buffer;
  deflate?: boolean;
  method?: number;
}

export function buildZip(
  entries: ZipFixtureEntry[],
  options: { comment?: string; zip64Locator?: boolean } = {},
): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const method = entry.method ?? (entry.deflate === true ? 8 : 0);
    const payload = entry.deflate === true ? deflateRawSync(entry.data) : entry.data;
    const name = Buffer.from(entry.name, 'utf8');

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_FILE_HEADER, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, payload);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_FILE_HEADER, 0);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + payload.length;
  }

  const directory = Buffer.concat(centrals);
  const locator = options.zip64Locator === true ? Buffer.alloc(20) : Buffer.alloc(0);
  if (options.zip64Locator === true) {
    locator.writeUInt32LE(ZIP64_LOCATOR, 0);
  }
  const comment = Buffer.from(options.comment ?? '', 'utf8');
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_OF_CENTRAL_DIRECTORY, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(comment.length, 20);

  return Buffer.concat([Buffer.concat(locals), directory, locator, end, comment]);
}

export interface DeprecationFixture {
  since?: string;
  forRemoval?: boolean;
}

export interface MemberFixture {
  name: string;
  deprecated?: DeprecationFixture;
  otherAnnotation?: boolean;
  richAnnotation?: boolean;
}

export interface ClassFixture {
  name: string;
  fields?: MemberFixture[];
  methods?: MemberFixture[];
  classDeprecated?: DeprecationFixture;
  interfaces?: number;
  wideConstants?: boolean;
  unknownTag?: boolean;
  brokenThisClass?: boolean;
}

class ConstantPool {
  private readonly parts: Buffer[] = [];
  private next = 1;

  utf8(value: string): number {
    const bytes = Buffer.from(value, 'utf8');
    const entry = Buffer.alloc(3 + bytes.length);
    entry.writeUInt8(1, 0);
    entry.writeUInt16BE(bytes.length, 1);
    bytes.copy(entry, 3);
    return this.push(entry);
  }

  classRef(nameIndex: number): number {
    const entry = Buffer.alloc(3);
    entry.writeUInt8(7, 0);
    entry.writeUInt16BE(nameIndex, 1);
    return this.push(entry);
  }

  integer(value: number): number {
    const entry = Buffer.alloc(5);
    entry.writeUInt8(3, 0);
    entry.writeInt32BE(value, 1);
    return this.push(entry);
  }

  long(): number {
    const entry = Buffer.alloc(9);
    entry.writeUInt8(5, 0);
    const index = this.push(entry);
    this.next += 1;
    return index;
  }

  methodRef(): number {
    const entry = Buffer.alloc(5);
    entry.writeUInt8(10, 0);
    return this.push(entry);
  }

  unknown(): number {
    const entry = Buffer.alloc(1);
    entry.writeUInt8(99, 0);
    return this.push(entry);
  }

  private push(entry: Buffer): number {
    this.parts.push(entry);
    const index = this.next;
    this.next += 1;
    return index;
  }

  get count(): number {
    return this.next;
  }

  get bytes(): Buffer {
    return Buffer.concat(this.parts);
  }
}

function u2(value: number): Buffer {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16BE(value, 0);
  return buffer;
}

function u4(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value, 0);
  return buffer;
}

export function buildClassFile(fixture: ClassFixture): Buffer {
  const pool = new ConstantPool();
  const nameIndex = pool.utf8(fixture.name);
  const thisClass = fixture.brokenThisClass === true ? nameIndex : pool.classRef(nameIndex);
  const descriptorIndex = pool.utf8('()V');
  const deprecatedAttr = pool.utf8('Deprecated');
  const annotationsAttr = pool.utf8('RuntimeVisibleAnnotations');
  const deprecatedType = pool.utf8('Ljava/lang/Deprecated;');
  const otherType = pool.utf8('Lorg/acme/Marker;');
  const sinceName = pool.utf8('since');
  const forRemovalName = pool.utf8('forRemoval');
  const trueValue = pool.integer(1);
  const falseValue = pool.integer(0);
  if (fixture.wideConstants === true) {
    pool.long();
    pool.methodRef();
  }
  if (fixture.unknownTag === true) {
    pool.unknown();
  }

  const annotation = (typeIndex: number, detail?: DeprecationFixture): Buffer => {
    const pairs: Buffer[] = [];
    if (detail?.since !== undefined) {
      pairs.push(u2(sinceName), Buffer.from([0x73]), u2(pool.utf8(detail.since)));
    }
    if (detail?.forRemoval !== undefined) {
      pairs.push(
        u2(forRemovalName),
        Buffer.from([0x5a]),
        u2(detail.forRemoval ? trueValue : falseValue),
      );
    }
    return Buffer.concat([u2(1), u2(typeIndex), u2(pairs.length / 3), ...pairs]);
  };

  const richAnnotation = (): Buffer => {
    const arrayValue = Buffer.concat([
      Buffer.from([0x5b]),
      u2(2),
      Buffer.from([0x73]),
      u2(sinceName),
      Buffer.from([0x73]),
      u2(sinceName),
    ]);
    const nested = Buffer.concat([
      Buffer.from([0x40]),
      u2(otherType),
      u2(1),
      u2(sinceName),
      Buffer.from([0x73]),
      u2(sinceName),
    ]);
    const enumValue = Buffer.concat([Buffer.from([0x65]), u2(sinceName), u2(sinceName)]);
    return Buffer.concat([
      u2(2),
      u2(otherType),
      u2(3),
      u2(sinceName),
      arrayValue,
      u2(sinceName),
      nested,
      u2(sinceName),
      enumValue,
      u2(deprecatedType),
      u2(1),
      u2(sinceName),
      Buffer.from([0x73]),
      u2(pool.utf8('7')),
    ]);
  };

  const attributes = (member: MemberFixture | { deprecated?: DeprecationFixture }): Buffer => {
    const parts: Buffer[] = [];
    let count = 0;
    if (member.deprecated !== undefined) {
      parts.push(u2(deprecatedAttr), u4(0));
      count += 1;
      if (member.deprecated.since !== undefined || member.deprecated.forRemoval !== undefined) {
        const body = annotation(deprecatedType, member.deprecated);
        parts.push(u2(annotationsAttr), u4(body.length), body);
        count += 1;
      }
    }
    if ('otherAnnotation' in member && member.otherAnnotation === true) {
      const body = annotation(otherType);
      parts.push(u2(annotationsAttr), u4(body.length), body);
      count += 1;
    }
    if ('richAnnotation' in member && member.richAnnotation === true) {
      const body = richAnnotation();
      parts.push(u2(annotationsAttr), u4(body.length), body);
      count += 1;
    }
    return Buffer.concat([u2(count), ...parts]);
  };

  const members = (list: MemberFixture[]): Buffer =>
    Buffer.concat([
      u2(list.length),
      ...list.map((member) =>
        Buffer.concat([u2(1), u2(pool.utf8(member.name)), u2(descriptorIndex), attributes(member)]),
      ),
    ]);

  const fields = members(fixture.fields ?? []);
  const methods = members(fixture.methods ?? []);
  const classAttributes = attributes({ deprecated: fixture.classDeprecated });

  return Buffer.concat([
    u4(0xcafebabe),
    u2(0),
    u2(52),
    u2(pool.count),
    pool.bytes,
    u2(0x0021),
    u2(thisClass),
    u2(0),
    u2(fixture.interfaces ?? 0),
    Buffer.alloc(2 * (fixture.interfaces ?? 0)),
    fields,
    methods,
    classAttributes,
  ]);
}
