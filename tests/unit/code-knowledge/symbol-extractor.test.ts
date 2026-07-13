import { describe, expect, it } from 'vitest';

import { extractSymbols } from '@/code-knowledge/symbol-extractor.js';

function names(code: string, file = 'src/x.ts'): string[] {
  return extractSymbols(file, code).map((s) => s.name);
}

describe('extractSymbols (TypeScript/JavaScript)', () => {
  it('extracts an exported function with its signature and line', () => {
    const code = 'const a = 1;\nexport function greet(name: string): string {\n  return name;\n}\n';
    const [sym] = extractSymbols('src/greet.ts', code);
    expect(sym).toMatchObject({
      name: 'greet',
      kind: 'function',
      line: 2,
      exported: true,
      extraction_tier: 'regex',
    });
    expect(sym!.signature).toBe('greet(name: string): string');
  });

  it('extracts async, default, and generator functions', () => {
    expect(names('export async function a() {}')).toEqual(['a']);
    expect(names('export default function b() {}')).toEqual(['b']);
    expect(names('export function* c() {}')).toEqual(['c']);
  });

  it('extracts an exported class including heritage in the signature', () => {
    const [sym] = extractSymbols(
      'src/c.ts',
      'export abstract class Foo extends Bar implements Baz {\n}',
    );
    expect(sym).toMatchObject({ name: 'Foo', kind: 'class' });
    expect(sym!.signature).toBe('Foo extends Bar implements Baz');
  });

  it('classifies interface, type, and enum as kind "type"', () => {
    const syms = extractSymbols(
      'src/t.ts',
      'export interface A { x: number }\nexport type B = string\nexport enum C { X }\n',
    );
    expect(syms.map((s) => [s.name, s.kind])).toEqual([
      ['A', 'type'],
      ['B', 'type'],
      ['C', 'type'],
    ]);
    expect(syms[0]!.signature).toBe('interface A');
  });

  it('treats an exported const as kind "const"', () => {
    const [sym] = extractSymbols('src/k.ts', 'export const MAX = 10;');
    expect(sym).toMatchObject({ name: 'MAX', kind: 'const' });
  });

  it('captures an arrow-function const signature up to the arrow', () => {
    const [sym] = extractSymbols(
      'src/f.ts',
      'export const add = (a: number, b: number): number => a + b;',
    );
    expect(sym!.signature).toBe('add = (a: number, b: number): number =>');
  });

  it('detects a PascalCase arrow component in a .tsx file as kind "component"', () => {
    const [sym] = extractSymbols(
      'src/Button.tsx',
      'export const Button = (props: Props) => <button />;',
    );
    expect(sym).toMatchObject({ name: 'Button', kind: 'component' });
  });

  it('does NOT treat a PascalCase const as a component in a .ts file', () => {
    const [sym] = extractSymbols('src/x.ts', 'export const Config = (opts: O) => opts;');
    expect(sym!.kind).toBe('const');
  });

  it('does NOT treat a lowercase .tsx arrow const as a component', () => {
    const [sym] = extractSymbols('src/x.tsx', 'export const helper = (a: number) => a;');
    expect(sym!.kind).toBe('const');
  });

  it('joins a multi-line function signature', () => {
    const code = 'export function big(\n  a: string,\n  b: number,\n): void {\n}';
    const [sym] = extractSymbols('src/b.ts', code);
    expect(sym!.signature).toBe('big( a: string, b: number, ): void');
  });

  it('ignores non-exported declarations', () => {
    expect(names('function local() {}\nconst hidden = 1;\nclass Priv {}')).toEqual([]);
  });

  it('falls back to name-only when the head is implausibly long', () => {
    const long = 'x'.repeat(250);
    const [sym] = extractSymbols('src/l.ts', `export const wide = ${long};`);
    expect(sym!.signature).toBe('wide');
  });
});

describe('extractSymbols (PHP, file-level)', () => {
  it('extracts classes, interfaces, traits, and functions name-only', () => {
    const code = [
      '<?php',
      'final class UserService {',
      '  public function findUser($id) {}',
      '}',
      'interface Repo {}',
      'trait Loggable {}',
      'function helper() {}',
    ].join('\n');
    const syms = extractSymbols('src/app.php', code);
    expect(syms.map((s) => [s.name, s.kind])).toEqual([
      ['UserService', 'class'],
      ['findUser', 'function'],
      ['Repo', 'class'],
      ['Loggable', 'class'],
      ['helper', 'function'],
    ]);
    expect(syms.every((s) => s.extraction_tier === 'regex')).toBe(true);
  });
});

describe('extractSymbols (Dart, file-level)', () => {
  it('extracts classes and top-level functions, skipping control keywords', () => {
    const code = [
      'abstract class Widget {}',
      'class Home extends Widget {}',
      'int add(int a, int b) {',
      '  if (a > b) { return a; }',
      '  return b;',
      '}',
    ].join('\n');
    const syms = extractSymbols('lib/app.dart', code);
    expect(syms.map((s) => s.name)).toEqual(['Widget', 'Home', 'add']);
  });
});

describe('extractSymbols (unknown)', () => {
  it('returns nothing for an unsupported extension', () => {
    expect(extractSymbols('README.md', '# hi\nexport function x() {}')).toEqual([]);
  });

  it('returns nothing for a file with no extension', () => {
    expect(extractSymbols('Makefile', 'all:')).toEqual([]);
  });
});
