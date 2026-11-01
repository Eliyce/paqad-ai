import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';

import { readContractDecisions } from '@/decisions/authoring.js';
import { DECISION_CATEGORY_DEFAULTS } from '@/planning/decision-packet.js';
import { splitSkillFrontmatter } from '@/skills/frontmatter-parser.js';

import { readAuthoringConfig, type AuthoringConfig } from '../config.js';
import { AGENT_PERMISSION_ALLOW, readAuthoringDecision } from '../decisions.js';
import { readTextIfPresent } from '../fs-io.js';
import { hashAgentFile } from '../hash.js';
import {
  discoverInstalledAgents,
  discoverInstalledSkills,
  findCollisions,
  findNameShadowing,
  shadowingLine,
  type ArtifactScope,
  type InstalledArtifact,
} from '../overlap.js';
import { readSkillPathContext, type SkillPathContext } from '../paths.js';
import { agentTestDirectories } from '../tests/locations.js';
import { estimateTokens } from '../tokens.js';
import {
  AGENT_TRACKED_ROOT,
  AGENT_WORKSPACE_ROOT,
  AuthoringRefusal,
  validateAgentName,
} from '../workspace.js';
import { CLAUDE_CODE_AGENT_FIELDS, isClaudeModel, isObjectRoleName } from './fields.js';
import {
  compileNeverWritePattern,
  loadNeverWriteList,
  type NeverWriteList,
} from './never-write.js';
import {
  checkDynamic,
  checkEmDash,
  checkNeverWrite,
  checkSecrets,
  checkShouted,
  countFindings,
  FindingSink,
  sortFindings,
  type LintFinding,
  type LintTextFile,
} from './runner.js';

export const AGENT_NAME_MAX = 256;
export const AGENT_SKILLS_MAX = 32;
export const AGENT_MEMORY_MAX_BYTES = 25 * 1024;
export const TOOL_DEFINITIONS_MAX_TOKENS = 10000;
export const TOOL_DEFINITION_TOKENS_ESTIMATE = 500;
export const REPORT_STATUSES = ['DONE', 'DONE_WITH_CONCERNS', 'NEEDS_CONTEXT', 'BLOCKED'] as const;
export const AUTO_DESCRIPTION_OPENING = 'Use this agent when';
export const DISPATCHED_DESCRIPTION = /\bdispatched by\b/iu;
export const TOOL_LIMIT_POWER = 'tool-limit';

const PERMISSION_RULE = 'AG-015';
const TOOL_LIMIT_RULE = 'AG-018';
const RISKY_POWER_RULE = 'AG-022';
export const POWER_RULES: readonly string[] = [PERMISSION_RULE, TOOL_LIMIT_RULE, RISKY_POWER_RULE];
const SCRIPT_INTERPRETERS = /^(?:node|php|python3?|ruby|bash|sh|deno|bun|tsx)$/u;
const SHELL_OPERATORS = /[;&|`<>]|\$\(/u;
const HOOK_SCRIPT_PREFIX = /^(?:"?\$\{?CLAUDE_PROJECT_DIR\}?"?\/|\.\/)/u;
const TIME_OF_DAY = /\b(?:[01]?\d|2[0-3]):[0-5]\d\b/u;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/iu;
const RANDOM_ID = /\b(?=(?:[a-z]*\d){3})(?=[a-z0-9]*[a-z])[a-z0-9]{12,}\b/iu;
const TOKEN_MAX = /\b\d[\d,]*\s*tokens?\b/iu;
const OPEN_INTERPRETERS =
  /^(?:\*|(?:sh|bash|zsh|node|python3?|npx|curl|wget|eval|deno|bun|ruby|perl|php)\b)/u;
const INSTALL_COMMAND =
  /\b(?:(?:pnpm|npm|yarn|bun)\s+(?:add|install|i)\b|pip3?\s+install\b|composer\s+(?:require|install)\b)/u;
const DELETE_COMMAND = /(?:^|\s)rm\b|\bgit\s+clean\b|\bgit\s+reset\s+--hard\b/u;
const BODY_HEADINGS = ['Objective', 'Procedure', 'Report', 'Stop when', 'Do not', 'Example'];

export type AgentInvocation = 'auto' | 'dispatched';

export interface AgentLintOptions {
  projectRoot: string;
  invocation?: AgentInvocation;
  scope?: ArtifactScope;
  context?: SkillPathContext;
  installedAgents?: readonly InstalledArtifact[];
  installedSkills?: readonly string[];
  mcpServers?: readonly string[];
  permissionDecisions?: readonly string[];
  memoryFile?: string;
  extraScanFiles?: readonly string[];
  emDashFiles?: readonly string[];
  neverWrite?: NeverWriteList;
  now?: () => Date;
  limits?: Partial<AgentLintLimits>;
}

export interface AgentLintLimits {
  descriptionMaxTokens: number;
  catalogMaxTokens: number;
  promptMaxTokens: number;
  maxTools: number;
  memoryMaxLines: number;
  collisionJaccard: number;
}

export const DEFAULT_AGENT_LINT_LIMITS: AgentLintLimits = {
  descriptionMaxTokens: 300,
  catalogMaxTokens: 15000,
  promptMaxTokens: 3000,
  maxTools: 10,
  memoryMaxLines: 200,
  collisionJaccard: 0.4,
};

export interface AgentLintResult {
  agent: string;
  findings: LintFinding[];
  blocking: number;
  warnings: number;
  powers: string[];
  file_hash: string;
  hook_scripts: string[];
}

export class AgentLintUsageError extends Error {}

export interface AgentHookCommand {
  event: string;
  matcher: string;
  command: string;
}

export interface AgentHookScripts {
  scripts: string[];
  problems: Array<{ command: string; problem: string }>;
  commands: AgentHookCommand[];
}

function hookCommands(hooks: unknown): AgentHookCommand[] {
  if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) return [];
  const commands: AgentHookCommand[] = [];
  for (const [event, entries] of Object.entries(hooks as Record<string, unknown>)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries as Array<Record<string, unknown> | null>) {
      const matcher = typeof entry?.matcher === 'string' ? entry.matcher : '*';
      const inner = Array.isArray(entry?.hooks)
        ? (entry.hooks as Array<Record<string, unknown>>)
        : [];
      for (const hook of inner) {
        if (typeof hook?.command === 'string')
          commands.push({ event, matcher, command: hook.command });
      }
    }
  }
  return commands;
}

function scriptOf(command: string): string | null {
  const words = command.trim().split(/\s+/u);
  const first = words[0] ?? '';
  const candidate = SCRIPT_INTERPRETERS.test(first) ? words[1] : first;
  if (candidate === undefined || candidate.startsWith('-')) return null;
  const path = candidate.replace(/^"|"$/gu, '').replace(HOOK_SCRIPT_PREFIX, '');
  return /\.[a-z0-9]+$/iu.test(path) || path.includes('/') ? path : null;
}

export function agentHookScripts(projectRoot: string, hooks: unknown): AgentHookScripts {
  const commands = hookCommands(hooks);
  const scripts: string[] = [];
  const problems: AgentHookScripts['problems'] = [];
  const root = resolve(projectRoot);
  for (const hook of commands) {
    const script = SHELL_OPERATORS.test(hook.command) ? null : scriptOf(hook.command);
    if (script === null) {
      problems.push({
        command: hook.command,
        problem:
          'is an inline shell command, not a script. Move it into a script file with a test.',
      });
      continue;
    }
    const abs = isAbsolute(script) ? resolve(script) : resolve(root, script);
    const rel = relative(root, abs).replaceAll('\\', '/');
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
      problems.push({
        command: hook.command,
        problem: 'names a script outside the project root. Keep hook scripts inside the project.',
      });
      continue;
    }
    if (!scripts.includes(rel)) scripts.push(rel);
  }
  return { scripts, problems, commands };
}

interface ParsedTool {
  raw: string;
  base: string;
  pattern: string | null;
}

function parseTool(raw: string): ParsedTool {
  const match = /^([A-Za-z_][\w-]*)\((.*)\)$/u.exec(raw.trim());
  return match
    ? { raw, base: match[1]!, pattern: match[2]!.trim() }
    : { raw, base: raw.trim(), pattern: null };
}

function listOf(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim());
  }
  if (typeof value === 'string') {
    return value
      .split(/,(?![^(]*\))/u)
      .map((item) => item.trim())
      .filter((item) => item !== '');
  }
  return undefined;
}

function mcpServerNames(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) =>
      typeof entry === 'string'
        ? [entry]
        : entry && typeof entry === 'object'
          ? Object.keys(entry as Record<string, unknown>)
          : [],
    );
  }
  if (value && typeof value === 'object') return Object.keys(value as Record<string, unknown>);
  return [];
}

export function projectMcpServers(projectRoot: string): string[] {
  const text = readTextIfPresent(join(projectRoot, '.mcp.json'));
  if (text === null) return [];
  try {
    const parsed = JSON.parse(text) as { mcpServers?: unknown };
    return mcpServerNames(parsed.mcpServers);
  } catch {
    return [];
  }
}

function keyLine(frontmatterLines: readonly string[], key: string): number {
  const index = frontmatterLines.findIndex((line) => line.startsWith(`${key}:`));
  return index === -1 ? 1 : index + 2;
}

interface Section {
  heading: string;
  line: number;
  lines: string[];
}

function sections(body: string, bodyStartLine: number): Section[] {
  const found: Section[] = [];
  body.split('\n').forEach((text, index) => {
    const heading = /^##\s+(.+?)\s*$/u.exec(text);
    if (heading) {
      found.push({ heading: heading[1]!, line: bodyStartLine + index, lines: [] });
    } else if (found.length > 0) {
      found.at(-1)!.lines.push(text);
    }
  });
  return found;
}

export function bodyHeadingOrderProblem(body: string): string | null {
  const present = sections(body, 1)
    .map((section) => section.heading)
    .filter((heading) => BODY_HEADINGS.includes(heading));
  const missing = BODY_HEADINGS.filter((heading) => !present.includes(heading));
  if (missing.length > 0) return `missing ${missing.map((heading) => `## ${heading}`).join(', ')}`;
  const order = BODY_HEADINGS.filter((heading) => present.includes(heading));
  if (present.some((heading, index) => heading !== order[index])) {
    return `the headings must come in the order ${BODY_HEADINGS.join(', ')}`;
  }
  return null;
}

export interface PermissionApproval {
  approved: boolean;
  decision: string | null;
  reason: string;
}

function parsePermissionContext(context: string): { powers: string[]; fileHash: string } | null {
  const match = /^Powers: (.*)\. File hash: (.*)\.$/u.exec(context.trim());
  if (!match) return null;
  return {
    powers: match[1]!.split(', ').filter((power) => power !== ''),
    fileHash: match[2]!,
  };
}

function readPacketContext(projectRoot: string, id: string): string | null {
  const row = readContractDecisions(projectRoot).find((entry) => entry.packet.id === id);
  const context = (row?.packet as { context?: unknown } | undefined)?.context;
  return typeof context === 'string' ? context : null;
}

export function permissionApproval(
  projectRoot: string,
  decisions: readonly string[],
  powers: readonly string[],
  fileHash: string,
  now: Date,
): PermissionApproval {
  const wanted = [...new Set(powers)].sort().join(', ');
  const ttlDays = DECISION_CATEGORY_DEFAULTS['authoring.agent_permission'].ttl_days;
  let reason = 'no resolved authoring.agent_permission packet id is recorded';
  for (const id of decisions) {
    const record = readAuthoringDecision(projectRoot, id);
    if (record === null) {
      reason = `decision ${id} is not in the decision ledger`;
      continue;
    }
    if (record.category !== 'authoring.agent_permission') {
      reason = `decision ${id} is a ${record.category} decision`;
      continue;
    }
    if (record.status !== 'resolved' || record.chosen !== AGENT_PERMISSION_ALLOW) {
      reason = `decision ${id} is not resolved with Allow these powers`;
      continue;
    }
    const resolvedAt = record.resolvedAt === null ? Number.NaN : Date.parse(record.resolvedAt);
    if (!Number.isFinite(resolvedAt) || now.getTime() > resolvedAt + ttlDays * 86_400_000) {
      reason = `decision ${id} expired after ${ttlDays} days`;
      continue;
    }
    const context = readPacketContext(projectRoot, id);
    const listed = context === null ? null : parsePermissionContext(context);
    if (listed === null || [...listed.powers].sort().join(', ') !== wanted) {
      reason = `decision ${id} lists other powers than ${wanted}`;
      continue;
    }
    if (listed.fileHash !== fileHash) {
      reason = `decision ${id} approved an earlier version of the agent file`;
      continue;
    }
    return { approved: true, decision: id, reason: `approved by ${id}` };
  }
  return { approved: false, decision: null, reason };
}

interface AgentLintContext {
  sink: FindingSink;
  rel: string;
  data: Record<string, unknown>;
  frontmatterLines: string[];
  body: string;
  bodyStartLine: number;
  limits: AgentLintLimits;
  options: AgentLintOptions;
}

function checkName(ctx: AgentLintContext): string {
  const { sink, rel, data } = ctx;
  const line = keyLine(ctx.frontmatterLines, 'name');
  const name = typeof data.name === 'string' ? data.name.trim() : '';
  if (name === '') {
    sink.block(
      'AG-001',
      rel,
      line,
      'The agent has no name. Add a lowercase, hyphenated role name.',
    );
    return basename(rel).replace(/\.[^.]+$/u, '');
  }
  if (name.includes(':') || name.startsWith('-') || name.length > AGENT_NAME_MAX) {
    sink.block(
      'AG-001',
      rel,
      line,
      `The name "${name}" has a colon, a leading hyphen or more than ${AGENT_NAME_MAX} characters, so the host skips the file.`,
    );
  }
  if (!isObjectRoleName(name)) {
    sink.warn(
      'AG-002',
      rel,
      line,
      `The name "${name}" does not name a role (code-reviewer, test-runner, db-reader).`,
    );
  }
  return name;
}

function checkDescription(ctx: AgentLintContext): string {
  const { sink, rel, data, limits } = ctx;
  const line = keyLine(ctx.frontmatterLines, 'description');
  const description = typeof data.description === 'string' ? data.description.trim() : '';
  if (description === '') {
    sink.block('AG-003', rel, line, 'The agent has no description, so the host skips the file.');
    return '';
  }
  const tokens = estimateTokens(description);
  if (tokens > limits.descriptionMaxTokens) {
    sink.block(
      'AG-003',
      rel,
      line,
      `The description is ${tokens} tokens, over the limit of ${limits.descriptionMaxTokens} (agent_description_max_tokens).`,
    );
  }
  const auto = description.startsWith(AUTO_DESCRIPTION_OPENING);
  const dispatched = DISPATCHED_DESCRIPTION.test(description);
  const invocation = ctx.options.invocation;
  if (invocation === 'auto' && !auto) {
    sink.block(
      'AG-003',
      rel,
      line,
      `The description must open with "${AUTO_DESCRIPTION_OPENING}".`,
    );
  } else if (invocation === 'dispatched' && !dispatched) {
    sink.block(
      'AG-003',
      rel,
      line,
      'The description must say who dispatches the agent, as in "Dispatched by the paqad orchestrator only."',
    );
  } else if (invocation === undefined && !auto && !dispatched) {
    sink.block(
      'AG-003',
      rel,
      line,
      `The description must open with "${AUTO_DESCRIPTION_OPENING}" or say who dispatches the agent.`,
    );
  }
  return description;
}

function checkCatalog(
  ctx: AgentLintContext,
  name: string,
  description: string,
  installed: readonly InstalledArtifact[],
): void {
  const sizes = new Map<string, number>();
  for (const agent of installed) {
    if (agent.name === name) continue;
    sizes.set(agent.name, Math.max(sizes.get(agent.name) ?? 0, estimateTokens(agent.description)));
  }
  sizes.set(name, estimateTokens(description));
  const total = [...sizes.values()].reduce((sum, size) => sum + size, 0);
  if (total <= ctx.limits.catalogMaxTokens) return;
  const ranked = [...sizes.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([agent, size]) => `${agent} (${size})`);
  ctx.sink.block(
    'AG-004',
    ctx.rel,
    keyLine(ctx.frontmatterLines, 'description'),
    `The agent descriptions add up to ${total} tokens, over ${ctx.limits.catalogMaxTokens} (agent_catalog_description_max_tokens). By size: ${ranked.join(', ')}.`,
  );
}

function checkReferences(
  ctx: AgentLintContext,
  tools: readonly ParsedTool[],
  skills: readonly string[],
): void {
  const { sink, rel, data, options } = ctx;
  const known = new Set<string>(CLAUDE_CODE_AGENT_FIELDS.tools);
  const servers = new Set(options.mcpServers ?? projectMcpServers(options.projectRoot));
  const toolLine = keyLine(ctx.frontmatterLines, 'tools');
  const disallowed = (listOf(data.disallowedTools) ?? []).map(parseTool);
  for (const tool of [...tools, ...disallowed]) {
    const mcp = /^mcp__([^_]+(?:_[^_]+)*?)__/u.exec(tool.base);
    if (mcp) {
      if (!servers.has(mcp[1]!)) {
        sink.block(
          'AG-005',
          rel,
          toolLine,
          `The tool ${tool.raw} names the MCP server ${mcp[1]}, which is not configured.`,
        );
      }
    } else if (!known.has(tool.base)) {
      sink.block('AG-005', rel, toolLine, `The tool ${tool.raw} does not exist on the host.`);
    }
  }
  const installedSkills = new Set(
    options.installedSkills ??
      discoverInstalledSkills(
        options.projectRoot,
        options.context ?? readSkillPathContext(options.projectRoot),
        { userHome: null },
      ).map((skill) => skill.name),
  );
  for (const skill of skills) {
    if (!installedSkills.has(skill)) {
      sink.block(
        'AG-005',
        rel,
        keyLine(ctx.frontmatterLines, 'skills'),
        `The skill ${skill} is not installed.`,
      );
    }
  }
  for (const server of mcpServerNames(data.mcpServers)) {
    const inline =
      data.mcpServers && typeof data.mcpServers === 'object' && !Array.isArray(data.mcpServers);
    if (!inline && !servers.has(server)) {
      sink.block(
        'AG-005',
        rel,
        keyLine(ctx.frontmatterLines, 'mcpServers'),
        `The MCP server ${server} is not configured.`,
      );
    }
  }
}

function checkModel(ctx: AgentLintContext): void {
  const { sink, rel, data } = ctx;
  if (data.model !== undefined && (typeof data.model !== 'string' || !isClaudeModel(data.model))) {
    sink.block(
      'AG-006',
      rel,
      keyLine(ctx.frontmatterLines, 'model'),
      `The model ${String(data.model)} is not valid for Claude Code. Use ${CLAUDE_CODE_AGENT_FIELDS.models.join(', ')} or a full claude- model id.`,
    );
  }
  if (
    data.effort !== undefined &&
    !(CLAUDE_CODE_AGENT_FIELDS.efforts as readonly unknown[]).includes(data.effort)
  ) {
    sink.block(
      'AG-006',
      rel,
      keyLine(ctx.frontmatterLines, 'effort'),
      `The effort ${String(data.effort)} is not valid. Use ${CLAUDE_CODE_AGENT_FIELDS.efforts.join(', ')}.`,
    );
  }
  const maxTurns = data.maxTurns;
  if (typeof maxTurns !== 'number' || !Number.isInteger(maxTurns) || maxTurns < 1) {
    sink.block(
      'AG-007',
      rel,
      keyLine(ctx.frontmatterLines, 'maxTurns'),
      maxTurns === undefined
        ? 'The field maxTurns is missing. Set the most turns the agent may take.'
        : `The field maxTurns is ${String(maxTurns)}; use a positive whole number.`,
    );
  }
}

function checkReport(ctx: AgentLintContext): void {
  const report = sections(ctx.body, ctx.bodyStartLine).find(
    (section) => section.heading === 'Report',
  );
  if (report === undefined) {
    ctx.sink.block('AG-008', ctx.rel, ctx.bodyStartLine, 'The body has no ## Report section.');
    return;
  }
  const text = report.lines.join('\n');
  if (!TOKEN_MAX.test(text)) {
    ctx.sink.block(
      'AG-008',
      ctx.rel,
      report.line,
      'The ## Report section states no maximum length in tokens.',
    );
  }
  const status = report.lines.find((line) => /\bStatus\b/u.test(line));
  if (
    status === undefined ||
    !REPORT_STATUSES.some((value) => new RegExp(`\\b${value}\\b`, 'u').test(status))
  ) {
    ctx.sink.block(
      'AG-008',
      ctx.rel,
      report.line,
      `The ## Report section has no Status line from ${REPORT_STATUSES.join(', ')}.`,
    );
  }
}

function checkMemory(ctx: AgentLintContext): void {
  const memory = ctx.options.memoryFile;
  if (memory === undefined) return;
  const abs = join(ctx.options.projectRoot, memory);
  if (!existsSync(abs)) return;
  const text = readFileSync(abs, 'utf8');
  const lines = text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
  const bytes = Buffer.byteLength(text);
  if (lines > ctx.limits.memoryMaxLines || bytes > AGENT_MEMORY_MAX_BYTES) {
    ctx.sink.block(
      'AG-010',
      memory,
      1,
      `MEMORY.md is ${lines} lines and ${bytes} bytes, over ${ctx.limits.memoryMaxLines} lines or 25 KB. Run paqad-ai agent memory-consolidate.`,
    );
  }
}

function testFiles(projectRoot: string, name: string): string[] {
  const files: string[] = [];
  const walk = (rel: string): void => {
    const abs = join(projectRoot, rel);
    if (!existsSync(abs)) return;
    for (const entry of readdirSync(abs).sort()) {
      const child = `${rel}/${entry}`;
      if (statSync(join(projectRoot, child)).isDirectory()) walk(child);
      else files.push(child);
    }
  };
  for (const dir of agentTestDirectories(name)) walk(dir);
  return files;
}

function checkHooks(ctx: AgentLintContext, name: string, hooks: AgentHookScripts): void {
  const line = keyLine(ctx.frontmatterLines, 'hooks');
  for (const problem of hooks.problems) {
    ctx.sink.block(
      'AG-011',
      ctx.rel,
      line,
      `The hook command "${problem.command}" ${problem.problem}`,
    );
  }
  const tests = testFiles(ctx.options.projectRoot, name);
  for (const script of hooks.scripts) {
    const abs = join(ctx.options.projectRoot, script);
    if (!existsSync(abs)) {
      ctx.sink.block('AG-011', ctx.rel, line, `The hook script ${script} does not exist.`);
      continue;
    }
    const command = hooks.commands.find(
      (hook) => scriptOf(hook.command) !== null && hook.command.includes(basename(script)),
    );
    const viaInterpreter =
      command !== undefined &&
      SCRIPT_INTERPRETERS.test(command.command.trim().split(/\s+/u)[0] ?? '');
    if (!viaInterpreter && (statSync(abs).mode & 0o111) === 0) {
      ctx.sink.block(
        'AG-011',
        ctx.rel,
        line,
        `The hook script ${script} is not executable. Run it through an interpreter, as in node ${script}.`,
      );
    }
    const stem = basename(script).split('.')[0]!.toLowerCase();
    if (!tests.some((test) => basename(test).toLowerCase().includes(stem))) {
      ctx.sink.block(
        'AG-011',
        ctx.rel,
        line,
        `The hook script ${script} has no test under ${agentTestDirectories(name).join(' or ')}.`,
      );
    }
  }
}

function matcherCovers(matcher: string, tool: string): boolean {
  if (matcher === '*' || matcher === '') return true;
  try {
    return new RegExp(`^(?:${matcher})$`, 'u').test(tool);
  } catch {
    return matcher === tool;
  }
}

function blockingHookFor(hooks: AgentHookScripts, tool: string): boolean {
  return hooks.commands.some(
    (hook) => hook.event === 'PreToolUse' && matcherCovers(hook.matcher, tool),
  );
}

function riskyPowers(
  tools: readonly ParsedTool[] | undefined,
  hooks: AgentHookScripts,
): Array<{ power: string; tool: string }> {
  const risky: Array<{ power: string; tool: string }> = [];
  const add = (power: string, tool: string): void => {
    if (!risky.some((entry) => entry.power === power)) risky.push({ power, tool });
  };
  if (tools === undefined) {
    add('Bash', 'every tool (no tools list)');
    add('WebFetch', 'every tool (no tools list)');
    add('WebSearch', 'every tool (no tools list)');
    return risky;
  }
  for (const tool of tools) {
    if (tool.base === 'WebFetch' || tool.base === 'WebSearch') add(tool.base, tool.raw);
    if (tool.base !== 'Bash' && tool.base !== 'PowerShell') continue;
    const pattern = tool.pattern ?? '';
    const open = tool.pattern === null || pattern === '' || OPEN_INTERPRETERS.test(pattern);
    if (open && !blockingHookFor(hooks, tool.base)) add(tool.base, tool.raw);
    if (INSTALL_COMMAND.test(pattern)) add('install', tool.raw);
    if (DELETE_COMMAND.test(pattern)) add('delete', tool.raw);
  }
  return risky;
}

function checkDoNot(
  ctx: AgentLintContext,
  tools: readonly ParsedTool[] | undefined,
  hooks: AgentHookScripts,
): void {
  const section = sections(ctx.body, ctx.bodyStartLine).find((entry) => entry.heading === 'Do not');
  if (section === undefined) return;
  const allowed = new Set((tools ?? []).map((tool) => tool.base));
  const denied = new Set(
    (listOf(ctx.data.disallowedTools) ?? []).map((tool) => parseTool(tool).base),
  );
  section.lines.forEach((text, index) => {
    if (!/^\s*(?:[-*+]|\d+[.)])\s+/u.test(text)) return;
    const named = CLAUDE_CODE_AGENT_FIELDS.tools.filter((tool) =>
      new RegExp(`\\b${tool}\\b`, 'u').test(text),
    );
    const enforced =
      named.some((tool) => denied.has(tool) || (tools !== undefined && !allowed.has(tool))) ||
      named.some((tool) => blockingHookFor(hooks, tool)) ||
      (tools !== undefined &&
        /\b(?:edit|write|modify|change)\b/iu.test(text) &&
        !allowed.has('Edit') &&
        !allowed.has('Write'));
    if (!enforced) {
      ctx.sink.warn(
        'AG-021',
        ctx.rel,
        section.line + index + 1,
        'No tool restriction or hook enforces this Do not item. Restrict the tool or add a blocking hook.',
      );
    }
  });
}

function readAgentText(file: string): string {
  if (file.endsWith('.toml')) {
    throw new AgentLintUsageError(
      `${file} is a rendered Codex agent. Lint the Markdown source the release renders it from.`,
    );
  }
  if (!existsSync(file) || !statSync(file).isFile()) {
    throw new AgentLintUsageError(`${file} is not a file`);
  }
  return readFileSync(file, 'utf8');
}

function relTo(projectRoot: string, file: string): string {
  const rel = relative(projectRoot, resolve(projectRoot, file)).replaceAll('\\', '/');
  return rel.startsWith('..') ? file.replaceAll('\\', '/') : rel;
}

function textFile(projectRoot: string, rel: string): (LintTextFile & { content: string }) | null {
  const content = readTextIfPresent(join(projectRoot, rel));
  return content === null ? null : { rel, lines: content.split('\n'), content };
}

export function lintAgentFile(file: string, options: AgentLintOptions): AgentLintResult {
  const projectRoot = options.projectRoot;
  const content = readAgentText(resolve(projectRoot, file));
  const rel = relTo(projectRoot, file);
  const limits = { ...DEFAULT_AGENT_LINT_LIMITS, ...options.limits };
  const sink = new FindingSink();
  const split = splitSkillFrontmatter(content);
  if (!split.ok) {
    sink.block('AG-001', rel, 1, split.message.replace('SKILL.md', 'The agent file'));
    const findings = sortFindings(sink.findings);
    return {
      agent: basename(rel).replace(/\.[^.]+$/u, ''),
      findings,
      ...countFindings(findings),
      powers: [],
      file_hash: hashAgentFile(projectRoot, rel),
      hook_scripts: [],
    };
  }
  const ctx: AgentLintContext = {
    sink,
    rel,
    data: split.data,
    frontmatterLines: split.frontmatterLines,
    body: split.body,
    bodyStartLine: split.bodyStartLine,
    limits,
    options,
  };
  const name = checkName(ctx);
  const description = checkDescription(ctx);
  const context = options.context ?? readSkillPathContext(projectRoot);
  const installed =
    options.installedAgents ?? discoverInstalledAgents(projectRoot, context, { userHome: null });
  checkCatalog(ctx, name, description, installed);
  const rawTools = listOf(split.data.tools);
  const tools = rawTools?.map(parseTool);
  const skills = listOf(split.data.skills) ?? [];
  checkReferences(ctx, tools ?? [], skills);
  checkModel(ctx);
  checkReport(ctx);
  if (skills.length > AGENT_SKILLS_MAX) {
    sink.block(
      'AG-009',
      rel,
      keyLine(ctx.frontmatterLines, 'skills'),
      `The agent preloads ${skills.length} skills, over ${AGENT_SKILLS_MAX}.`,
    );
  }
  checkMemory(ctx);
  const hooks = agentHookScripts(projectRoot, split.data.hooks);
  checkHooks(ctx, name, hooks);
  const bodyTokens = estimateTokens(split.body);
  if (bodyTokens > limits.promptMaxTokens) {
    sink.block(
      'AG-014',
      rel,
      split.bodyStartLine,
      `The body is ${bodyTokens} tokens, over the limit of ${limits.promptMaxTokens} (agent_prompt_max_tokens).`,
    );
  }
  const candidate = {
    kind: 'agent' as const,
    name,
    text: description,
    scope: options.scope ?? 'project',
  };
  const others = installed.filter((agent) => agent.path !== rel);
  for (const shadow of findNameShadowing(candidate, others)) {
    sink.block('AG-016', rel, keyLine(ctx.frontmatterLines, 'name'), shadowingLine(shadow));
  }
  for (const collision of findCollisions(candidate, others, limits.collisionJaccard).collisions) {
    sink.block(
      'AG-017',
      rel,
      keyLine(ctx.frontmatterLines, 'description'),
      `The description collides with ${collision.existing} (${collision.existing_path}) at ${collision.score.toFixed(2)}, at or above ${limits.collisionJaccard}.`,
    );
  }

  const fileHash = hashAgentFile(projectRoot, rel, hooks.scripts);
  const permission = split.data.permissionMode === 'bypassPermissions';
  const toolCount = rawTools?.length ?? 0;
  const toolTokens = toolCount * TOOL_DEFINITION_TOKENS_ESTIMATE;
  const overTools = toolCount > limits.maxTools || toolTokens > TOOL_DEFINITIONS_MAX_TOKENS;
  const risky = riskyPowers(tools, hooks);
  const powers = [
    ...(permission ? ['bypassPermissions'] : []),
    ...(overTools ? [TOOL_LIMIT_POWER] : []),
    ...risky.map((entry) => entry.power),
  ].sort();
  const approval =
    powers.length === 0
      ? { approved: true, decision: null, reason: '' }
      : permissionApproval(
          projectRoot,
          options.permissionDecisions ?? [],
          powers,
          fileHash,
          (options.now ?? (() => new Date()))(),
        );
  if (!approval.approved) {
    const why = ` Ask for an authoring.agent_permission packet listing ${powers.join(', ')} (${approval.reason}).`;
    if (permission) {
      sink.block(
        PERMISSION_RULE,
        rel,
        keyLine(ctx.frontmatterLines, 'permissionMode'),
        `permissionMode: bypassPermissions skips every permission prompt.${why}`,
      );
    }
    if (overTools) {
      sink.block(
        TOOL_LIMIT_RULE,
        rel,
        keyLine(ctx.frontmatterLines, 'tools'),
        `The agent lists ${toolCount} tools (${(rawTools ?? []).join(', ')}), about ${toolTokens} tokens of tool definitions (estimate), over ${limits.maxTools} tools (agent_max_tools) or ${TOOL_DEFINITIONS_MAX_TOKENS} tokens.${why}`,
      );
    }
    for (const entry of risky) {
      sink.block(
        RISKY_POWER_RULE,
        rel,
        keyLine(ctx.frontmatterLines, 'tools'),
        `The tool ${entry.tool} gives the risky power ${entry.power}.${why}`,
      );
    }
  }
  checkDoNot(ctx, tools, hooks);

  const agentFile: LintTextFile = { rel, lines: content.split('\n') };
  const extras = [
    ...hooks.scripts,
    ...(options.extraScanFiles ?? []),
    ...(options.memoryFile === undefined ? [] : [options.memoryFile]),
  ]
    .map((path) => textFile(projectRoot, path))
    .filter((entry): entry is LintTextFile & { content: string } => entry !== null);
  checkSecrets(sink, 'AG-012', [
    { path: rel, content },
    ...extras.map((entry) => ({ path: entry.rel, content: entry.content })),
  ]);
  checkEmDash(sink, 'AG-013', agentFile);
  for (const path of [...hooks.scripts, ...(options.emDashFiles ?? [])]) {
    const extra = textFile(projectRoot, path);
    if (extra !== null) checkEmDash(sink, 'AG-013', extra);
  }
  checkDynamic(sink, 'AG-019', agentFile, {
    firstLine: split.bodyStartLine,
    extraPatterns: [TIME_OF_DAY, UUID, RANDOM_ID],
    message:
      'Dynamic content (a date, a time, a counter or a random id) in the system prompt. Keep the prompt the same on every run.',
  });
  const phrases = (options.neverWrite ?? loadNeverWriteList(projectRoot)).phrases;
  if (phrases.length > 0) {
    checkNeverWrite(sink, 'AG-020', agentFile, compileNeverWritePattern(phrases));
  }
  checkShouted(sink, 'AG-020', agentFile);

  const findings = sortFindings(sink.findings);
  return {
    agent: name,
    findings,
    ...countFindings(findings),
    powers,
    file_hash: fileHash,
    hook_scripts: hooks.scripts,
  };
}

export const PERMISSIONS_FILE = 'permissions.json';

export function agentLintLimitsFrom(config: AuthoringConfig): AgentLintLimits {
  return {
    descriptionMaxTokens: config.agent_description_max_tokens,
    catalogMaxTokens: config.agent_catalog_description_max_tokens,
    promptMaxTokens: config.agent_prompt_max_tokens,
    maxTools: config.agent_max_tools,
    memoryMaxLines: config.agent_memory_max_lines,
    collisionJaccard: config.authoring_collision_jaccard,
  };
}

function idsIn(text: string | null, pick: (parsed: unknown) => unknown): string[] {
  if (text === null) return [];
  try {
    const value = pick(JSON.parse(text));
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export function readPermissionDecisionIds(projectRoot: string, name: string): string[] {
  const tracked = readTextIfPresent(join(projectRoot, AGENT_TRACKED_ROOT, name, 'evidence.json'));
  const workspace = readTextIfPresent(
    join(projectRoot, AGENT_WORKSPACE_ROOT, name, PERMISSIONS_FILE),
  );
  return [
    ...new Set([
      ...idsIn(workspace, (parsed) => parsed),
      ...idsIn(
        tracked,
        (parsed) => (parsed as { permission_decisions?: unknown })?.permission_decisions,
      ),
    ]),
  ];
}

function isAgentName(name: string): boolean {
  try {
    validateAgentName(name);
    return true;
  } catch (error) {
    if (error instanceof AuthoringRefusal) return false;
    throw error;
  }
}

export function lintAgentInProject(
  projectRoot: string,
  file: string,
  extra: Partial<AgentLintOptions> = {},
): AgentLintResult {
  const config = readAuthoringConfig(projectRoot);
  const stem = basename(file).replace(/\.[^.]+$/u, '');
  return lintAgentFile(file, {
    projectRoot,
    limits: agentLintLimitsFrom(config),
    permissionDecisions: isAgentName(stem) ? readPermissionDecisionIds(projectRoot, stem) : [],
    ...extra,
  });
}
