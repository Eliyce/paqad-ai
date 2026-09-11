import { describe, expect, it } from 'vitest';

import { pad2, slugifyCaption } from '@/visual-evidence/runner.js';

// runner.ts is coverage-excluded (real browser work), but its pure naming helpers are
// deterministic and Windows-safety-critical, so lock their behaviour here.
describe('slugifyCaption', () => {
  it('produces Windows-safe kebab-case with no colon', () => {
    expect(slugifyCaption('Open the cart: savings goal')).toBe('open-the-cart-savings-goal');
    expect(slugifyCaption('Pay')).toBe('pay');
  });

  it('collapses non-alphanumerics and trims dashes', () => {
    expect(slugifyCaption('  --Confirm!!  ')).toBe('confirm');
  });

  it('caps length at 40', () => {
    const long = slugifyCaption('a'.repeat(80));
    expect(long.length).toBe(40);
  });

  it('falls back to "step" for an empty/symbol-only caption', () => {
    expect(slugifyCaption('')).toBe('step');
    expect(slugifyCaption('!!!')).toBe('step');
  });
});

describe('pad2', () => {
  it('zero-pads to two digits and clamps at 99', () => {
    expect(pad2(1)).toBe('01');
    expect(pad2(12)).toBe('12');
    expect(pad2(150)).toBe('99');
  });
});
