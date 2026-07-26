import { deflateRawSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { parseClassFile } from '@/framework-api/adapters/class-file.js';
import { readZipDirectory, readZipEntry } from '@/framework-api/adapters/jar.js';

import { buildClassFile, buildZip } from './jar-fixtures.js';

describe('readZipDirectory', () => {
  it('reads every entry of an archive', () => {
    const zip = buildZip([
      { name: 'META-INF/MANIFEST.MF', data: Buffer.from('Manifest-Version: 1.0\n') },
      { name: 'com/acme/Thing.class', data: Buffer.from('bytes') },
    ]);
    expect(readZipDirectory(zip)?.map((entry) => entry.name)).toEqual([
      'META-INF/MANIFEST.MF',
      'com/acme/Thing.class',
    ]);
  });

  it('finds the end record behind a trailing archive comment', () => {
    const zip = buildZip([{ name: 'a.txt', data: Buffer.from('a') }], { comment: 'built by paqad' });
    expect(readZipDirectory(zip)).toHaveLength(1);
  });

  it('returns null for something that is not a zip at all', () => {
    expect(readZipDirectory(Buffer.from('definitely not a jar'))).toBeNull();
  });

  it('returns null rather than half-reading a zip64 archive', () => {
    const zip = buildZip([{ name: 'a.txt', data: Buffer.from('a') }], { zip64Locator: true });
    expect(readZipDirectory(zip)).toBeNull();
  });

  it('returns null when the central directory is corrupt', () => {
    const zip = buildZip([{ name: 'a.txt', data: Buffer.from('a') }]);
    const directoryOffset = zip.readUInt32LE(zip.length - 6);
    zip.writeUInt32LE(0xdeadbeef, directoryOffset);
    expect(readZipDirectory(zip)).toBeNull();
  });
});

describe('readZipEntry', () => {
  it('reads a stored entry', () => {
    const zip = buildZip([{ name: 'a.txt', data: Buffer.from('hello') }]);
    const entry = readZipDirectory(zip)?.[0];
    expect(readZipEntry(zip, entry!)?.toString('utf8')).toBe('hello');
  });

  it('inflates a deflated entry', () => {
    const zip = buildZip([{ name: 'a.txt', data: Buffer.from('hello hello hello'), deflate: true }]);
    const entry = readZipDirectory(zip)?.[0];
    expect(readZipEntry(zip, entry!)?.toString('utf8')).toBe('hello hello hello');
  });

  it('returns null for a compression method it does not implement', () => {
    const zip = buildZip([{ name: 'a.txt', data: Buffer.from('hello'), method: 12 }]);
    const entry = readZipDirectory(zip)?.[0];
    expect(readZipEntry(zip, entry!)).toBeNull();
  });

  it('returns null when the local header is not where the directory says', () => {
    const zip = buildZip([{ name: 'a.txt', data: Buffer.from('hello') }]);
    const entry = readZipDirectory(zip)?.[0];
    expect(readZipEntry(zip, { ...entry!, localHeaderOffset: 3 })).toBeNull();
  });

  it('returns null when a deflated entry holds corrupt bytes', () => {
    const zip = buildZip([{ name: 'a.txt', data: Buffer.from('hello'), method: 8 }]);
    const entry = readZipDirectory(zip)?.[0];
    expect(readZipEntry(zip, entry!)).toBeNull();
  });
});

describe('parseClassFile', () => {
  it('reads the class name and its members', () => {
    const parsed = parseClassFile(
      buildClassFile({
        name: 'com/acme/Thing',
        interfaces: 2,
        methods: [{ name: 'go' }, { name: 'stop' }],
        fields: [{ name: 'count' }],
      }),
    );
    expect(parsed?.name).toBe('com/acme/Thing');
    expect(parsed?.members.map((member) => member.name)).toEqual(['count', 'go', 'stop']);
    expect(parsed?.deprecated).toBe(false);
  });

  it('reads @Deprecated with since and forRemoval off a method (AC-2, FR-7)', () => {
    const parsed = parseClassFile(
      buildClassFile({
        name: 'com/acme/Thing',
        methods: [{ name: 'legacy', deprecated: { since: '9', forRemoval: true } }],
      }),
    );
    expect(parsed?.members[0]).toMatchObject({
      name: 'legacy',
      deprecated: true,
      since: '9',
      for_removal: true,
    });
  });

  it('reads the bare Deprecated attribute with no annotation detail', () => {
    const parsed = parseClassFile(
      buildClassFile({ name: 'com/acme/Thing', methods: [{ name: 'old', deprecated: {} }] }),
    );
    expect(parsed?.members[0]).toMatchObject({ deprecated: true, since: null, for_removal: false });
  });

  it('reads a deprecated class', () => {
    const parsed = parseClassFile(
      buildClassFile({ name: 'com/acme/Gone', classDeprecated: { since: '11', forRemoval: false } }),
    );
    expect(parsed).toMatchObject({ deprecated: true, since: '11', for_removal: false });
  });

  it('skips an unrelated runtime annotation without claiming a deprecation', () => {
    const parsed = parseClassFile(
      buildClassFile({
        name: 'com/acme/Thing',
        methods: [{ name: 'annotated', otherAnnotation: true }],
      }),
    );
    expect(parsed?.members[0]?.deprecated).toBe(false);
  });

  it('reads a class whose pool holds wide and reference constants', () => {
    const parsed = parseClassFile(buildClassFile({ name: 'com/acme/Wide', wideConstants: true }));
    expect(parsed?.name).toBe('com/acme/Wide');
  });

  it('returns null for a file that is not a class file', () => {
    expect(parseClassFile(Buffer.from('not a class file at all'))).toBeNull();
  });

  it('returns null for a constant-pool tag it does not know', () => {
    expect(parseClassFile(buildClassFile({ name: 'com/acme/Thing', unknownTag: true }))).toBeNull();
  });

  it('returns null when this_class does not resolve to a name', () => {
    expect(parseClassFile(buildClassFile({ name: 'com/acme/Thing', brokenThisClass: true }))).toBeNull();
  });

  it('returns null for a truncated class file rather than throwing', () => {
    const whole = buildClassFile({ name: 'com/acme/Thing', methods: [{ name: 'go' }] });
    expect(parseClassFile(whole.subarray(0, whole.length - 8))).toBeNull();
  });
});
