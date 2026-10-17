// gate-failure.mjs — the one place the fail-closed edit gates phrase an unexpected failure
// (issue #615, Part 6). A Claude Code edit gate now fails CLOSED: on an unexpected exception it
// writes this verbatim line to stderr and exits 2 (which blocks the edit), instead of swallowing
// the error and letting the edit through. `onFailure: "block"` in the rendered config covers the
// cases a script never sees (node missing, the file moved, a timeout). The message names the one
// remedy a developer can act on without reading the stack.

/**
 * The verbatim stderr line a fail-closed gate prints before exiting 2 (issue #615, Part 6).
 * @param {string} gateName a short name for the gate (e.g. "agent-entry", "decision-pause", "capability").
 * @param {unknown} error the caught error.
 * @returns {string}
 */
export function gateFailureMessage(gateName, error) {
  const detail = error instanceof Error ? error.message : String(error);
  return (
    `paqad could not run its ${gateName} check (${detail}). ` +
    'Run "npx paqad-ai doctor" to repair the install, or set PAQAD_DISABLED=1 to turn paqad off.'
  );
}
