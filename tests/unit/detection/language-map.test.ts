import { describe, expect, it } from 'vitest';

import { ecosystemToLanguage } from '@/detection/language-map';

describe('ecosystemToLanguage', () => {
  it('maps every known ecosystem to a human-readable label', () => {
    expect(ecosystemToLanguage('node')).toBe('JavaScript/TypeScript');
    expect(ecosystemToLanguage('php')).toBe('PHP');
    expect(ecosystemToLanguage('python')).toBe('Python');
    expect(ecosystemToLanguage('ruby')).toBe('Ruby');
    expect(ecosystemToLanguage('jvm')).toBe('Java/Kotlin');
    expect(ecosystemToLanguage('go')).toBe('Go');
    expect(ecosystemToLanguage('rust')).toBe('Rust');
    expect(ecosystemToLanguage('dart')).toBe('Dart');
  });

  it('returns null for null or undefined', () => {
    expect(ecosystemToLanguage(null)).toBeNull();
    expect(ecosystemToLanguage(undefined)).toBeNull();
  });

  it('returns null for an unrecognised ecosystem string', () => {
    expect(ecosystemToLanguage('cobol' as never)).toBeNull();
  });
});
