// Issue #220 — the graceful-degradation clause rendered into every host entry
// file (CLAUDE.md, AGENTS.md, GEMINI.md, .cursor/rules, …).
//
// Hook-less IDEs (JetBrains Junie / PhpStorm, Copilot, Aider, …) have no hook
// layer, so the ONLY seam that can stop them dead-ending on their own onboarding
// contract — "open .paqad/framework-path.txt, resolve it, load the framework" —
// when the package is absent/disabled is the entry-file contract itself. Without
// this clause, an uninstalled or disabled paqad reads to those IDEs as "this
// tool broke my editor" instead of "paqad is simply off".
//
// It is generated ONCE here (core-owned, byte-identical across every host) and
// injected by `BaseAdapter.generateConfig`, never hand-written into per-provider
// prose — consistent with the "fix cross-provider gaps in core, not in
// hand-edited entry files" principle. It is a degradation clause OF the bootstrap
// contract, not a new feature section, so it is deliberately NOT a `##` heading
// and stays within the closed entry-file heading allow-list
// (see `docs/instructions/rules/coding/agent-entry-files.md`).
const FALLBACK_CLAUSE =
  '**Fallback:** if `.paqad/framework-path.txt` is missing or cannot be resolved, ' +
  'or paqad is disabled, proceed as a normal assistant with no paqad behavior. Do not block.';

/**
 * The adapter-agnostic graceful-degradation clause. Identical across every host
 * (a determinism test asserts this), so an absent/disabled paqad never
 * hard-fails any IDE.
 */
export function buildFrameworkFallbackClause(): string {
  return FALLBACK_CLAUSE;
}
