// agent-entry-directive.mjs — the shared load directive both entry hooks inject
// (the UserPromptSubmit prompt-gate and the PreToolUse gate). Issue #498, Part A.
//
// The two hooks used to hand-copy the same numbered "how to load the framework"
// step list. That copy drifted (RC1): it omitted the enablement step entirely and
// named a stale nine-workflow count when the router lists eleven. The step prose now
// lives here, in exactly ONE dist-less module, so the two cannot diverge again. It sits
// under runtime/hooks/lib/ beside the other shared hook helpers (agent-entry-
// sentinel.mjs, paqad-disabled.mjs); the .mjs hooks cannot import the TypeScript
// onboarding writers, so the shared source has to be a runtime .mjs.
//
// Both hooks resolve enablement FIRST and short-circuit to a pure no-op when paqad
// is OFF (issue #220). So if either directive is ever emitted, paqad is ON — the
// gate has already proven it. The directive states that verdict up front (so the
// agent spends zero tool calls re-checking it) and marks enablement a done step.

/**
 * The enablement verdict line. Emitted only on the enabled path — both entry hooks
 * bail out silently when paqad is OFF — so it states ON as a proven fact, not a
 * guess. Both hooks open their directive with it, so the two stay in sync.
 */
export const ENABLEMENT_VERIFIED_LINE =
  '[paqad] Enablement: ON — verified by this gate. The bootstrap enablement step is already done; do not re-check it.';

/**
 * The ordered load steps for the two-file entry chain (issue #498, Part B): read the
 * provider entry stub, load the framework GATE (AGENT-BOOTSTRAP.md), then — since
 * paqad is ON — load the ROUTER (AGENT-ROUTER.md) and route + load the always-load
 * contract, and finally write the sentinel. Enablement is step 1, already resolved
 * by the gate. There is no hardcoded workflow count here (it used to live in this
 * prose and drifted); the router names the workflows.
 *
 * @param {string} entryFile the provider entry file (CLAUDE.md, AGENTS.md, …)
 * @returns {string[]} one `[paqad]` line per step, in order
 */
export function loadSteps(entryFile) {
  return [
    '[paqad]   1. Enablement — ON, already resolved by this gate; do not re-probe it.',
    `[paqad]   2. Read ${entryFile}`,
    '[paqad]   3. Resolve .paqad/framework-path.txt and load the framework gate (AGENT-BOOTSTRAP.md in the install); its enablement step is already satisfied (step 1)',
    '[paqad]   4. Since paqad is ON, load AGENT-ROUTER.md (same install directory) and route the message to one paqad workflow, then load docs/instructions/{stack,design-system,workflows}; load the rule contract (.paqad/context/session-context.md, else docs/instructions/rules) ONLY for feature-development',
    '[paqad]   5. Write .paqad/.agent-entry-loaded with timestamp + entry-file path',
  ];
}
