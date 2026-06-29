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
 * How each adapter is ACTUALLY covered, grounded in which adapters wire an
 * executed native host hook (buildout F7b — the honesty fix for the decision-B
 * tiered guarantee). Only three adapters override `generateConfig` to emit an
 * executed hook: claude-code (PreToolUse + Stop), codex-cli and gemini-cli
 * (Stop only). Every other adapter ships an entry-file contract the model is
 * asked to follow, with no host seam to bind it — so it is `advisory`.
 *
 * The previous matrix mislabelled cursor/windsurf as live and omitted
 * continue/copilot/junie entirely, implying a binding those hosts never receive.
 * There is no git/CI backstop in this taxonomy (it is not installed, and is out
 * of scope per the no-git/no-CI mandate); the enforcement seam is the host hook
 * alone, tiered honestly:
 *   - `live-pre-and-completion`: blocks before a mutating edit AND verifies at
 *     turn end (claude-code only — the only PreToolUse-capable host).
 *   - `live-completion-only`: verifies at turn end; no in-turn pre-mutation block
 *     (codex-cli, gemini-cli).
 *   - `advisory`: no executed host hook; the entry-file contract only (the 7
 *     remaining adapters). Stated plainly, never implied to bind.
 */
export type AdapterHookCoverage = 'live-pre-and-completion' | 'live-completion-only' | 'advisory';

export const HOOK_COVERAGE_MATRIX: Readonly<Record<string, AdapterHookCoverage>> = {
  'claude-code': 'live-pre-and-completion',
  'codex-cli': 'live-completion-only',
  'gemini-cli': 'live-completion-only',
  cursor: 'advisory',
  windsurf: 'advisory',
  continue: 'advisory',
  'github-copilot': 'advisory',
  junie: 'advisory',
  aider: 'advisory',
  antigravity: 'advisory',
};

/** True iff the host exposes a native hook paqad actually wires (claude/codex/gemini). */
export function isLiveHookCapable(adapterType: string): boolean {
  const coverage = HOOK_COVERAGE_MATRIX[adapterType];
  return coverage === 'live-pre-and-completion' || coverage === 'live-completion-only';
}

/** True iff the host can BLOCK before a mutating edit (a PreToolUse seam) — Claude only. */
export function hasPreMutationBlock(adapterType: string): boolean {
  return HOOK_COVERAGE_MATRIX[adapterType] === 'live-pre-and-completion';
}
