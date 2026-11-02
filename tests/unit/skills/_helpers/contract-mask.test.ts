import { describe, expect, it } from 'vitest';

import { dirForms, maskDir } from './contract.js';

describe('contract path masking', () => {
  it('masks the temp dir and its macOS realpath alike', () => {
    const text = 'a /var/folders/x/paqad-contract-1/f b /private/var/folders/x/paqad-contract-1/g';
    expect(
      maskDir(text, '/var/folders/x/paqad-contract-1', '/private/var/folders/x/paqad-contract-1'),
    ).toBe('a <dir>/f b <dir>/g');
  });

  it('masks Windows backslash, forward slash and Git Bash forms of the temp dir', () => {
    const dir = 'C:\\Users\\me\\AppData\\Local\\Temp\\paqad-contract-1';
    const text = [
      `${dir}\\f`,
      'C:/Users/me/AppData/Local/Temp/paqad-contract-1/g',
      '/c/Users/me/AppData/Local/Temp/paqad-contract-1/h',
    ].join('\n');
    expect(maskDir(text, dir, dir)).toBe('<dir>\\f\n<dir>/g\n<dir>/h');
  });

  it('replaces the longest form first so a realpath prefix never leaves a stray part', () => {
    const forms = dirForms('/var/t', '/private/var/t');
    expect(forms[0]).toBe('/private/var/t');
    expect(maskDir('/private/var/t/x', '/var/t', '/private/var/t')).toBe('<dir>/x');
  });
});
