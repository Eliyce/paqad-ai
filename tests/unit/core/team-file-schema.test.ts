import { describe, expect, it } from 'vitest';

import {
  isHigherStamp,
  isNewerTeamFile,
  newerTeamFileLine,
  parseStampInteger,
  readTeamFileStamp,
  swapTeamFileStamp,
  TEAM_FILE_SCHEMA_VERSION,
} from '@/core/team-file-schema.js';

describe('the integer comparison', () => {
  it.each([
    [2, 1, true],
    ['2', 1, true],
    [1, 1, false],
    ['1', 1, false],
    [0, 1, false],
    [-1, 1, false],
    [1.5, 5, false],
    ['1.5', 5, false],
    [undefined, 0, false],
    [null, 0, false],
    ['text', 0, false],
    ['', 0, false],
  ])('AC-25: %s against %s is higher: %s', (found, running, higher) => {
    expect(isHigherStamp(found, running)).toBe(higher);
  });

  it('reads only positive whole numbers', () => {
    expect(parseStampInteger(3)).toBe(3);
    expect(parseStampInteger('03')).toBeNull();
    expect(parseStampInteger('"2"')).toBeNull();
  });
});

describe('reading and swapping the stamp', () => {
  it('starts at schema 1', () => {
    expect(TEAM_FILE_SCHEMA_VERSION).toBe(1);
  });

  it.each([
    ['0', 'schema_version: 0\n'],
    ['-1', 'schema_version: -1\n'],
    ['1.5', 'schema_version: 1.5\n'],
    ['a quoted number', 'schema_version: "2"\n'],
    ['null', 'schema_version: null\n'],
    ['empty', 'schema_version:\n'],
    ['text', 'schema_version: two\n'],
    ['a text old stamp', 'paqad_version: banana\n'],
    ['both keys with a malformed schema', 'paqad_version: "1.0.0"\nschema_version: x\n'],
  ])('AC-21: %s is malformed, is not newer, and is not rewritten', (_name, text) => {
    expect(readTeamFileStamp(text)).toEqual({ kind: 'malformed' });
    expect(isNewerTeamFile(text)).toBe(false);
    expect(swapTeamFileStamp(text)).toBe(text);
  });

  it('AC-21: a file with neither key stays as it is', () => {
    const text = '# paqad_version: "1.0.0"\nenabled: true\n';
    expect(readTeamFileStamp(text)).toEqual({ kind: 'none' });
    expect(swapTeamFileStamp(text)).toBe(text);
  });

  it.each([
    ['quoted', 'a: 1\npaqad_version: "1.2.3"\nb: 2\n', 'a: 1\nschema_version: 1\nb: 2\n'],
    ['single quoted', "paqad_version: '1.2.3'\n", 'schema_version: 1\n'],
    ['unquoted', 'paqad_version: 1.2.3\n', 'schema_version: 1\n'],
    ['with a comment', 'paqad_version: "1.2.3" # note\n', 'schema_version: 1 # note\n'],
    ['CRLF', 'paqad_version: "1.2.3"\r\nb: 2\r\n', 'schema_version: 1\r\nb: 2\r\n'],
    ['no final newline', 'b: 2\npaqad_version: "1.2.3"', 'b: 2\nschema_version: 1'],
    ['a BOM', '\uFEFFpaqad_version: "1.2.3"\n', '\uFEFFschema_version: 1\n'],
  ])('AC-21: swaps %s', (_name, before, after) => {
    expect(readTeamFileStamp(before)).toEqual({ kind: 'legacy' });
    expect(swapTeamFileStamp(before)).toBe(after);
    expect(swapTeamFileStamp(after)).toBe(after);
  });

  it('AC-21: swaps only the top-level line', () => {
    const text = 'paqad_version: "1.2.3"\nnested:\n  paqad_version: "9.9.9"\n# paqad_version: x\n';
    expect(swapTeamFileStamp(text)).toBe(
      'schema_version: 1\nnested:\n  paqad_version: "9.9.9"\n# paqad_version: x\n',
    );
  });

  it('AC-21: both keys at 1 drop the stray stamp', () => {
    expect(swapTeamFileStamp('schema_version: 1\na: 1\npaqad_version: "1.2.3"\n')).toBe(
      'schema_version: 1\na: 1\n',
    );
  });

  it('AC-21: both keys at 2 are newer and stay', () => {
    const text = 'schema_version: 2\npaqad_version: "1.2.3"\n';
    expect(isNewerTeamFile(text)).toBe(true);
    expect(swapTeamFileStamp(text)).toBe(text);
  });

  it('FR-36: restores the stamp in place when a re-render moved it, keeping other unknown keys', () => {
    const NOTE = '# Not a paqad setting, so paqad ignores it (kept as written):';
    expect(swapTeamFileStamp(`paqad_version: "1.2.3"\na: 1\n\n${NOTE}\nschema_version: 1\n`)).toBe(
      'schema_version: 1\na: 1\n',
    );
    expect(
      swapTeamFileStamp(`paqad_version: "1.2.3"\n\n${NOTE}\nschema_version: 1\nother: 2\n`),
    ).toBe(`schema_version: 1\n\n${NOTE}\nother: 2\n`);
  });

  it('names a newer file with the exact line', () => {
    expect(newerTeamFileLine('a.yaml')).toBe(
      "a.yaml was written by a newer paqad, so it wasn't changed. Update paqad-ai.",
    );
  });
});
