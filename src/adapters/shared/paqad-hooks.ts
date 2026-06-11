// Issue #117 (C-5) — the single source of truth for paqad's binding live hooks.
// Each hook-capable adapter renders these specs into its native hook config so
// the decision-pause gate and the completion-verification hook are generated
// from one definition rather than copy-pasted per adapter.

/** The lifecycle point a live hook binds to, mapped per host to its native
 *  event name (e.g. Claude Code `PreToolUse` / `Stop`). */
export type PaqadHookEvent = 'pre-tool-mutation' | 'completion';

export interface PaqadLiveHookSpec {
  id: string;
  event: PaqadHookEvent;
  /** Runtime script path, resolved via the framework pointer
   *  (`~/.paqad-ai/current` → the installed package's runtime dir). */
  script: string;
  /** For `pre-tool-mutation` hooks: the mutating-tool matcher (host-specific
   *  alternation). Undefined for completion hooks. */
  mutatingToolMatcher?: string;
  description: string;
}

/** Resolves to the installed package's runtime dir via the framework pointer. */
export const PAQAD_RUNTIME_PREFIX = '~/.paqad-ai/current';

/** The canonical mutating-tool matcher used by paqad's pre-tool gates. */
export const PAQAD_MUTATING_TOOL_MATCHER = 'Edit|Write|NotebookEdit';

/**
 * The live hooks paqad generates for every hook-capable adapter (issue #117).
 * The decision-pause gate (C-3) blocks mutating tools while a packet is
 * unresolved; the completion hook (C-1/C-6) runs the verification backstop and
 * surfaces the trust verdict when the agent finishes.
 */
export const PAQAD_LIVE_HOOKS: readonly PaqadLiveHookSpec[] = [
  {
    id: 'decision-pause-gate',
    event: 'pre-tool-mutation',
    script: `${PAQAD_RUNTIME_PREFIX}/hooks/decision-pause-gate.sh`,
    mutatingToolMatcher: PAQAD_MUTATING_TOOL_MATCHER,
    description: 'Block mutating tools while a decision packet is unresolved (#117 C-3).',
  },
  {
    id: 'verification-completion',
    event: 'completion',
    script: `${PAQAD_RUNTIME_PREFIX}/hooks/verification-completion.mjs`,
    description:
      'Run the verification backstop and surface the trust verdict on completion (#117 C-1/C-6).',
  },
];

/**
 * How each adapter is covered (issue #117 C-5). `live+backstop` adapters get the
 * live in-session hooks above *and* the git/CI backstop; `backstop-only`
 * adapters are instruction-only or have an unreliable gate, so they are covered
 * solely by the provider-independent git/CI backstop (verify-backstop.mjs).
 */
export type AdapterHookCoverage = 'live+backstop' | 'backstop-only';

export const HOOK_COVERAGE_MATRIX: Readonly<Record<string, AdapterHookCoverage>> = {
  'claude-code': 'live+backstop',
  'codex-cli': 'live+backstop',
  'gemini-cli': 'live+backstop',
  cursor: 'live+backstop',
  windsurf: 'live+backstop',
  aider: 'backstop-only',
  antigravity: 'backstop-only',
};

/** True iff the host exposes native pre-tool/stop hooks paqad can bind to. */
export function isLiveHookCapable(adapterType: string): boolean {
  return HOOK_COVERAGE_MATRIX[adapterType] === 'live+backstop';
}
