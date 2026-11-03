import { hasPath, insertKey, readPath, removeKey, setValue } from '@/git-workflow/yaml-edit.js';

describe('git-workflow YAML edits that keep the file as written', () => {
  it('rejects text that is not valid YAML', () => {
    expect(() => hasPath('a: [1\n', ['a'])).toThrow();
  });

  it('reads scalars and collections at a path', () => {
    const text = 'a:\n  b: 1\n  list: [x, y]\n';
    expect(hasPath(text, ['a', 'b'])).toBe(true);
    expect(hasPath(text, ['a', 'c'])).toBe(false);
    expect(readPath(text, ['a', 'b'])).toBe(1);
    expect(readPath(text, ['a', 'list'])).toEqual(['x', 'y']);
  });

  it('adds a top-level key with a comment, adding the missing final newline', () => {
    expect(insertKey('x: 1\n', [], 'a', 1, 'why')).toBe('x: 1\n\n# why\na: 1\n');
    expect(insertKey('x: 1', [], 'a', 2)).toBe('x: 1\n\na: 2\n');
  });

  it('adds a nested key with a comment after the last entry', () => {
    expect(insertKey('a:\n  b: 1\nz: 2\n', ['a'], 'c', 3, 'note')).toBe(
      'a:\n  b: 1\n  # note\n  c: 3\nz: 2\n',
    );
    expect(insertKey('a:\n  b: 1', ['a'], 'c', 3)).toBe('a:\n  b: 1\n  c: 3\n');
  });

  it('refuses to add under a flow map, a missing parent or an empty map', () => {
    expect(() => insertKey('a: {b: 1}\n', ['a'], 'c', 1)).toThrow(
      "can't add a.c: its parent isn't a block map",
    );
    expect(() => insertKey('a: 1\n', ['nope'], 'c', 1)).toThrow("its parent isn't a block map");
  });

  it('keeps the quote style of a quoted string and leaves an equal value alone', () => {
    expect(setValue('a: "x"\n', ['a'], 'y "z"')).toBe('a: "y \\"z\\""\n');
    expect(setValue("a: 'x'\n", ['a'], "it's")).toBe("a: 'it''s'\n");
    expect(setValue('a: x\n', ['a'], 'x')).toBe('a: x\n');
    expect(setValue('a: 1\n', ['a'], 2)).toBe('a: 2\n');
  });

  it('rewrites a block map as a block, a flow map as a block and a block list as flow', () => {
    expect(setValue('a:\n  b: 1\nz: 0\n', ['a'], { c: 2 })).toBe('a:\n  c: 2\nz: 0\n');
    expect(setValue('a: {b: 1}\nz: 0\n', ['a'], { c: 2 })).toBe('a:\n  c: 2\nz: 0\n');
    expect(setValue('a:\n  - x\n  - y\nz: 0\n', ['a'], ['q'])).toBe('a: [q]\nz: 0\n');
    expect(setValue('a:\n  b: 1\n', ['a'], {})).toBe('a: {}\n');
  });

  it('adds a missing key through setValue', () => {
    expect(setValue('a:\n  b: 1\n', ['a', 'c'], true)).toBe('a:\n  b: 1\n  c: true\n');
  });

  it('removes a key with its value, and leaves the text alone when the key is missing', () => {
    expect(removeKey('a:\n  b: 1\n  c:\n    d: 2\nz: 0\n', ['a', 'c'])).toBe('a:\n  b: 1\nz: 0\n');
    expect(removeKey('a: 1\n', ['nope', 'x'])).toBe('a: 1\n');
    expect(removeKey('a: 1\n', ['b'])).toBe('a: 1\n');
  });
});
