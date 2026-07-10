// loop-guard.mjs — the Stop-hook loop breaker (fix #2).
//
// A blocking Stop hook (exit 2) makes the host re-prompt the model and run the
// hook again. When the block is on a condition the model cannot resolve in-session
// (a missing canonical doc, an unrecordable stage), that re-prompt loops forever.
//
// The host tells us when we are already inside such a continuation: Claude sets
// `stop_hook_active: true` on the Stop payload once a prior Stop hook forced the
// turn. Every blocking Stop hook reads this and, when set, degrades from a hard
// block to an advisory — the gate still bites ONCE (surfacing the problem and
// giving the model a turn to fix it), then steps aside so the session can end.
// The non-bypassable teeth remain at the git/CI backstop, exactly as the hook
// header comments already promise.
//
// Dependency-free and side-effect-free (importing runs nothing) so it is trivially
// unit-testable and safe to load on every Stop.

/**
 * Best-effort `stop_hook_active` from the host Stop-hook stdin payload. True only
 * when the host explicitly marks this Stop as a continuation of a prior Stop-hook
 * block. Absent / non-JSON / malformed ⇒ false (treat as the first stop, so the
 * gate keeps its teeth).
 */
export function stopHookActiveFromStdin(stdin) {
  try {
    const parsed = JSON.parse(stdin);
    return parsed?.stop_hook_active === true;
  } catch {
    // Not JSON / no field — treat as the first stop.
    return false;
  }
}
