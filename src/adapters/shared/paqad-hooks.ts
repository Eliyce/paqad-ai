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
 * The Capability Kernel host-seam command (buildout F3). `capability-gate.mjs`
 * runs every kernel-bound capability registered at a seam; the seam is passed as
 * the first argv (`pre-mutation` for a PreToolUse mutation gate, `completion` for
 * a Stop/AfterAgent gate). Replaces the single-purpose rule-script-enforce.mjs.
 */
export function capabilityGateCommand(
  seam: 'pre-mutation' | 'completion',
  env: NodeJS.ProcessEnv = process.env,
): string {
  return `${hookCommand('capability-gate.mjs', env)} ${seam}`;
}

/**
 * The record-only completion hook command hosts other than Claude Code bind to
 * (Codex CLI's `Stop`, Gemini CLI's `AfterAgent`, …). It runs the same
 * verification backstop as Claude's `Stop` hook — producing the evidence ledger
 * when enterprise evidence is on — but always exits 0 and stays silent, so a
 * non-Claude host's hook never halts, retries, or misreads it. See
 * `runtime/hooks/verification-record.mjs`.
 *
 * `adapterType` (issue #265) is passed to the hook as an argv so the per-stage
 * marker rows it records at completion are attributed to the host that actually
 * ran (`codex-cli` / `gemini-cli`), not a hard-coded `claude-code`. Omitted → the
 * bare record command (the hook then defaults attribution to `claude-code`).
 */
export function completionRecordCommand(
  adapterType?: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const base = hookCommand('verification-record.mjs', env);
  return adapterType ? `${base} ${adapterType}` : base;
}

/**
 * The live hooks paqad generates for every hook-capable adapter (issue #117).
 * The decision-pause gate (C-3) blocks mutating tools while a packet is
 * unresolved; the completion hook (C-1/C-6) runs the verification backstop and
 * surfaces the trust verdict when the agent finishes.
 */
export const PAQAD_LIVE_HOOKS: readonly PaqadLiveHookSpec[] = [
  {
    id: 'stage-writer',
    event: 'pre-tool-mutation',
    hookFile: 'stage-writer.mjs',
    mutatingToolMatcher: PAQAD_MUTATING_TOOL_MATCHER,
    // A non-blocking WRITER, not a gate. Ordered first so a live-mark stage row
    // exists on disk before the decision-pause / capability gates read the change
    // (RCA fix A — gives the stage-evidence recorder its production caller).
    description: 'Script-mint per-stage live-mark rows on every mutating edit (RCA fix A).',
  },
  {
    id: 'decision-pause-gate',
    event: 'pre-tool-mutation',
    hookFile: 'decision-pause-gate.mjs',
    mutatingToolMatcher: PAQAD_MUTATING_TOOL_MATCHER,
    description: 'Block mutating tools while a decision packet is unresolved (#117 C-3).',
  },
  {
    id: 'stage-marker-parse',
    event: 'completion',
    hookFile: 'stage-marker-parse.mjs',
    // Ordered before verification-completion so the non-mutation stage markers
    // (planning/specification/review) are in the ledger when the completion
    // backstop folds the change (RCA fix, Step 3). Non-blocking, best-effort.
    description: 'Record the agent’s paqad:stage markers from the transcript on completion.',
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
 *   - `live-completion-only`: at turn end records the stage-evidence ledger AND the
 *     agent's `paqad:stage` markers, then verifies — but record-only (exit 0,
 *     silent), with NO in-turn pre-mutation block and NO in-chat verdict
 *     (codex-cli, gemini-cli; issue #265).
 *   - `advisory`: no executed host hook; the entry-file contract only (the 8
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
  aiassistant: 'advisory',
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
