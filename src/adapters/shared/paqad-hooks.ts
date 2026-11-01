import { homedir } from 'node:os';
import { join } from 'node:path';

export type PaqadHookEvent =
  | 'session-start'
  | 'prompt-submit'
  | 'pre-tool-mutation'
  | 'completion'
  | 'subagent-start'
  | 'subagent-completion'
  | 'post-tool-read'
  | 'post-tool-agent'
  | 'subagent-stop-any';

export const PAQAD_HOOK_EVENT_ORDER: readonly PaqadHookEvent[] = [
  'pre-tool-mutation',
  'prompt-submit',
  'session-start',
  'completion',
  'subagent-start',
  'subagent-completion',
  'post-tool-read',
  'post-tool-agent',
  'subagent-stop-any',
];

export interface PaqadLiveHookSpec {
  id: string;
  event: PaqadHookEvent;
  hookFile: string;
  capabilitySeam?: 'pre-mutation' | 'completion';
  hostArgv?: boolean;
  failClosed?: boolean;
  timeoutSec?: number;
  description: string;
}

export const PAQAD_RUNTIME_PREFIX = '~/.paqad-ai/current';

export const PLUGIN_RUNTIME_ROOT = '${CLAUDE_PLUGIN_ROOT}/runtime';

export const PLUGIN_SESSION_START_HOOK = 'plugin-session-start.mjs';

const PLUGIN_EXCLUDED_HOOK_FILES: ReadonlySet<string> = new Set(['silent-update.mjs']);

export const PAQAD_MUTATING_TOOL_MATCHER = 'Edit|Write|NotebookEdit';

export const PAQAD_STAGE_AGENT_MATCHER = '^(paqad:)?paqad-';

export const PAQAD_STAGE_HELPER_MATCHER =
  '^(paqad:)?paqad-(planning|specification|development|review|checks|documentation-sync)$';

export const PAQAD_SKILL_READ_MATCHER = 'Skill|Read';

export const PAQAD_AGENT_TOOL_MATCHER = 'Agent|Task';

export const PAQAD_ANY_SUBAGENT_MATCHER = '.*';

export const DEFAULT_HOOK_ADAPTER = 'claude-code';

export interface HostHookEventMap {
  nativeEvent: Readonly<Partial<Record<PaqadHookEvent, string>>>;
  mutatingMatcher: string;
  subagentMatcher: string;
  subagentStartMatcher?: string;
  postReadMatcher?: string;
  postAgentMatcher?: string;
  anySubagentMatcher?: string;
}

export const NATIVE_HOOK_EVENTS: Readonly<Record<string, HostHookEventMap>> = {
  'claude-code': {
    nativeEvent: {
      'session-start': 'SessionStart',
      'prompt-submit': 'UserPromptSubmit',
      'pre-tool-mutation': 'PreToolUse',
      completion: 'Stop',
      'subagent-start': 'SubagentStart',
      'subagent-completion': 'SubagentStop',
      'post-tool-read': 'PostToolUse',
      'post-tool-agent': 'PostToolUse',
      'subagent-stop-any': 'SubagentStop',
    },
    mutatingMatcher: PAQAD_MUTATING_TOOL_MATCHER,
    subagentMatcher: PAQAD_STAGE_AGENT_MATCHER,
    subagentStartMatcher: PAQAD_STAGE_HELPER_MATCHER,
    postReadMatcher: PAQAD_SKILL_READ_MATCHER,
    postAgentMatcher: PAQAD_AGENT_TOOL_MATCHER,
    anySubagentMatcher: PAQAD_ANY_SUBAGENT_MATCHER,
  },
  'codex-cli': {
    nativeEvent: {
      'session-start': 'SessionStart',
      'prompt-submit': 'UserPromptSubmit',
      'pre-tool-mutation': 'PreToolUse',
      completion: 'Stop',
      'subagent-completion': 'SubagentStop',
    },
    mutatingMatcher: '^apply_patch$',
    subagentMatcher: PAQAD_STAGE_AGENT_MATCHER,
  },
};

export function rendersFullHookChain(adapterType: string): boolean {
  return adapterType in NATIVE_HOOK_EVENTS;
}

export function frameworkHomeAbsolute(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.PAQAD_FRAMEWORK_HOME ?? join(homedir(), '.paqad-ai', 'current');
  return home.replace(/\\/g, '/');
}

export function hookCommand(
  hookFile: string,
  env: NodeJS.ProcessEnv = process.env,
  root?: string,
): string {
  return `node "${root ?? frameworkHomeAbsolute(env)}/hooks/${hookFile}"`;
}

export function capabilityGateCommand(
  seam: 'pre-mutation' | 'completion',
  adapterType?: string,
  env: NodeJS.ProcessEnv = process.env,
  root?: string,
): string {
  const base = `${hookCommand('capability-gate.mjs', env, root)} ${seam}`;
  return adapterType && adapterType !== DEFAULT_HOOK_ADAPTER ? `${base} ${adapterType}` : base;
}

export function completionRecordCommand(
  adapterType?: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const base = hookCommand('verification-record.mjs', env);
  return adapterType ? `${base} ${adapterType}` : base;
}

export const PAQAD_LIVE_HOOKS: readonly PaqadLiveHookSpec[] = [
  {
    id: 'agent-entry-gate',
    event: 'pre-tool-mutation',
    hookFile: 'agent-entry-gate.mjs',
    failClosed: true,
    timeoutSec: 10,
    description: 'Block a mutating edit until the framework entry file is loaded (Part 0).',
  },
  {
    id: 'stage-writer',
    event: 'pre-tool-mutation',
    hookFile: 'stage-writer.mjs',
    hostArgv: true,
    description: 'Script-mint per-stage live-mark rows on every mutating edit (RCA fix A).',
  },
  {
    id: 'decision-pause-gate',
    event: 'pre-tool-mutation',
    hookFile: 'decision-pause-gate.mjs',
    failClosed: true,
    timeoutSec: 10,
    description: 'Block mutating tools while a decision packet is unresolved.',
  },
  {
    id: 'capability-gate-pre-mutation',
    event: 'pre-tool-mutation',
    hookFile: 'capability-gate.mjs',
    capabilitySeam: 'pre-mutation',
    hostArgv: true,
    failClosed: true,
    timeoutSec: 10,
    description: 'Run the capability kernel (rules-loaded, stages) before a mutating edit (F3).',
  },
  {
    id: 'agent-entry-prompt-gate',
    event: 'prompt-submit',
    hookFile: 'agent-entry-prompt-gate.mjs',
    hostArgv: true,
    description: 'Inject the load directive / context block and route the prompt (Part 0).',
  },
  {
    id: 'ticket-intake-prompt',
    event: 'prompt-submit',
    hookFile: 'ticket-intake-prompt.mjs',
    hostArgv: true,
    description: 'Arm deterministic ticket intake when a prompt names a tracker ref.',
  },
  {
    id: 'agent-entry-session-start',
    event: 'session-start',
    hookFile: 'agent-entry-session-start.mjs',
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
    description: 'Record the agent’s paqad:stage markers from the transcript on completion.',
  },
  {
    id: 'verification-completion',
    event: 'completion',
    hookFile: 'verification-completion.mjs',
    hostArgv: true,
    description: 'Run the verification backstop and surface the trust verdict on completion.',
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
    id: 'stage-agent-start',
    event: 'subagent-start',
    hookFile: 'stage-agent-start.mjs',
    timeoutSec: 10,
    description: 'Seed a stage agent with its stage brief on SubagentStart.',
  },
  {
    id: 'stage-agent-completion',
    event: 'subagent-completion',
    hookFile: 'stage-agent-completion.mjs',
    hostArgv: true,
    description: 'Record a stage agent’s stage-agent row on SubagentStop.',
  },
  {
    id: 'skill-activation',
    event: 'post-tool-read',
    hookFile: 'skill-activation.mjs',
    description:
      'Log a skill firing (the Skill tool, or a Read of a SKILL.md) to the activation ledger.',
  },
  {
    id: 'agent-delegation-call',
    event: 'post-tool-agent',
    hookFile: 'agent-delegation.mjs',
    description: 'Log an agent delegation (an Agent or Task call) to the delegation ledger.',
  },
  {
    id: 'agent-delegation-stop',
    event: 'subagent-stop-any',
    hookFile: 'agent-delegation.mjs',
    description: 'Log a subagent stop to the delegation ledger.',
  },
];

export interface RenderedHook {
  nativeEvent: string;
  matcher?: string;
  command: string;
  onFailure?: 'block';
  timeout?: number;
}

export function renderHookCommand(
  spec: PaqadLiveHookSpec,
  adapterType: string,
  env: NodeJS.ProcessEnv = process.env,
  root?: string,
): string {
  const argv = spec.hostArgv && adapterType !== DEFAULT_HOOK_ADAPTER ? adapterType : undefined;
  if (spec.capabilitySeam) {
    return capabilityGateCommand(spec.capabilitySeam, argv, env, root);
  }
  const base = hookCommand(spec.hookFile, env, root);
  return argv ? `${base} ${argv}` : base;
}

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
    const nativeEvent = host.nativeEvent[event];
    if (nativeEvent === undefined) {
      continue;
    }
    for (const spec of PAQAD_LIVE_HOOKS) {
      if (spec.event !== event) {
        continue;
      }
      const failClosed = spec.failClosed === true && adapterType === DEFAULT_HOOK_ADAPTER;
      const timed = failClosed || spec.failClosed !== true;
      chain.push({
        nativeEvent,
        matcher: matcherForEvent(event, host),
        command: renderHookCommand(spec, adapterType, env),
        ...(failClosed ? { onFailure: 'block' as const } : {}),
        ...(timed && spec.timeoutSec !== undefined ? { timeout: spec.timeoutSec } : {}),
      });
    }
  }
  return chain;
}

function matcherForEvent(event: PaqadHookEvent, host: HostHookEventMap): string | undefined {
  if (event === 'pre-tool-mutation') {
    return host.mutatingMatcher;
  }
  if (event === 'subagent-completion') {
    return host.subagentMatcher;
  }
  if (event === 'subagent-start') {
    return host.subagentStartMatcher;
  }
  if (event === 'post-tool-read') {
    return host.postReadMatcher;
  }
  if (event === 'post-tool-agent') {
    return host.postAgentMatcher;
  }
  if (event === 'subagent-stop-any') {
    return host.anySubagentMatcher;
  }
  return undefined;
}

export function buildPluginHookChain(env: NodeJS.ProcessEnv = process.env): RenderedHook[] {
  const host = NATIVE_HOOK_EVENTS[DEFAULT_HOOK_ADAPTER];
  const chain: RenderedHook[] = [];
  for (const event of PAQAD_HOOK_EVENT_ORDER) {
    const nativeEvent = host.nativeEvent[event];
    /* v8 ignore start -- the claude-code map names every event the plugin chain renders */
    if (nativeEvent === undefined) {
      continue;
    }
    /* v8 ignore stop */
    if (event === 'session-start') {
      chain.push({
        nativeEvent,
        command: hookCommand(PLUGIN_SESSION_START_HOOK, env, PLUGIN_RUNTIME_ROOT),
      });
    }
    for (const spec of PAQAD_LIVE_HOOKS) {
      if (spec.event !== event || PLUGIN_EXCLUDED_HOOK_FILES.has(spec.hookFile)) {
        continue;
      }
      chain.push({
        nativeEvent,
        matcher: matcherForEvent(event, host),
        command: renderHookCommand(spec, DEFAULT_HOOK_ADAPTER, env, PLUGIN_RUNTIME_ROOT),
        ...(spec.failClosed !== true && spec.timeoutSec !== undefined
          ? { timeout: spec.timeoutSec }
          : {}),
      });
    }
  }
  return chain;
}

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

export function isLiveHookCapable(adapterType: string): boolean {
  const coverage = HOOK_COVERAGE_MATRIX[adapterType];
  return coverage === 'live-pre-and-completion' || coverage === 'live-completion-only';
}

export function hasPreMutationBlock(adapterType: string): boolean {
  return HOOK_COVERAGE_MATRIX[adapterType] === 'live-pre-and-completion';
}
