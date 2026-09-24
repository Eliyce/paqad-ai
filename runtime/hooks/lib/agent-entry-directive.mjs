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
 * @param {string} [sentinelRel] the project-relative sentinel this session is checked against
 *   (issue #582: `.paqad/.agent-entry-loaded.d/<session id>` when the host passed one); both
 *   gates pass the same value for the same payload, so their step text still matches
 * @returns {string[]} one `[paqad]` line per step, in order
 */
export function loadSteps(entryFile, sentinelRel = '.paqad/.agent-entry-loaded') {
  return [
    '[paqad]   1. Enablement — ON, already resolved by this gate; do not re-probe it.',
    // Issue #576 (Finding 11) — steer the agent to its FILE-READ tool for every file below, not a
    // shell one-liner. `cat AGENT-BOOTSTRAP.md; echo ======; cat AGENT-ROUTER.md` fails in zsh
    // because a word starting with `=` is looked up as a command (`===== not found`, exit 1),
    // which surfaced as a scary "Failed to load paqad bootstrap and router" at every session start.
    `[paqad]   2. Read ${entryFile} with your file-read tool (not a shell command)`,
    '[paqad]   3. Resolve .paqad/framework-path.txt and read the framework gate (AGENT-BOOTSTRAP.md in the install) with your file-read tool; its enablement step is already satisfied (step 1)',
    '[paqad]   4. Since paqad is ON, read AGENT-ROUTER.md (same install directory) with your file-read tool and route the message to one paqad workflow, then read docs/instructions/{stack,design-system,workflows}; read the rule contract (.paqad/context/session-context.md, else docs/instructions/rules) ONLY for feature-development',
    `[paqad]   5. Write ${sentinelRel} with timestamp + entry-file path`,
  ];
}

const TRUTHY = new Set(['1', 'true', 'yes', 'on']);

/**
 * The spec-pipeline nudge (issue #547, FR-1.4). When paqad is ON and `spec_pipeline_enabled` is
 * on, one belt-and-braces line telling the agent the specification stage runs the pipeline, not a
 * hand-written spec. Returns null when the pipeline is off, so a flag-off project's prompt-gate
 * output is byte-identical to before (INV-1). The cross-host path is the router (FR-1.3); this is
 * the Claude Code convenience.
 *
 * @param {(projectRoot: string, key: string, envName: string, env?: NodeJS.ProcessEnv) => string | undefined} readKey
 * @param {string} projectRoot
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string | null}
 */
export function specPipelineNudge(readKey, projectRoot, env = process.env) {
  const enabled = readKey(projectRoot, 'spec_pipeline_enabled', 'PAQAD_SPEC_PIPELINE_ENABLED', env);
  if (!enabled || !TRUTHY.has(String(enabled).trim().toLowerCase())) return null;
  const experts = readKey(
    projectRoot,
    'spec_pipeline_experts_enabled',
    'PAQAD_SPEC_PIPELINE_EXPERTS_ENABLED',
    env,
  );
  const expertsOn = Boolean(experts) && TRUTHY.has(String(experts).trim().toLowerCase());
  const adoptionRaw = readKey(
    projectRoot,
    'spec_pipeline_adoption',
    'PAQAD_SPEC_PIPELINE_ADOPTION',
    env,
  );
  const adoption = String(adoptionRaw ?? 'warn').trim() === 'strict' ? 'strict' : 'warn';
  return (
    `[paqad] Spec pipeline: ON (experts: ${expertsOn ? 'ON' : 'OFF'}, adoption: ${adoption}). ` +
    'For a code change, the specification stage runs `paqad-ai spec pipeline start`, not a hand-written spec.'
  );
}
