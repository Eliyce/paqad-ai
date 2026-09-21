// Home-scope stage-agent writer (issue #567).
//
// `paqad-ai install` and `paqad-ai update` write the six mandatory stage agents at USER
// scope — `~/.claude/agents/paqad-<stage>.md` (Claude) and `~/.codex/agents/paqad-<stage>.toml`
// (Codex) — rendered from one Handlebars template per host in
// `runtime/templates/stage-agents/`. This deliberately does NOT revive
// `BaseAdapter.generateAgents()`: that seam is project-scoped and a test asserts agents are
// never regenerated into a project directory. Stage agents live only in the user's home, so
// they ride the framework install, never a repo (issue #567 INV-2, and the issue's own
// tripwire against writing agent defs into a project `.claude`/`.codex`).
//
// Stage isolation is core-engine behavior (no config knob), so the writer always writes the
// six agents. Output is deterministic, so a second run is byte-identical.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import Handlebars from 'handlebars';

import { getRuntimeTemplatesRoot } from '@/core/runtime-paths.js';
import { toPosixPath } from '@/core/path-utils.js';

import { MANDATORY_STAGE_AGENTS, buildStageAgentBody, type StageAgentDef } from './stage-agents.js';

/** One host's stage-agent target: the agents dir under the user home and its file extension. */
interface HostTarget {
  adapter: string;
  /** Path under the user home, e.g. `.claude/agents`. */
  agentsSubdir: string;
  /** The rendered file extension for this host. */
  extension: 'md' | 'toml';
  /** The Handlebars template basename under `runtime/templates/stage-agents/`. */
  template: string;
}

/** The hosts that get user-scope stage agents (issue #567 scope: Claude + Codex). */
export const STAGE_AGENT_HOSTS: readonly HostTarget[] = [
  {
    adapter: 'claude-code',
    agentsSubdir: '.claude/agents',
    extension: 'md',
    template: 'claude.md.hbs',
  },
  {
    adapter: 'codex-cli',
    agentsSubdir: '.codex/agents',
    extension: 'toml',
    template: 'codex.toml.hbs',
  },
];

export interface WriteStageAgentsOptions {
  /** The user home to write under. Defaults to the OS home; injectable for tests. */
  homeDir?: string;
}

/** The render context one stage agent's template is filled with. */
function agentContext(def: StageAgentDef): Record<string, unknown> {
  return {
    agentName: def.agentName,
    ledgerStage: def.ledgerStage,
    tools: def.claudeTools,
    body: buildStageAgentBody(def),
  };
}

/**
 * Write the six stage agents per supported host under the user's home. Returns the
 * project-independent list of absolute paths written. Never writes into any project directory.
 * Synchronous so it can be called from the synchronous `bootstrapFramework`; these templates
 * use no custom Handlebars helpers.
 */
export function writeStageAgents(options: WriteStageAgentsOptions = {}): string[] {
  const home = options.homeDir ?? homedir();
  const templatesRoot = getRuntimeTemplatesRoot();
  const written: string[] = [];

  for (const host of STAGE_AGENT_HOSTS) {
    const dir = join(home, host.agentsSubdir);
    mkdirSync(dir, { recursive: true });
    const templateSource = readFileSync(join(templatesRoot, 'stage-agents', host.template), 'utf8');
    const template = Handlebars.compile(templateSource);
    for (const def of MANDATORY_STAGE_AGENTS) {
      const content = template(agentContext(def));
      const filePath = join(dir, `${def.agentName}.${host.extension}`);
      writeFileSync(filePath, content, 'utf8');
      written.push(toPosixPath(filePath));
    }
  }
  return written;
}
