import { describe, expect, it } from 'vitest';

import { stopHookActiveFromStdin } from '../../../runtime/hooks/lib/loop-guard.mjs';

describe('runtime/hooks/lib/loop-guard.mjs — stopHookActiveFromStdin', () => {
  it('returns true only when stop_hook_active === true', () => {
    expect(stopHookActiveFromStdin(JSON.stringify({ stop_hook_active: true }))).toBe(true);
  });

  it('returns false when stop_hook_active is false', () => {
    expect(stopHookActiveFromStdin(JSON.stringify({ stop_hook_active: false }))).toBe(false);
  });

  it('returns false when the field is absent', () => {
    expect(stopHookActiveFromStdin(JSON.stringify({ session_id: 'x' }))).toBe(false);
  });

  it('returns false for a non-boolean truthy value (no coercion)', () => {
    expect(stopHookActiveFromStdin(JSON.stringify({ stop_hook_active: 'yes' }))).toBe(false);
  });

  it('returns false for non-JSON / empty input', () => {
    expect(stopHookActiveFromStdin('not json')).toBe(false);
    expect(stopHookActiveFromStdin('')).toBe(false);
  });
});
