import { ORCHESTRATOR_AGENT, resolveAgentIdentity } from '@/stage-evidence/agent-identity.js';
import {
  CHIEF_ARCHITECT_AGENT_NAME,
  EXPERT_AGENT_NAME,
  stageForAgentName,
  stripPluginAgentNamespace,
} from '@/stage-isolation/stage-agents.js';

export const MINUTE_MS = 60_000;
export const TOOL_INTERVAL_MAX_MS = 60 * MINUTE_MS;
export const THINKING_MAX_MS = 15 * MINUTE_MS;
export const AWAY_AFTER_MS = 30 * MINUTE_MS;
export const WINDOW_PAD_MS = 5 * MINUTE_MS;
export const BUCKET_MS = 10_000;
export const INJECTED_SCAN_CHARS = 400;

export const INJECTED_MARKERS: readonly string[] = [
  '<task-notification',
  'Another Claude session sent',
  'Stop hook feedback',
  '<ci-monitor-event',
  '<system-reminder',
  '<side-sessions',
  'Request interrupted',
];

export const CATEGORY = {
  edit: 'edit (including the pre-edit gate)',
  blockedTimeout: 'blocked: gate timeout',
  blockedEntry: 'blocked: entry gate',
  blockedOther: 'blocked: other gate',
  frameworkReread: 'framework re-read',
  checksRun: 'paqad checks run',
  paqadCli: 'paqad CLI',
  tests: 'tests',
  lint: 'lint, type, format, build',
  git: 'git',
  waiting: 'waiting and polling',
  other: 'read, search, other',
  thinking: 'model thinking',
} as const;

export type BusyCategory = (typeof CATEGORY)[keyof typeof CATEGORY];

export type RefusalLabel =
  typeof CATEGORY.blockedTimeout | typeof CATEGORY.blockedEntry | typeof CATEGORY.blockedOther;

export const OWNER_CATEGORY = {
  away: 'away',
  reading: 'reading and replying',
  answering: 'answering questions',
} as const;

export type OwnerCategory = (typeof OWNER_CATEGORY)[keyof typeof OWNER_CATEGORY];

export type UserRecordKind = 'tool-result' | 'injected' | 'human';

export type TestRunKind = 'whole-suite' | 'targeted' | 'reused';

export const REUSED_TEST_LINE = 'reused green test run from';

export const AGENT_ORDER = [
  'development',
  'checks',
  'review',
  'documentation_sync',
  'specification',
  'expert',
  'chief-architect',
  'planning',
  'Explore',
  'other',
  'main',
] as const;

export type AgentRole = (typeof AGENT_ORDER)[number];

export type OwnerColumn = 'development' | 'ceremony' | 'orchestrator' | 'other';

const CEREMONY_ROLES: ReadonlySet<AgentRole> = new Set<AgentRole>([
  'checks',
  'review',
  'documentation_sync',
  'specification',
  'expert',
  'chief-architect',
  'planning',
]);

export const AGENT_TOOL = 'Agent';
export const ASK_USER_TOOL = 'AskUserQuestion';
const READ_TOOL = 'Read';
const BASH_TOOL = 'Bash';
const EDIT_TOOLS: ReadonlySet<string> = new Set(['Edit', 'Write', 'NotebookEdit']);
const SIZE_TOOLS: ReadonlySet<string> = new Set(['Edit', 'Write']);

const FRAMEWORK_READ_MARKERS: readonly string[] = [
  'AGENT-BOOTSTRAP',
  'AGENT-ROUTER',
  'CLAUDE.md',
  'framework-path',
  'session-context',
];
const FRAMEWORK_READ_DIRS = /(^|\/)docs\/instructions\/(stack|design-system|workflows)(\/|$)/;

const PAQAD_CLI_VERBS: ReadonlySet<string> = new Set([
  'stage',
  'plan',
  'spec',
  'review',
  'rules',
  'decision',
  'lane',
  'route',
  'debt',
  'index',
  'visual-evidence',
]);
const TEST_BINARIES: ReadonlySet<string> = new Set(['vitest', 'pest', 'phpunit']);
const LINT_BINARIES: ReadonlySet<string> = new Set([
  'tsc',
  'typecheck',
  'eslint',
  'prettier',
  'tsup',
]);
const LINT_SCRIPTS: ReadonlySet<string> = new Set(['lint', 'format', 'build', 'typecheck']);
const PACKAGE_RUNNERS: ReadonlySet<string> = new Set(['pnpm', 'npm', 'yarn']);
const EXEC_WRAPPERS: ReadonlySet<string> = new Set(['npx', 'bunx']);
const RUNNER_SUBCOMMANDS: ReadonlySet<string> = new Set(['exec', 'dlx', 'run', 'x']);

const CHAINED_PREFIX = /^(cd|export)\s/;
const ASSIGNMENT_PREFIX = /^[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|[^\s&;|"']*)\s+/;
const WAITING_COMMAND = /^(sleep|until|while)\b/;

export function isInjectedText(text: string): boolean {
  return INJECTED_MARKERS.some((marker) => {
    const at = text.indexOf(marker);
    return at !== -1 && at < INJECTED_SCAN_CHARS;
  });
}

export function classifyUserRecord(hasToolResult: boolean, text: string): UserRecordKind {
  if (hasToolResult) return 'tool-result';
  return isInjectedText(text) ? 'injected' : 'human';
}

export function ownerGapCategory(gapMs: number): OwnerCategory {
  return gapMs > AWAY_AFTER_MS ? OWNER_CATEGORY.away : OWNER_CATEGORY.reading;
}

export function isThinkingGap(gapMs: number): boolean {
  return gapMs >= 0 && gapMs < THINKING_MAX_MS;
}

export function keepsToolInterval(durationMs: number): boolean {
  return durationMs >= 0 && durationMs <= TOOL_INTERVAL_MAX_MS;
}

export function isEditTool(name: string): boolean {
  return EDIT_TOOLS.has(name);
}

export function countsTowardSize(name: string): boolean {
  return SIZE_TOOLS.has(name);
}

export function refusalLabel(isError: boolean, resultText: string): RefusalLabel | null {
  if (!isError || !resultText.includes('hook error')) return null;
  if (resultText.includes('timed out')) return CATEGORY.blockedTimeout;
  if (resultText.includes('agent-entry')) return CATEGORY.blockedEntry;
  return CATEGORY.blockedOther;
}

export function isFrameworkReread(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  return (
    FRAMEWORK_READ_MARKERS.some((marker) => normalized.includes(marker)) ||
    FRAMEWORK_READ_DIRS.test(normalized)
  );
}

function firstAndAnd(text: string): number {
  let quote: string | null = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (quote !== null) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '\n' || ch === ';' || (ch === '|' && text[i + 1] !== '|')) return -1;
    else if (ch === '&' && text[i + 1] === '&') return i;
  }
  return -1;
}

function stripOnePrefix(text: string): string {
  if (CHAINED_PREFIX.test(text)) {
    const at = firstAndAnd(text);
    return at === -1 ? text : text.slice(at + 2).trimStart();
  }
  const assignment = ASSIGNMENT_PREFIX.exec(text);
  return assignment ? text.slice(assignment[0].length) : text;
}

export function stripCommandPrefixes(command: string): string {
  let rest = command.trimStart();
  for (;;) {
    const next = stripOnePrefix(rest);
    if (next === rest) return rest.trim();
    rest = next;
  }
}

export function commandWords(stripped: string): string[] {
  const words: string[] = [];
  let current = '';
  let quote: string | null = null;
  let started = false;
  for (const ch of stripped) {
    if (quote !== null) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
      continue;
    }
    if (ch === '&' || ch === '|' || ch === ';' || ch === '\n') break;
    if (/\s/.test(ch)) {
      if (started) words.push(current);
      current = '';
      started = false;
      continue;
    }
    current += ch;
    started = true;
  }
  if (started) words.push(current);
  return words;
}

function baseName(word: string): string {
  const slash = Math.max(word.lastIndexOf('/'), word.lastIndexOf('\\'));
  return slash === -1 ? word : word.slice(slash + 1);
}

interface CommandHead {
  binary: string;
  script: string | null;
  args: string[];
}

function commandHead(words: readonly string[]): CommandHead | null {
  const rest = words.length > 0 && EXEC_WRAPPERS.has(baseName(words[0]!)) ? words.slice(1) : words;
  if (rest.length === 0) return null;
  const binary = baseName(rest[0]!);
  if (!PACKAGE_RUNNERS.has(binary)) return { binary, script: null, args: rest.slice(1) };
  const index = rest[1] !== undefined && RUNNER_SUBCOMMANDS.has(rest[1]) ? 2 : 1;
  return { binary, script: rest[index] ?? null, args: rest.slice(index + 1) };
}

function headOf(command: string): CommandHead | null {
  return commandHead(commandWords(stripCommandPrefixes(command)));
}

function paqadCategory(args: readonly string[]): BusyCategory {
  if (args[0] === 'checks' && args[1] === 'run') return CATEGORY.checksRun;
  if (args[0] !== undefined && PAQAD_CLI_VERBS.has(args[0])) return CATEGORY.paqadCli;
  return CATEGORY.other;
}

function isTestHead(head: CommandHead): boolean {
  if (head.script === null) {
    if (TEST_BINARIES.has(head.binary)) return true;
    if (head.binary === 'php') return head.args[0] === 'artisan' && head.args[1] === 'test';
    return head.binary === 'sail' && head.args[0] === 'test';
  }
  if (head.script.startsWith('test')) return true;
  if (head.binary === 'pnpm' && head.script === 'ci') return true;
  return TEST_BINARIES.has(head.script);
}

function isLintHead(head: CommandHead): boolean {
  if (head.script === null) return LINT_BINARIES.has(head.binary);
  return LINT_SCRIPTS.has(head.script.split(':')[0]!) || LINT_BINARIES.has(head.script);
}

function isPaqadHead(head: CommandHead): boolean {
  return head.binary === 'paqad-ai' || head.script === 'paqad-ai';
}

export function classifyBashCommand(command: string): BusyCategory {
  const stripped = stripCommandPrefixes(command);
  if (WAITING_COMMAND.test(stripped)) return CATEGORY.waiting;
  const head = commandHead(commandWords(stripped));
  if (head === null) return CATEGORY.other;
  if (isPaqadHead(head)) return paqadCategory(head.args);
  if (isTestHead(head)) return CATEGORY.tests;
  if (isLintHead(head)) return CATEGORY.lint;
  if (head.binary === 'git' || head.binary === 'gh') return CATEGORY.git;
  return CATEGORY.other;
}

function namesTarget(arg: string): boolean {
  if (arg === '-t' || arg.startsWith('-t=') || arg.startsWith('--testNamePattern')) return true;
  if (arg.startsWith('-')) return false;
  return arg.includes('tests/') || arg.includes('.test.') || arg.includes('/');
}

export function reusedTestRun(resultText: string): boolean {
  return resultText.includes(REUSED_TEST_LINE);
}

export function testRunKind(command: string): TestRunKind | null {
  const category = classifyBashCommand(command);
  if (category === CATEGORY.checksRun) return 'whole-suite';
  if (category !== CATEGORY.tests) return null;
  const head = headOf(command);
  if (head === null) return null;
  if (head.binary === 'pnpm' && head.script === 'ci') return 'whole-suite';
  return head.args.some(namesTarget) ? 'targeted' : 'whole-suite';
}

export interface ToolInput {
  command?: unknown;
  file_path?: unknown;
}

export function toolCategory(name: string, input: ToolInput): BusyCategory {
  if (isEditTool(name)) return CATEGORY.edit;
  if (name === READ_TOOL && typeof input.file_path === 'string') {
    return isFrameworkReread(input.file_path) ? CATEGORY.frameworkReread : CATEGORY.other;
  }
  if (name === BASH_TOOL && typeof input.command === 'string') {
    return classifyBashCommand(input.command);
  }
  return CATEGORY.other;
}

export function roleForAgentType(agentType: string | null | undefined): AgentRole {
  const identity = resolveAgentIdentity({ agentType });
  if (identity === ORCHESTRATOR_AGENT) return 'main';
  const name = stripPluginAgentNamespace(identity);
  const stage = stageForAgentName(name);
  if (stage !== null && (AGENT_ORDER as readonly string[]).includes(stage)) {
    return stage as AgentRole;
  }
  if (name === EXPERT_AGENT_NAME) return 'expert';
  if (name === CHIEF_ARCHITECT_AGENT_NAME) return 'chief-architect';
  if (name === 'Explore') return 'Explore';
  return 'other';
}

export function roleRank(role: AgentRole): number {
  return AGENT_ORDER.indexOf(role);
}

export function ownerColumn(role: AgentRole): OwnerColumn {
  if (role === 'development') return 'development';
  if (CEREMONY_ROLES.has(role)) return 'ceremony';
  if (role === 'main') return 'orchestrator';
  return 'other';
}

export function lineCount(text: string): number {
  if (text.length === 0) return 0;
  const body = text.endsWith('\n') ? text.slice(0, -1) : text;
  return body.split('\n').length;
}

export function isOutsidePaqadDir(filePath: string): boolean {
  return !/(^|[\\/])\.paqad([\\/]|$)/.test(filePath);
}
