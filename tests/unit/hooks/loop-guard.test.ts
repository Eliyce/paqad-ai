import { describe, expect, it } from 'vitest';

import { stopHookActiveFromStdin } from '../../../runtime/hooks/lib/loop-guard.mjs';

// AC-4 — the Stop-hook loop breaker reads Claude's `stop_hook_active` flag. It is
// deliberately conservative: only an explicit `true` counts as "in a loop"; any
// other shape (absent, false, non-JSON, non-boolean) is treated as the FIRST stop
// so the gate keeps its teeth.
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
