import { appendEvent, readEvents } from './events.js';
import { readRun } from './run-store.js';
import type { StageId } from './types.js';

export interface OnboardingAgentDef {
  agentName: string;
  stage: StageId;
  claudeTools: string;
  description: string;
  maxTurns: number;
  job: string;
}

const BASE_TOOLS = 'Read, Edit, Write, Grep, Glob, Bash';
const DRIVER_LINE = 'The onboarding-journey driver dispatches it only during step';

export const ONBOARDING_AGENTS: readonly OnboardingAgentDef[] = [
  {
    agentName: 'paqad-onboarding-docs',
    stage: 'project_docs',
    claudeTools: BASE_TOOLS,
    description: `paqad onboarding docs: writes the missing project docs for one doc area at a time. ${DRIVER_LINE} 3.`,
    maxTurns: 60,
    job: 'Write the docs for the doc areas your brief lists, one area at a time, adding only pages that are missing. Record each finished area with `paqad-ai onboarding unit project_docs <area> --outputs <files>`.',
  },
  {
    agentName: 'paqad-onboarding-modules',
    stage: 'module_docs',
    claudeTools: BASE_TOOLS,
    description: `paqad onboarding modules: writes the docs for one module under docs/modules/<slug>/. ${DRIVER_LINE} 4.`,
    maxTurns: 40,
    job: 'Write the docs for the one module your brief names, only under docs/modules/<slug>/. Record it with `paqad-ai onboarding unit module_docs <slug> --outputs <files>`.',
  },
  {
    agentName: 'paqad-onboarding-rules',
    stage: 'rules_discovery',
    claudeTools: `${BASE_TOOLS}, WebFetch, WebSearch`,
    description: `paqad onboarding rules: researches rules for the stack and proposes only new ones. ${DRIVER_LINE} 5.`,
    maxTurns: 80,
    job: 'Run the rules discovery steps your brief lists, record each researched package with `paqad-ai onboarding unit rules_discovery <package>`, and answer pauses with `paqad-ai onboarding decide <id>`.',
  },
  {
    agentName: 'paqad-onboarding-analyze',
    stage: 'rules_analyze',
    claudeTools: BASE_TOOLS,
    description: `paqad onboarding analyze: checks which rules a script can automate. ${DRIVER_LINE} 6.`,
    maxTurns: 60,
    job: 'Classify the rules in batches of 25 with the rule-analyzer scripts and run `paqad-ai onboarding progress rules_analyze <done> <total>` after each batch.',
  },
  {
    agentName: 'paqad-onboarding-scripts',
    stage: 'rule_scripts',
    claudeTools: BASE_TOOLS,
    description: `paqad onboarding scripts: writes and registers the rule checks. ${DRIVER_LINE} 7.`,
    maxTurns: 80,
    job: 'Write each check with its fixtures, prove it, and install it only through register-script.mjs. Record each rule batch with `paqad-ai onboarding unit rule_scripts <batch>`.',
  },
];

export const ONBOARDING_WRITE_ROOTS: readonly string[] = ['docs/', '.paqad/'];

export const ONBOARDING_DENIED_ROOTS: readonly string[] = [
  '.paqad/.config/',
  '.paqad/configs/',
  '.paqad/decisions/',
  '.paqad/scripts/rules/',
  '.paqad/onboarding/journey.json/',
];

export const MODULE_AGENT = 'paqad-onboarding-modules';

export function onboardingAgent(name: string): OnboardingAgentDef | null {
  return ONBOARDING_AGENTS.find((agent) => agent.agentName === name) ?? null;
}

export function claimedModuleSlugs(projectRoot: string): string[] {
  const open = new Map<string, number>();
  for (const event of readEvents(projectRoot)) {
    if (event.stage !== 'module_docs' || !event.unit) continue;
    if (event.kind === 'agent_start' && event.agent === MODULE_AGENT) {
      open.set(event.unit, (open.get(event.unit) ?? 0) + 1);
    }
    if (event.kind === 'unit' || event.kind === 'unit_kept') open.delete(event.unit);
  }
  return [...open.keys()];
}

export function moduleAgentBindings(projectRoot: string): Map<string, string | null> {
  const bound = new Map<string, string | null>();
  for (const event of readEvents(projectRoot)) {
    if (event.kind !== 'agent_bind' || event.agent !== MODULE_AGENT || !event.agent_id) continue;
    bound.set(event.agent_id, event.unit ?? null);
  }
  return bound;
}

function nextUnboundModule(projectRoot: string): string | null {
  const taken = new Set(moduleAgentBindings(projectRoot).values());
  return claimedModuleSlugs(projectRoot).find((slug) => !taken.has(slug)) ?? null;
}

export function moduleAgentWriteRoots(projectRoot: string, agentId?: unknown): string[] {
  const claimed = claimedModuleSlugs(projectRoot);
  const bound = moduleAgentBindings(projectRoot);
  const id = typeof agentId === 'string' ? agentId.trim() : '';
  if (id !== '' && bound.has(id)) {
    const slug = bound.get(id) ?? null;
    return slug !== null && claimed.includes(slug) ? [`docs/modules/${slug}/`] : [];
  }
  const taken = new Set(bound.values());
  return claimed.filter((slug) => !taken.has(slug)).map((slug) => `docs/modules/${slug}/`);
}

export function buildOnboardingAgentBody(def: OnboardingAgentDef): string {
  return [
    `You are the paqad onboarding agent for one step of the onboarding journey. ${def.job}`,
    '',
    '## Procedure',
    '',
    '1. Export the `SE_SESSION` your brief names for every `paqad-ai` command.',
    '2. Do only the work your brief lists; the brief says "Onboarding journey says auto-recommended.", so never ask the person.',
    '3. Before you return, list the units done, the units left and any gap.',
    '',
    '## Do not',
    '',
    '- Do not ask the person anything: answer pauses with `paqad-ai onboarding decide <id>`.',
    '- Do not write outside docs/ and .paqad/; module agents write only under their own docs/modules/<slug>/. stage-agent-write-guard.mjs and the capability gate refuse any other write.',
    '- Do not use `paqad-ai stage begin` or the stage handback: this is not a feature-development stage.',
    '',
    '## Report',
    '',
    `Keep it under 2,000 tokens and finish in at most ${def.maxTurns} turns. Leave every finished unit recorded with \`paqad-ai onboarding unit\`. List the units done, the first unit left and any gap.`,
    'End with one line: `Status: DONE`, `Status: DONE_WITH_CONCERNS` (name the concerns), `Status: NEEDS_CONTEXT` (name the first unit left) or `Status: BLOCKED` (name what blocks it).',
  ].join('\n');
}

export const ONBOARDING_AGENT_TYPE = /^(?:paqad:)?paqad-onboarding-/u;

function agentName(agentType: string): string {
  return agentType.trim().replace(/^paqad:/u, '');
}

export function recordOnboardingAgentStart(
  projectRoot: string,
  agentType: unknown,
  agentId: unknown,
  now: () => Date = () => new Date(),
): boolean {
  if (typeof agentType !== 'string' || typeof agentId !== 'string' || agentId.trim() === '') {
    return false;
  }
  const agent = agentName(agentType);
  const def = onboardingAgent(agent);
  const run = readRun(projectRoot);
  if (def === null || run === null) return false;
  const unit = agent === MODULE_AGENT ? nextUnboundModule(projectRoot) : null;
  appendEvent(projectRoot, {
    ts: now().toISOString(),
    run_id: run.run_id,
    kind: 'agent_bind',
    stage: def.stage,
    agent,
    agent_id: agentId.trim(),
    ...(unit !== null ? { unit } : {}),
  });
  return true;
}

export function recordOnboardingAgentStop(
  projectRoot: string,
  agentType: unknown,
  reason: string,
  now: () => Date = () => new Date(),
): boolean {
  if (typeof agentType !== 'string') return false;
  const agent = agentName(agentType);
  const def = onboardingAgent(agent);
  const run = readRun(projectRoot);
  if (def === null || run === null) return false;
  appendEvent(projectRoot, {
    ts: now().toISOString(),
    run_id: run.run_id,
    kind: 'agent_stop',
    stage: def.stage,
    agent,
    action: reason,
  });
  return true;
}
