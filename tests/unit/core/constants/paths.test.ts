import { PATHS, REGISTRIES } from '@/core/constants/paths';

describe('paths constants', () => {
  it('keeps all canonical paths relative and non-empty', () => {
    for (const value of Object.values(PATHS)) {
      expect(typeof value).toBe('string');
      expect(value.length).toBeGreaterThan(0);
      expect(value.startsWith('/')).toBe(false);
    }
  });

  it('defines unique registry file names', () => {
    expect(new Set(REGISTRIES).size).toBe(REGISTRIES.length);
  });
});
