import { PATHS } from '@/core/constants/paths.js';
import { templateToRegExp, ticketOptional } from '@/git-workflow/patterns.js';
import { checkSummaryStyle, summaryStyleMessage } from '@/git-workflow/summary-style.js';
import type { ResolvedGitWorkflow, TicketSource } from '@/git-workflow/types.js';
import type { HostStepResult, OpenPrInput, PullRequest } from '@/providers/host-provider.js';

export type OpenPullRequest = (
  input: OpenPrInput,
) => Promise<HostStepResult & { pr?: PullRequest }>;

export interface DeliveryShell {
  run(
    command: string,
    args: string[],
  ): Promise<{ stdout: string; stderr: string; exitCode: number }>;
}

export const GIT_WORKFLOW_PATH = PATHS.GIT_WORKFLOW_DIR;

export type StepResult<T> = { ok: true; value: T } | { ok: false; message: string };

function stop<T>(message: string): StepResult<T> {
  return { ok: false, message };
}

function done<T>(value: T): StepResult<T> {
  return { ok: true, value };
}

export interface MatchedSource {
  name: string;
  source: TicketSource;
}

function wholeMatch(pattern: string, ref: string): boolean {
  try {
    return new RegExp(`^(?:${pattern})$`).test(ref);
  } catch {
    return false;
  }
}

export function requireTicket(config: ResolvedGitWorkflow, ticket: string): StepResult<null> {
  if (config.tickets.require_ticket && ticket.trim() === '') {
    return stop(
      "This team's git workflow needs a ticket for every change. Re-run with --ticket <ref>.",
    );
  }
  return done(null);
}

export function matchTicketSource(
  config: ResolvedGitWorkflow,
  ticket: string,
): StepResult<MatchedSource | null> {
  const sources = Object.entries(config.tickets.sources);
  if (ticket.trim() === '' || sources.length === 0) return done(null);
  const found = sources.find(([, source]) => wholeMatch(source.pattern, ticket));
  if (found) return done({ name: found[0], source: found[1] });
  const list = sources.map(([name, source]) => `${name}: ${source.pattern}`).join(', ');
  return stop(
    `${ticket} doesn't look like any ticket this team uses (${list}). Check the key or add a source in ${GIT_WORKFLOW_PATH}/tickets.yaml.`,
  );
}

export function branchPattern(config: ResolvedGitWorkflow, typeName: string) {
  const type = config.branches.types[typeName];
  return templateToRegExp(type?.template ?? config.branches.template, config, {
    optional: ticketOptional(config),
    branch: true,
    prefixes: type ? [type.prefix] : undefined,
  });
}

export function typeOfBranch(config: ResolvedGitWorkflow, branch: string): string[] {
  return Object.keys(config.branches.types).filter((name) =>
    branchPattern(config, name).test(branch),
  );
}

export interface PickTypeInput {
  type?: string;
  source: string | null;
  ticketType?: string;
  ticketGiven: boolean;
  currentBranch: string | null;
}

function allows(config: ResolvedGitWorkflow, typeName: string, source: string | null): boolean {
  const tickets = config.branches.types[typeName]?.tickets ?? [];
  return source === null || tickets.length === 0 || tickets.includes(source);
}

export function pickBranchType(
  config: ResolvedGitWorkflow,
  input: PickTypeInput,
): StepResult<string> {
  const names = Object.keys(config.branches.types);
  if (input.type) {
    if (!names.includes(input.type)) {
      return stop(
        `There's no branch type called ${input.type}. This team's types are: ${names.join(', ')}.`,
      );
    }
    return done(input.type);
  }
  if (input.source) {
    const bySource = names.filter((name) =>
      config.branches.types[name].tickets.includes(input.source as string),
    );
    if (bySource.length === 1) return done(bySource[0]);
  }
  if (input.ticketType) {
    const byTicketType = names.filter((name) =>
      config.branches.types[name].ticket_types.includes(input.ticketType as string),
    );
    if (byTicketType.length === 1) return done(byTicketType[0]);
  }
  if (input.currentBranch) {
    const byBranch = typeOfBranch(config, input.currentBranch);
    if (byBranch.length === 1) return done(byBranch[0]);
  }
  const fallback = config.branches.default_type;
  if (!input.ticketGiven || allows(config, fallback, input.source)) return done(fallback);
  const candidates = names.filter((name) => allows(config, name, input.source));
  return stop(
    `This change could be ${(candidates.length > 0 ? candidates : names).join(', ')}. Re-run with --type <name>.`,
  );
}

export function compareVersions(a: string, b: string): number {
  const split = (value: string) => value.split(/[.-]/);
  const pa = split(a);
  const pb = split(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const x = pa[i];
    const y = pb[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = Number(x);
    const ny = Number(y);
    if (Number.isInteger(nx) && Number.isInteger(ny) && nx !== ny) return nx - ny;
    if (!(Number.isInteger(nx) && Number.isInteger(ny)) && x !== y) return x < y ? -1 : 1;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

export function highestVersionBranch(branches: string[]): string | null {
  const last = (name: string) => name.split('/').pop() ?? name;
  return (
    [...branches].sort((a, b) => compareVersions(last(a), last(b)) || (a < b ? -1 : 1)).pop() ??
    null
  );
}

export function isGlob(base: string): boolean {
  return base.includes('*');
}

export function globMatches(glob: string, name: string): boolean {
  const source = glob
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${source}$`).test(name);
}

export async function resolveBase(shell: DeliveryShell, base: string): Promise<StepResult<string>> {
  if (!isGlob(base)) return done(base);
  const listed = await shell.run('git', ['ls-remote', '--heads', 'origin', base]);
  const names =
    listed.exitCode === 0
      ? listed.stdout
          .split('\n')
          .map((line) => line.trim().split(/\s+/)[1] ?? '')
          .filter((ref) => ref.startsWith('refs/heads/'))
          .map((ref) => ref.slice('refs/heads/'.length))
          .filter((name) => globMatches(base, name))
      : [];
  const picked = highestVersionBranch(names);
  return picked ? done(picked) : stop(`No branch on origin matches ${base}.`);
}

export function configuredBases(config: ResolvedGitWorkflow): string[] {
  return Array.from(
    new Set([
      config.branches.base_branch,
      ...Object.values(config.branches.types).map((type) => type.base_branch),
      ...config.pull_requests.also_open_against,
    ]),
  );
}

export function isConfiguredBase(config: ResolvedGitWorkflow, branch: string): boolean {
  return configuredBases(config).some((base) =>
    isGlob(base) ? globMatches(base, branch) : base === branch,
  );
}

export interface BranchPlan {
  branch: string;
  create: boolean;
}

export function planBranch(
  config: ResolvedGitWorkflow,
  current: string,
  base: string,
  rendered: string,
  typeName: string,
): StepResult<BranchPlan> {
  if (current === base) return done({ branch: rendered, create: true });
  if (typeOfBranch(config, current).length > 0) return done({ branch: current, create: false });
  if (isConfiguredBase(config, current)) {
    return stop(
      `You're on ${current}, but this change should start from ${base}. Switch to ${base} and re-run paqad-ai deliver.`,
    );
  }
  const template = config.branches.types[typeName]?.template ?? config.branches.template;
  return stop(
    `You're on ${current}, which doesn't follow this team's branch pattern ${template}. Switch to ${base} or rename the branch, then re-run paqad-ai deliver.`,
  );
}

export async function currentBranch(shell: DeliveryShell): Promise<string | null> {
  const result = await shell.run('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  const name = result.stdout.trim();
  return result.exitCode === 0 && name !== '' && name !== 'HEAD' ? name : null;
}

export async function hasStagedChanges(shell: DeliveryShell): Promise<boolean> {
  const result = await shell.run('git', ['diff', '--cached', '--quiet']);
  return result.exitCode === 1;
}

export async function commitsSince(shell: DeliveryShell, base: string): Promise<number> {
  for (const ref of [base, `origin/${base}`]) {
    const result = await shell.run('git', ['rev-list', '--count', `${ref}..HEAD`]);
    if (result.exitCode === 0) return Number.parseInt(result.stdout.trim(), 10) || 0;
  }
  return 0;
}

export interface StyleVerdict {
  block: boolean;
  messages: string[];
}

export function styleVerdict(
  config: ResolvedGitWorkflow,
  subject: string,
  template: string,
  what: 'commit' | 'PR title',
): StyleVerdict {
  const reasons = checkSummaryStyle(subject, template, config);
  return {
    block: reasons.length > 0 && config.enforcement.agents === 'block',
    messages: reasons.map((reason) => summaryStyleMessage(subject, reason, what)),
  };
}

export interface CommitStep {
  committed: boolean;
  output: string;
  warnings: string[];
}

export async function commitStep(
  shell: DeliveryShell,
  config: ResolvedGitWorkflow,
  message: string,
  options: { base: string | null; branch: string; requireWork: boolean },
): Promise<StepResult<CommitStep>> {
  const subject = message.split('\n')[0];
  if (await hasStagedChanges(shell)) {
    const style = styleVerdict(config, subject, config.commits.template, 'commit');
    if (style.block) return stop(style.messages[0]);
    const args = ['commit', ...(config.commits.sign_off ? ['-s'] : []), '-m', message];
    const result = await shell.run('git', args);
    if (result.exitCode !== 0) {
      return stop(
        `git commit failed: ${(result.stderr || result.stdout).trim() || 'unknown error'}. Fix it and re-run; do not skip pre-commit hooks.`,
      );
    }
    return done({ committed: true, output: result.stdout, warnings: style.messages });
  }
  if (!options.requireWork) {
    return stop('Nothing is staged. Stage your changes with git add first.');
  }
  if (options.base && (await commitsSince(shell, options.base)) > 0) {
    return done({ committed: false, output: '', warnings: [] });
  }
  return stop(
    `Nothing to deliver: no staged changes and no commits on ${options.branch} since ${options.base ?? 'the base'}.`,
  );
}

export function placeholdersIn(template: string): string[] {
  return Array.from(template.matchAll(/\{([a-z_]+)\}/g), (match) => match[1]);
}

export function markdownHeadings(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => /^#{1,6}\s+\S/.test(line));
}

export function missingHeadings(template: string, body: string): string[] {
  const present = new Set(markdownHeadings(body).map((line) => line.trim()));
  return markdownHeadings(template).filter((heading) => !present.has(heading.trim()));
}

export function linkTicket(
  body: string,
  ticket: string,
  matched: MatchedSource | null,
  enabled: boolean,
): string {
  if (!enabled || ticket.trim() === '' || body.includes(ticket)) return body;
  const line =
    matched?.source.tracker === 'github-issues'
      ? `Closes ${ticket.startsWith('#') ? ticket : `#${ticket}`}`
      : `Ticket: ${ticket}`;
  if (body.includes(line)) return body;
  const trimmed = body.replace(/\s+$/, '');
  return trimmed === '' ? `${line}\n` : `${trimmed}\n\n${line}\n`;
}

export function uniqueInOrder(...lists: string[][]): string[] {
  return Array.from(new Set(lists.flat().filter((value) => value !== '')));
}

export const MISSING_LABEL_HINT = `If a label is missing, create it on the repo or remove it from ${GIT_WORKFLOW_PATH}/pull-requests.yaml.`;
