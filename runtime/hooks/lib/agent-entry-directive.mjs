export const ENABLEMENT_VERIFIED_LINE =
  '[paqad] Enablement: ON — verified by this gate. The bootstrap enablement step is already done; do not re-check it.';

export function loadSteps(entryFile, sentinelRel = '.paqad/.agent-entry-loaded') {
  return [
    '[paqad]   1. Enablement — ON, already resolved by this gate; do not re-probe it.',
    `[paqad]   2. Read ${entryFile} with your file-read tool (not a shell command)`,
    '[paqad]   3. Resolve .paqad/framework-path.txt and read the framework gate (AGENT-BOOTSTRAP.md in the install) with your file-read tool; its enablement step is already satisfied (step 1)',
    '[paqad]   4. Since paqad is ON, read AGENT-ROUTER.md (same install directory) with your file-read tool and route the message to one paqad workflow, then read docs/instructions/{stack,design-system,workflows}; read the rule contract (.paqad/context/session-context.md, else docs/instructions/rules) ONLY for feature-development',
    `[paqad]   5. Write ${sentinelRel} with timestamp + entry-file path`,
  ];
}

const TRUTHY = new Set(['1', 'true', 'yes', 'on']);
const FALSY = new Set(['0', 'false', 'no', 'off']);

export const SPEC_PIPELINE_DEFAULTS_MIRROR = Object.freeze({
  spec_pipeline_enabled: true,
  spec_pipeline_experts_enabled: true,
  spec_pipeline_adoption: 'strict',
});

function switchOn(raw, fallback) {
  const value = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (TRUTHY.has(value)) return true;
  if (FALSY.has(value)) return false;
  return fallback;
}

export function specPipelineNudge(readKey, projectRoot, env = process.env, route = null) {
  if (route && (route.routed !== 'feature-development' || route.lane === 'fast')) return null;
  const defaults = SPEC_PIPELINE_DEFAULTS_MIRROR;
  const enabled = readKey(projectRoot, 'spec_pipeline_enabled', 'PAQAD_SPEC_PIPELINE_ENABLED', env);
  if (!switchOn(enabled, defaults.spec_pipeline_enabled)) return null;
  const experts = readKey(
    projectRoot,
    'spec_pipeline_experts_enabled',
    'PAQAD_SPEC_PIPELINE_EXPERTS_ENABLED',
    env,
  );
  const expertsOn = switchOn(experts, defaults.spec_pipeline_experts_enabled);
  const adoptionRaw = String(
    readKey(projectRoot, 'spec_pipeline_adoption', 'PAQAD_SPEC_PIPELINE_ADOPTION', env) ?? '',
  )
    .trim()
    .toLowerCase();
  const adoption =
    adoptionRaw === 'warn' || adoptionRaw === 'strict'
      ? adoptionRaw
      : defaults.spec_pipeline_adoption;
  return (
    `[paqad] Spec pipeline: ON (experts: ${expertsOn ? 'ON' : 'OFF'}, adoption: ${adoption}). ` +
    'For a code change, the specification stage runs `paqad-ai spec pipeline start`, not a hand-written spec.'
  );
}
