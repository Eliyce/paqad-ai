// Issue #117 (C-5) — the single source of truth for paqad's binding live hooks.
// Each hook-capable adapter renders these specs into its native hook config so
// the decision-pause gate and the completion-verification hook are generated
// from one definition rather than copy-pasted per adapter.

import { homedir } from 'node:os';
import { join } from 'node:path';

/** The lifecycle point a live hook binds to, mapped per host to its native
 *  event name (e.g. Claude Code `PreToolUse` / `Stop`). */
export type PaqadHookEvent = 'pre-tool-mutation' | 'completion';

export interface PaqadLiveHookSpec {
  id: string;
  event: PaqadHookEvent;
  /** Basename of the runtime hook file (e.g. `decision-pause-gate.mjs`). The
   *  adapter renders it to a cross-platform command via `hookCommand()`. */
  hookFile: string;
  /** For `pre-tool-mutation` hooks: the mutating-tool matcher (host-specific
   *  alternation). Undefined for completion hooks. */
  mutatingToolMatcher?: string;
  description: string;
}

/** The framework pointer prefix used in docs/diagnostics. Hook *commands* no
 *  longer embed this bare `~` form — Windows shells do not expand `~` — they use
 *  the absolute, interpreter-explicit `hookCommand()` form below (issue #240). */
export const PAQAD_RUNTIME_PREFIX = '~/.paqad-ai/current';

/** The canonical mutating-tool matcher used by paqad's pre-tool gates. */
export const PAQAD_MUTATING_TOOL_MATCHER = 'Edit|Write|NotebookEdit';

/**
 * Absolute, POSIX-style path to the framework install dir (`~/.paqad-ai/current`),
 * resolved at onboard time. Mirrors `src/onboarding/manifest-writer.ts`. A hook
 * command cannot carry a bare `~` (Windows shells do not expand it) or rely on a
 * shebang / executable bit (Windows ignores both), so we bake an absolute path
 * and launch through the `node` interpreter (issue #240).
 */
export function frameworkHomeAbsolute(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.PAQAD_FRAMEWORK_HOME ?? join(homedir(), '.paqad-ai', 'current');
  return home.replace(/\\/g, '/');
}

/**
 * A cross-platform hook command: `node "<abs>/hooks/<file>"`. No `~`, no `.sh`,
 * no reliance on a shebang or the executable bit — it runs identically on Windows
 * (cmd/PowerShell), macOS, and Linux. `node` is always on PATH for a paqad-ai
 * install (it is a Node CLI). The path stays machine-agnostic across re-onboards
 * because it is recomputed from the local home dir each time the host config is
 * generated.
 */
export function hookCommand(hookFile: string, env: NodeJS.ProcessEnv = process.env): string {
  return `node "${frameworkHomeAbsolute(env)}/hooks/${hookFile}"`;
}

/**
 * The record-only completion hook command hosts other than Claude Code bind to
 * (Codex CLI's `Stop`, Gemini CLI's `AfterAgent`, …). It runs the same
 * verification backstop as Claude's `Stop` hook — producing the evidence ledger
 * when enterprise evidence is on — but always exits 0 and stays silent, so a
 * non-Claude host's hook never halts, retries, or misreads it. See
 * `runtime/hooks/verification-record.mjs`.
 */
export function completionRecordCommand(env: NodeJS.ProcessEnv = process.env): string {
  return hookCommand('verification-record.mjs', env);
}

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
    hookFile: 'decision-pause-gate.mjs',
    mutatingToolMatcher: PAQAD_MUTATING_TOOL_MATCHER,
    description: 'Block mutating tools while a decision packet is unresolved (#117 C-3).',
  },
  {
    id: 'verification-completion',
    event: 'completion',
    hookFile: 'verification-completion.mjs',
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
