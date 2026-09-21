// edit-targets.mjs — the ONE place paqad extracts edited file paths from a host
// tool payload (issue #566). Every PreToolUse hook that needs an edit target
// (agent-entry-gate's sentinel-write exemption, capability-gate's scope check,
// stage-writer's stage classification) reads it through here, so the apply_patch
// parsing lives in one place rather than being hand-copied per hook (RULE-13).
//
// Two shapes, one function:
//   - Claude Edit/Write/NotebookEdit: `tool_input.file_path` / `tool_input.notebook_path`
//     carries the single edited path.
//   - Codex `apply_patch`: the patch text carries `*** Add File:`, `*** Update File:`,
//     `*** Delete File:` and `*** Move to:` headers, one per touched path. The exact
//     `tool_input` field holding the patch text is host-version-dependent, so we scan
//     every string value of the payload's tool_input (and the tool_input itself when it
//     IS the patch string) — robust to the field name without guessing it.
//
// Pure and dist-free (like transcript.mjs / codex-rollout.mjs) so it works even when
// the compiled build is absent, and it never throws.

/** Every path an `apply_patch` envelope touches, in header order. */
export function parseApplyPatchPaths(text) {
  const paths = [];
  if (typeof text !== 'string') {
    return paths;
  }
  for (const line of text.split(/\r?\n/)) {
    const match = /^\*\*\*\s+(?:Add File|Update File|Delete File|Move to):\s+(.+?)\s*$/.exec(line);
    if (match && match[1]) {
      paths.push(match[1]);
    }
  }
  return paths;
}

/** The file paths a single mutating tool call edits, across both host shapes. */
export function editTargets(payload) {
  const toolInput = payload?.tool_input;
  if (toolInput && typeof toolInput === 'object' && !Array.isArray(toolInput)) {
    const single = toolInput.file_path ?? toolInput.notebook_path;
    if (typeof single === 'string' && single.trim() !== '') {
      return [single];
    }
    const collected = [];
    for (const value of Object.values(toolInput)) {
      if (typeof value === 'string') {
        collected.push(...parseApplyPatchPaths(value));
      }
    }
    return collected;
  }
  // Some Codex builds deliver the patch text directly as the tool_input string.
  if (typeof toolInput === 'string') {
    return parseApplyPatchPaths(toolInput);
  }
  return [];
}
