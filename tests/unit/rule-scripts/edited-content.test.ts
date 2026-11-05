import { describe, expect, it } from 'vitest';

import { editedContent } from '@/rule-scripts/edited-content.js';

const FILE = 'a\nb\nc\nb\n';

function patch(...lines: string[]): { command: string } {
  return {
    command: ['*** Begin Patch', '*** Update File: src/x.ts', ...lines, '*** End Patch'].join('\n'),
  };
}

describe('editedContent', () => {
  it('applies a unique Edit literally, even with replacement patterns in the new text', () => {
    const input = { file_path: 'x', old_string: 'a\n', new_string: "$&$'\n" };
    expect(editedContent('Edit', input, FILE)).toBe("$&$'\nb\nc\nb\n");
  });

  it('applies every match only under replace_all', () => {
    const base = { file_path: 'x', old_string: 'b\n', new_string: 'z\n' };
    expect(editedContent('Edit', base, FILE)).toBeNull();
    expect(editedContent('Edit', { ...base, replace_all: true }, FILE)).toBe('a\nz\nc\nz\n');
  });

  it.each([
    ['an absent old text', { old_string: 'nope', new_string: 'x' }],
    ['an empty old text', { old_string: '', new_string: 'x' }],
    ['a change to nothing', { old_string: 'a', new_string: 'a' }],
    ['a missing new text', { old_string: 'a' }],
    ['a non-boolean replace_all', { old_string: 'a', new_string: 'x', replace_all: 'yes' }],
    ['an unknown field', { old_string: 'a', new_string: 'x', edits: [] }],
  ])('refuses an Edit with %s', (_name, input) => {
    expect(editedContent('Edit', { file_path: 'x', ...input }, FILE)).toBeNull();
  });

  it('takes the whole content from a Write and refuses a malformed one', () => {
    expect(editedContent('Write', { file_path: 'x', content: 'new\n' }, FILE)).toBe('new\n');
    expect(editedContent('Write', { file_path: 'x' }, FILE)).toBeNull();
    expect(editedContent('Write', { file_path: 'x', content: 'n', mode: 1 }, FILE)).toBeNull();
  });

  it('refuses every other tool and a non-object input', () => {
    expect(editedContent('NotebookEdit', { notebook_path: 'x' }, FILE)).toBeNull();
    expect(editedContent(undefined, { file_path: 'x', content: 'n' }, FILE)).toBeNull();
    expect(editedContent('Write', 'text', FILE)).toBeNull();
  });

  it('applies an apply_patch update whose context is unique, in a string or an object', () => {
    const input = patch('@@', ' a', '-b', '+z', ' c');
    expect(editedContent('apply_patch', input, FILE)).toBe('a\nz\nc\nb\n');
    expect(editedContent('apply_patch', input.command, FILE)).toBe('a\nz\nc\nb\n');
  });

  it('applies several chunks in file order', () => {
    const input = patch('@@', '-a', '+x', '@@', ' c', '-b', '+y');
    expect(editedContent('apply_patch', input, FILE)).toBe('x\nb\nc\ny\n');
    const backwards = patch('@@', ' c', '-b', '+y', '@@', '-a', '+x');
    expect(editedContent('apply_patch', backwards, FILE)).toBeNull();
  });

  it.each([
    ['an ambiguous match', patch('@@', '-b', '+z')],
    ['an absent match', patch('@@', '-nope', '+z')],
    ['an insert with no context', patch('@@', '+z')],
    ['a named context', patch('@@ function a', '-a', '+z')],
    ['an end-of-file marker', patch('@@', '-a', '+z', '*** End of File')],
    ['a move', patch('*** Move to: src/y.ts', '@@', '-a', '+z')],
    ['a second file', patch('@@', '-a', '+z', '*** Update File: src/y.ts', '@@', '-b', '+z')],
    ['an empty patch', patch()],
    ['a bare line', patch('@@', 'a')],
    ['an added file', { command: '*** Begin Patch\n*** Add File: a\n+x\n*** End Patch' }],
    ['a deleted file', { command: '*** Begin Patch\n*** Delete File: a\n*** End Patch' }],
    ['no end marker', { command: '*** Begin Patch\n*** Update File: a\n@@\n-a\n+z' }],
    [
      'two patches',
      { command: patch('@@', '-a', '+z').command, input: patch('@@', '-a', '+y').command },
    ],
  ])('refuses an apply_patch with %s', (_name, input) => {
    expect(editedContent('apply_patch', input, FILE)).toBeNull();
  });
});
