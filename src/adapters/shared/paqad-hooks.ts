// Issue #117 (C-5) — the single source of truth for paqad's binding live hooks.
// Each hook-capable adapter renders these specs into its native hook config so
// the whole ordered chain (entry gate, stage writer, decision-pause gate,
// capability kernel, prompt gates, session-start, completion) is generated from
// one definition rather than copy-pasted per adapter.
//
// Issue #566 — the chain is now the FULL set both live-pre-and-completion hosts
// render (Claude Code and Codex CLI), grouped by an abstract lifecycle event that
// each host maps to its own native event name and mutating-tool matcher. The same
// hook scripts run on both hosts; the host is passed as one argv (see `hostArgv`),
// never a forked copy.

import { homedir } from 'node:os';
import { join } from 'node:path';

/** The lifecycle point a live hook binds to, mapped per host to its native event
 *  name (e.g. Claude Code / Codex `PreToolUse` and `Stop`). */
export type PaqadHookEvent =
  | 'session-start'
  | 'prompt-submit'
  | 'pre-tool-mutation'
  | 'completion'
  // Issue #567 — fires when a subagent finishes (host `SubagentStop`). Only paqad's stage
  // agents match, via the `^paqad-` agent-type matcher. Stage isolation is core-engine
  // behavior now (no config knob), so this event renders on every full-chain host.
  | 'subagent-completion';

/**
 * The order the events are rendered into a host's hook config. Fixed so a
 * re-onboard is byte-stable and Claude's `.claude/settings.json` keeps the exact
 * key order it had before the shared renderer (PreToolUse, UserPromptSubmit,
 * SessionStart, Stop).
 */
export const PAQAD_HOOK_EVENT_ORDER: readonly PaqadHookEvent[] = [
  'pre-tool-mutation',
  'prompt-submit',
  'session-start',
  'completion',
  // Appended last (issue #567): `SubagentStop` naturally follows `Stop`, so appending keeps
  // the historical `Stop`-then-`SubagentStop` key order every full-chain host renders.
  'subagent-completion',
];

export interface PaqadLiveHookSpec {
  id: string;
  event: PaqadHookEvent;
  /** Basename of the runtime hook file (e.g. `decision-pause-gate.mjs`). The
   *  renderer turns it into a cross-platform command via `hookCommand()`. */
  hookFile: string;
  /** When set, this hook is the capability-kernel seam: rendered via
   *  `capabilityGateCommand()` with this seam as the first argv. */
  capabilitySeam?: 'pre-mutation' | 'completion';
  /**
   * When true the host adapter type is appended to the command as an argv so the
   * one shared script knows which host invoked it (issue #566). The default host,
   * `claude-code`, is NEVER appended — its scripts default to `claude-code`, so
   * omitting it keeps Claude's generated config byte-identical to before this
   * change. Every non-default host (Codex) gets the argv.
   */
  hostArgv?: boolean;
  description: string;
}

/** The framework pointer prefix used in docs/diagnostics. Hook *commands* no
 *  longer embed this bare `~` form — Windows shells do not expand `~` — they use
 *  the absolute, interpreter-explicit `hookCommand()` form below (issue #240). */
export const PAQAD_RUNTIME_PREFIX = '~/.paqad-ai/current';

/** The canonical mutating-tool matcher used by paqad's Claude pre-tool gates. */
export const PAQAD_MUTATING_TOOL_MATCHER = 'Edit|Write|NotebookEdit';

/**
 * The agent-type matcher for the `subagent-completion` hook (issue #567). paqad's stage
 * agents are all named `paqad-<stage>`, so this anchored prefix fires the hook only for
 * them and never for a user's own subagents (or the built-in `general-purpose`/`Explore`/
 * `Plan` agents).
 */
export const PAQAD_STAGE_AGENT_MATCHER = '^paqad-';

/** The default host whose shared scripts run without a host argv (issue #566). */
export const DEFAULT_HOOK_ADAPTER = 'claude-code';

/**
 * A host that renders the full pre-and-completion hook chain. Each maps the
 * abstract lifecycle events to its own native event names and supplies the
 * mutating-tool matcher for its `pre-tool-mutation` seam. Verified against each
 * host's own hook documentation before wiring (RULE-18). Codex's mutating tool is
 * `apply_patch`; its matcher is a regex on `tool_name`, so it is anchored.
 */
export interface HostHookEventMap {
  nativeEvent: Record<PaqadHookEvent, string>;
  /** The `pre-tool-mutation` event's matcher for this host. */
  mutatingMatcher: string;
  /**
   * The `subagent-completion` event's matcher for this host (issue #567). Both hosts match
   * on the subagent's agent type, so `^paqad-` restricts the hook to paqad's own stage
   * agents and never fires for a user's own subagents (Claude verified: `SubagentStop`
   * matches the same agent-type values as `SubagentStart`; Codex matches on `agent_type`).
   */
  subagentMatcher: string;
}

export const NATIVE_HOOK_EVENTS: Readonly<Record<string, HostHookEventMap>> = {
  'claude-code': {
    nativeEvent: {
      'session-start': 'SessionStart',
      'prompt-submit': 'UserPromptSubmit',
      'pre-tool-mutation': 'PreToolUse',
      completion: 'Stop',
      'subagent-completion': 'SubagentStop',
    },
    mutatingMatcher: PAQAD_MUTATING_TOOL_MATCHER,
    subagentMatcher: PAQAD_STAGE_AGENT_MATCHER,
  },
  'codex-cli': {
    nativeEvent: {
      'session-start': 'SessionStart',
      'prompt-submit': 'UserPromptSubmit',
      'pre-tool-mutation': 'PreToolUse',
      completion: 'Stop',
      'subagent-completion': 'SubagentStop',
    },
    // Codex's mutating tool is `apply_patch`; the matcher is a `tool_name` regex.
    mutatingMatcher: '^apply_patch$',
    subagentMatcher: PAQAD_STAGE_AGENT_MATCHER,
  },
};

/** True iff the host renders the full `PAQAD_LIVE_HOOKS` chain (Claude or Codex). */
export function rendersFullHookChain(adapterType: string): boolean {
  return adapterType in NATIVE_HOOK_EVENTS;
}

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
 * a Stop/AfterAgent gate). `adapterType` (issue #566) is appended after the seam
 * for a non-default host so the gate attributes its recorded rows to the host that
 * ran; the default `claude-code` is omitted so Claude's command is unchanged.
 */
export function capabilityGateCommand(
  seam: 'pre-mutation' | 'completion',
  adapterType?: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const base = `${hookCommand('capability-gate.mjs', env)} ${seam}`;
  return adapterType && adapterType !== DEFAULT_HOOK_ADAPTER ? `${base} ${adapterType}` : base;
}

/**
 * The record-only completion hook command Gemini CLI binds to (its `AfterAgent`).
 * It runs the same verification backstop as Claude's `Stop` hook — producing the
 * evidence ledger when enterprise evidence is on — but always exits 0 and stays
 * silent, so a non-Claude host's hook never halts, retries, or misreads it. See
 * `runtime/hooks/verification-record.mjs`.
 *
 * `adapterType` (issue #265) is passed to the hook as an argv so the per-stage
 * marker rows it records at completion are attributed to the host that actually
 * ran (`gemini-cli`), not a hard-coded `claude-code`. Omitted → the bare record
 * command (the hook then defaults attribution to `claude-code`).
 *
 * Codex no longer uses this hook — it renders the full blocking completion chain
 * (issue #566). It remains for Gemini, whose tier is unchanged.
 */
export function completionRecordCommand(
  adapterType?: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const base = hookCommand('verification-record.mjs', env);
  return adapterType ? `${base} ${adapterType}` : base;
}

/**
 * The live hooks paqad generates for every host that renders the full chain
 * (issue #117, extended by #566). Listed in per-event order; the renderer walks
 * `PAQAD_HOOK_EVENT_ORDER` and, within each event, keeps this order — which is the
 * exact order Claude Code's `.claude/settings.json` carried before the shared
 * renderer, so that output is byte-identical.
 */
export const PAQAD_LIVE_HOOKS: readonly PaqadLiveHookSpec[] = [
  {
    id: 'agent-entry-gate',
    event: 'pre-tool-mutation',
    hookFile: 'agent-entry-gate.mjs',
    // Host-agnostic: the sentinel-write exemption reads the edited path(s) from the
    // payload via the shared extractor, which understands both Claude's `file_path`
    // and Codex's `apply_patch` text, so no host argv is needed.
    description: 'Block a mutating edit until the framework entry file is loaded (Part 0).',
  },
  {
    id: 'stage-writer',
    event: 'pre-tool-mutation',
    hookFile: 'stage-writer.mjs',
    hostArgv: true,
    // A non-blocking WRITER, not a gate. Ordered after the entry gate so a live-mark
    // stage row is minted on every mutating edit (RCA fix A). Host argv so the row is
    // attributed to the host that ran and the Codex `apply_patch` paths are parsed.
    description: 'Script-mint per-stage live-mark rows on every mutating edit (RCA fix A).',
  },
  {
    id: 'decision-pause-gate',
    event: 'pre-tool-mutation',
    hookFile: 'decision-pause-gate.mjs',
    // Reads only the pending-packet dir, no edit target — host-agnostic, no argv.
    description: 'Block mutating tools while a decision packet is unresolved (#117 C-3).',
  },
  {
    id: 'capability-gate-pre-mutation',
    event: 'pre-tool-mutation',
    hookFile: 'capability-gate.mjs',
    capabilitySeam: 'pre-mutation',
    hostArgv: true,
    description: 'Run the capability kernel (rules-loaded, stages) before a mutating edit (F3).',
  },
  {
    id: 'agent-entry-prompt-gate',
    event: 'prompt-submit',
    hookFile: 'agent-entry-prompt-gate.mjs',
    hostArgv: true,
    description: 'Inject the load directive / context block and route the prompt (Part 0, #336).',
  },
  {
    id: 'ticket-intake-prompt',
    event: 'prompt-submit',
    hookFile: 'ticket-intake-prompt.mjs',
    hostArgv: true,
    description: 'Arm deterministic ticket intake when a prompt names a tracker ref (#322).',
  },
  {
    id: 'agent-entry-session-start',
    event: 'session-start',
    hookFile: 'agent-entry-session-start.mjs',
    // Reads only `session_id`, present on both hosts' SessionStart payloads.
    description: 'Reset the entry sentinel and align the ledger session id on a new session.',
  },
  {
    id: 'silent-update',
    event: 'session-start',
    hookFile: 'silent-update.mjs',
    description: 'Background, non-blocking forced self-update on every session start.',
  },
  {
    id: 'stage-marker-parse',
    event: 'completion',
    hookFile: 'stage-marker-parse.mjs',
    hostArgv: true,
    // Ordered before verification-completion so the non-mutation stage markers
    // (planning/specification/review) are in the ledger when the completion backstop
    // folds the change (RCA fix, Step 3). Non-blocking, best-effort.
    description: 'Record the agent’s paqad:stage markers from the transcript on completion.',
  },
  {
    id: 'verification-completion',
    event: 'completion',
    hookFile: 'verification-completion.mjs',
    hostArgv: true,
    description:
      'Run the verification backstop and surface the trust verdict on completion (#117 C-1/C-6).',
  },
  {
    id: 'capability-gate-completion',
    event: 'completion',
    hookFile: 'capability-gate.mjs',
    capabilitySeam: 'completion',
    hostArgv: true,
    description: 'Run the capability kernel at turn end (F3).',
  },
  {
    // Issue #567 — record-only SubagentStop hook. Fires when a paqad stage agent finishes
    // (matched by the `^paqad-` agent-type matcher), parses its transcript for stage markers
    // (belt and braces — the CLI verbs already recorded them), and appends one
    // context-efficiency row. Never blocks (SubagentStop blocking is undocumented on Claude).
    // Stage isolation is core-engine behavior (no config knob), so this always renders; it is a
    // no-op unless a `paqad-<stage>` subagent actually runs, so a project that never dispatches
    // one pays nothing.
    id: 'stage-agent-completion',
    event: 'subagent-completion',
    hookFile: 'stage-agent-completion.mjs',
    hostArgv: true,
    description: 'Record a stage agent’s context-efficiency row on SubagentStop (#567).',
  },
];

/** One rendered hook: the host's native event, an optional matcher, and the command. */
export interface RenderedHook {
  nativeEvent: string;
  matcher?: string;
  command: string;
}

/** Render one spec's command for a host: the capability seam, plus the host argv for
 *  a non-default host (never for `claude-code`, so Claude stays byte-identical). */
export function renderHookCommand(
  spec: PaqadLiveHookSpec,
  adapterType: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const argv = spec.hostArgv && adapterType !== DEFAULT_HOOK_ADAPTER ? adapterType : undefined;
  if (spec.capabilitySeam) {
    return capabilityGateCommand(spec.capabilitySeam, argv, env);
  }
  const base = hookCommand(spec.hookFile, env);
  return argv ? `${base} ${argv}` : base;
}

/**
 * The full ordered hook chain a host renders, resolved to native event names,
 * matchers, and commands. Walks the fixed event order and, within each event,
 * `PAQAD_LIVE_HOOKS` order — so Claude's output is byte-identical to before the
 * shared renderer. Throws for a host that does not render the full chain (a caller
 * bug — Gemini uses the record-only completion helper, not this).
 */
export function buildHostHookChain(
  adapterType: string,
  env: NodeJS.ProcessEnv = process.env,
): RenderedHook[] {
  const host = NATIVE_HOOK_EVENTS[adapterType];
  if (!host) {
    throw new Error(`no native hook event map for adapter "${adapterType}"`);
  }
  const chain: RenderedHook[] = [];
  for (const event of PAQAD_HOOK_EVENT_ORDER) {
    for (const spec of PAQAD_LIVE_HOOKS) {
      if (spec.event !== event) {
        continue;
      }
      chain.push({
        nativeEvent: host.nativeEvent[event],
        matcher: matcherForEvent(event, host),
        command: renderHookCommand(spec, adapterType, env),
      });
    }
  }
  return chain;
}

/** The matcher a given event renders with for a host, or undefined for an unmatched event. */
function matcherForEvent(event: PaqadHookEvent, host: HostHookEventMap): string | undefined {
  if (event === 'pre-tool-mutation') {
    return host.mutatingMatcher;
  }
  if (event === 'subagent-completion') {
    return host.subagentMatcher;
  }
  return undefined;
}

/**
 * How each adapter is ACTUALLY covered, grounded in which adapters wire an
 * executed native host hook. Two adapters now render the full pre-and-completion
 * chain: claude-code and codex-cli (issue #566). gemini-cli records at completion
 * only. Every other adapter ships an entry-file contract with no host seam, so it
 * is `advisory`.
 *
 *   - `live-pre-and-completion`: blocks before a mutating edit AND verifies at turn
 *     end (claude-code, codex-cli — the PreToolUse-capable hosts).
 *   - `live-completion-only`: at turn end records the stage-evidence ledger AND the
 *     agent's `paqad:stage` markers, then verifies — record-only (exit 0, silent),
 *     with NO in-turn pre-mutation block and NO in-chat verdict (gemini-cli).
 *   - `advisory`: no executed host hook; the entry-file contract only.
 */
export type AdapterHookCoverage = 'live-pre-and-completion' | 'live-completion-only' | 'advisory';

export const HOOK_COVERAGE_MATRIX: Readonly<Record<string, AdapterHookCoverage>> = {
  'claude-code': 'live-pre-and-completion',
  'codex-cli': 'live-pre-and-completion',
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

/** True iff the host can BLOCK before a mutating edit (a PreToolUse seam) — claude/codex. */
export function hasPreMutationBlock(adapterType: string): boolean {
  return HOOK_COVERAGE_MATRIX[adapterType] === 'live-pre-and-completion';
}
