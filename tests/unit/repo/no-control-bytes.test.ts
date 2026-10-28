import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { mintRuleId } from '../../../src/rule-scripts/rule-id';

const REPO = process.cwd();
const TEXT_EXTENSIONS = ['.ts', '.tsx', '.mjs', '.js', '.json', '.md', '.yml', '.yaml', '.py'];
const ALLOWED_BINARY: ReadonlySet<string> = new Set<string>();

function isControlByte(byte: number): boolean {
  return (
    byte <= 0x08 ||
    byte === 0x0b ||
    byte === 0x0c ||
    (byte >= 0x0e && byte <= 0x1f) ||
    byte === 0x7f
  );
}

function controlByteLines(bytes: Uint8Array): number[] {
  const lines: number[] = [];
  let line = 1;
  for (const byte of bytes) {
    if (byte === 0x0a) {
      line++;
      continue;
    }
    if (isControlByte(byte) && lines[lines.length - 1] !== line) lines.push(line);
  }
  return lines;
}

function findings(files: readonly string[], read: (file: string) => Uint8Array): string[] {
  const out: string[] = [];
  for (const file of files) {
    if (ALLOWED_BINARY.has(file)) continue;
    if (!TEXT_EXTENSIONS.some((ext) => file.endsWith(ext))) continue;
    for (const line of controlByteLines(read(file))) out.push(`${file}:${line}`);
  }
  return out;
}

function trackedFiles(): string[] {
  return execFileSync('git', ['ls-files', '-z'], { cwd: REPO, encoding: 'utf8' })
    .split('\0')
    .filter((file) => file !== '' && existsSync(join(REPO, file)));
}

describe('no raw control bytes in tracked text files', () => {
  it('names the file and line of a planted control byte', () => {
    const planted = new TextEncoder().encode('const a = 1;\nconst key = `a\u0000b`;\n');
    expect(findings(['src/planted.ts'], () => planted)).toEqual(['src/planted.ts:2']);
  });

  it('ignores tab, newline and carriage return, and files outside the text extensions', () => {
    const bytes = new TextEncoder().encode('a\tb\r\nc\n');
    expect(findings(['a.ts'], () => bytes)).toEqual([]);
    expect(findings(['icon.png'], () => new Uint8Array([0x89, 0x00, 0x01]))).toEqual([]);
  });

  it('finds none in the repository', () => {
    const files = trackedFiles();
    expect(files.length).toBeGreaterThan(100);
    expect(findings(files, (file) => readFileSync(join(REPO, file)))).toEqual([]);
  });

  it('keeps a rule id minted from a fixed input unchanged by the escaped separator', () => {
    const source = 'docs/instructions/rules/security.md';
    const text = 'Never log secrets.';
    expect(mintRuleId(source, text, new Set())).toBe('RL-21c1');
    expect(mintRuleId(source, text, new Set(['RL-21c1', 'RL-21c1f', 'RL-21c1f1']))).toBe(
      'RL-21c1f17',
    );
  });
});
