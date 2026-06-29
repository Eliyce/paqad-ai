import { describe, expect, it } from 'vitest';

import { resolveFlooredMode } from '@/core/floored-mode';

const ORDER = ['off', 'warn', 'strict'] as const;
const DEF = 'strict';

const resolve = (layers: { team?: string; local?: string; env?: string }) =>
  resolveFlooredMode(layers, ORDER, DEF);

describe('resolveFlooredMode (C2 clamp, decision D1)', () => {
  it('with nothing set, applies the default (which is the floor)', () => {
    expect(resolve({})).toBe('strict');
  });

  it('the team value sets the floor and CAN lower below the default', () => {
    expect(resolve({ team: 'warn' })).toBe('warn');
    expect(resolve({ team: 'off' })).toBe('off');
  });

  it('local may RAISE strictness above the team floor', () => {
    expect(resolve({ team: 'warn', local: 'strict' })).toBe('strict');
    expect(resolve({ team: 'off', local: 'warn' })).toBe('warn');
  });

  it('local may NOT lower below the team floor (the C2 fix)', () => {
    expect(resolve({ team: 'warn', local: 'off' })).toBe('warn');
    expect(resolve({ team: 'strict', local: 'off' })).toBe('strict');
  });

  it('a lone developer cannot drop below the default with no team floor', () => {
    expect(resolve({ local: 'off' })).toBe('strict');
    expect(resolve({ env: 'off' })).toBe('strict');
  });

  it('env may RAISE but not lower, same as local', () => {
    expect(resolve({ team: 'warn', env: 'strict' })).toBe('strict');
    expect(resolve({ team: 'strict', env: 'off' })).toBe('strict');
  });

  it('takes the strictest across all raising layers', () => {
    expect(resolve({ team: 'off', local: 'warn', env: 'strict' })).toBe('strict');
    expect(resolve({ team: 'off', local: 'strict', env: 'warn' })).toBe('strict');
  });

  it('ignores unrecognised values (a typo never silently disables)', () => {
    expect(resolve({ team: 'banana' })).toBe('strict'); // falls back to default floor
    expect(resolve({ team: 'strict', local: 'nonsense' })).toBe('strict');
  });

  it('is case-insensitive', () => {
    expect(resolve({ team: 'OFF' })).toBe('off');
    expect(resolve({ team: 'warn', local: 'STRICT' })).toBe('strict');
  });
});
