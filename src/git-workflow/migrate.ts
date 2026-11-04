import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import YAML from 'yaml';

import { PATHS } from '@/core/constants/paths.js';
import type { TicketProviderKind } from '@/core/types/project-profile.js';

import {
  DEFAULT_TRACKER_PATTERNS,
  removeAiAttributionComment,
  renderDefaultGitWorkflowFile,
} from './defaults.js';
import { stampLastApplied } from './last-applied.js';
import { gitWorkflowDir, gitWorkflowFilePath } from './load.js';
import { remoteDefaultBranch } from './onboard.js';
import { GIT_WORKFLOW_FILES, type GitWorkflowFile } from './types.js';
import { insertKey, setValue } from './yaml-edit.js';

declare const __PKG_VERSION__: string;

export const OLD_DELIVERY_POLICY = `${PATHS.WORKFLOWS_DIR}/delivery-policy.yaml`;

export const MOVED_MESSAGE =
  "Moved your delivery rules to .paqad/configs/git-workflow/. Check the result and commit it with the old file's removal.";

export const UNREADABLE_MESSAGE = `Couldn't read ${OLD_DELIVERY_POLICY}, so .paqad/configs/git-workflow/ starts from defaults. Copy your settings across by hand, then delete the old file.`;

export const COMMENT_DECISIONS_LINE =
  'comment_decisions is no longer used. The design sign-off replaces it.';

type Plain = Record<string, unknown>;

const OLD_DEFAULTS = {
  enabled: true,
  ticket: {
    provider: 'jira',
    server: '',
    require_ticket: false,
    write_back_refined: 'ask',
  },
  host: { provider: 'github', server: '' },
  branch: {
    template: '{type}/{ticket}-{title_slug}',
    type_map: { Story: 'feat', Bug: 'fix', Task: 'chore', default: 'feat' } as Record<
      string,
      string
    >,
    slug_max_length: 50,
    base: 'main',
  },
  commit: {
    template: '{type}({scope}): {summary}\n\nRefs: {ticket}',
    sign_off: false,
    ask_when_unspecified: true,
  },
  pr: {
    title_template: '{type}({scope}): {summary} [{ticket}]',
    body_template_path: '.paqad/templates/pr-body.md',
    base: 'main',
    draft: false,
    reviewers: [] as string[],
    labels: [] as string[],
    link_ticket: true,
    transition_on_open: 'In Review',
  },
  ci: { gate: 'wait_for_green', timeout_minutes: 30, on_red: 'stop', transition_on_green: 'Done' },
  intake_decisions: {
    auto_resolve_from_priors: true,
    auto_resolve_from_rules: true,
    confirm_auto_resolutions: 'batched',
    max_options_per_packet: 4,
    fingerprint_scope: ['ticket_type', 'module', 'category'],
  },
};

export interface MigrationResult {
  ran: boolean;
  lines: string[];
  written: string[];
  deleted: boolean;
}

export interface MigrateOptions {
  version?: string;
  baseBranch?: string;
  now?: () => Date;
}

function isPlain(value: unknown): value is Plain {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function section(raw: Plain, name: string): Plain {
  const process = isPlain(raw.process) ? raw.process : {};
  return isPlain(process[name]) ? (process[name] as Plain) : {};
}

function pick<T>(raw: Plain, key: string, fallback: T): T {
  return raw[key] === undefined ? fallback : (raw[key] as T);
}

export function oldFileReadable(raw: unknown): raw is Plain {
  if (!isPlain(raw)) return false;
  if (raw.enabled !== undefined && typeof raw.enabled !== 'boolean') return false;
  if (raw.process !== undefined && !isPlain(raw.process)) return false;
  const process = isPlain(raw.process) ? raw.process : {};
  return Object.values(process).every((value) => value === undefined || isPlain(value));
}

export interface ConvertedFiles {
  files: Record<GitWorkflowFile, string>;
  lines: string[];
}

export function convertDeliveryPolicy(
  raw: Plain,
  options: { version: string; baseBranch: string },
): ConvertedFiles {
  const lines: string[] = [];
  const ticket = section(raw, 'ticket');
  const host = section(raw, 'host');
  const branch = section(raw, 'branch');
  const commit = section(raw, 'commit');
  const pr = section(raw, 'pr');
  const ci = section(raw, 'ci');
  const intake = section(raw, 'intake_decisions');
  const d = OLD_DEFAULTS;

  const render = (file: GitWorkflowFile) =>
    renderDefaultGitWorkflowFile(file, {
      version: options.version,
      baseBranch: options.baseBranch,
    });

  let tickets = render('tickets.yaml');
  const provider = pick(ticket, 'provider', d.ticket.provider) as TicketProviderKind;
  const source: Plain = { tracker: provider };
  const defaultPattern = DEFAULT_TRACKER_PATTERNS[provider];
  if (defaultPattern === null || defaultPattern === undefined) {
    source.pattern = '.+';
    lines.push(
      `tickets.yaml sources.${provider} has pattern ".+", which matches anything. Set a real pattern for your ticket keys.`,
    );
  } else {
    source.pattern = defaultPattern;
  }
  const server = pick(ticket, 'server', d.ticket.server);
  if (server) source.server = server;
  const transitions: Plain = {};
  const onOpen = pick(pr, 'transition_on_open', d.pr.transition_on_open);
  const onGreen = pick(ci, 'transition_on_green', d.ci.transition_on_green);
  if (onOpen) transitions.on_pr_open = onOpen;
  if (onGreen) transitions.on_ci_green = onGreen;
  if (Object.keys(transitions).length > 0) source.transitions = transitions;
  tickets = setValue(tickets, ['sources'], { [provider]: source });
  tickets = setValue(
    tickets,
    ['require_ticket'],
    pick(ticket, 'require_ticket', d.ticket.require_ticket),
  );
  tickets = setValue(
    tickets,
    ['write_back_refined'],
    pick(ticket, 'write_back_refined', d.ticket.write_back_refined),
  );
  for (const [key, fallback] of Object.entries(d.intake_decisions)) {
    tickets = setValue(tickets, ['intake_decisions', key], pick(intake, key, fallback));
  }
  if (ticket.comment_decisions !== undefined) lines.push(COMMENT_DECISIONS_LINE);

  let branches = render('branches.yaml');
  const branchBase = pick(branch, 'base', d.branch.base);
  const prBase = pick(pr, 'base', d.pr.base);
  if (branch.base !== undefined && pr.base !== undefined && branchBase !== prBase) {
    lines.push(`branch.base and pr.base differed; kept pr.base (${prBase}).`);
  }
  branches = setValue(branches, ['base_branch'], pr.base !== undefined ? prBase : branchBase);
  const template = String(pick(branch, 'template', d.branch.template)).replaceAll(
    '{type}',
    '{prefix}',
  );
  branches = setValue(branches, ['template'], template);
  branches = setValue(
    branches,
    ['slug_max_length'],
    pick(branch, 'slug_max_length', d.branch.slug_max_length),
  );
  const typeMap: Record<string, string> = {
    ...d.branch.type_map,
    ...(isPlain(branch.type_map) ? (branch.type_map as Record<string, string>) : {}),
  };
  const types: Record<string, Plain> = {};
  for (const [ticketType, value] of Object.entries(typeMap)) {
    const entry = (types[value] ??= { prefix: value, commit_type: value, ticket_types: [] });
    if (ticketType !== 'default') (entry.ticket_types as string[]).push(ticketType);
  }
  const defaultType = typeMap.default ?? 'feat';
  types[defaultType] ??= { prefix: defaultType, commit_type: defaultType, ticket_types: [] };
  for (const entry of Object.values(types)) {
    if ((entry.ticket_types as string[]).length === 0) delete entry.ticket_types;
  }
  branches = setValue(branches, ['types'], types);
  branches = setValue(branches, ['default_type'], defaultType);

  let commits = render('commits.yaml');
  commits = setValue(commits, ['template'], pick(commit, 'template', d.commit.template));
  commits = setValue(commits, ['sign_off'], pick(commit, 'sign_off', d.commit.sign_off));
  commits = setValue(
    commits,
    ['ask_when_unspecified'],
    pick(commit, 'ask_when_unspecified', d.commit.ask_when_unspecified),
  );

  let pulls = render('pull-requests.yaml');
  pulls = setValue(pulls, ['host'], pick(host, 'provider', d.host.provider));
  pulls = setValue(pulls, ['host_server'], pick(host, 'server', d.host.server));
  for (const key of ['title_template', 'draft', 'reviewers', 'labels', 'link_ticket'] as const) {
    pulls = setValue(pulls, [key], pick(pr, key, d.pr[key]));
  }
  pulls = setValue(
    pulls,
    ['body_template'],
    pick(pr, 'body_template_path', d.pr.body_template_path),
  );
  for (const key of ['gate', 'timeout_minutes', 'on_red'] as const) {
    pulls = setValue(pulls, ['ci', key], pick(ci, key, d.ci[key]));
  }

  let enforcement = render('enforcement.yaml');
  enforcement = setValue(enforcement, ['enabled'], pick(raw, 'enabled', d.enabled));

  return {
    files: {
      'tickets.yaml': tickets,
      'branches.yaml': branches,
      'commits.yaml': commits,
      'pull-requests.yaml': pulls,
      'enforcement.yaml': enforcement,
    },
    lines,
  };
}

const NOT_GIT_WORKFLOW_KEYS = new Set(['paqad_version', 'ai_attribution']);

function readSettings(path: string): Plain | null {
  if (!existsSync(path)) return null;
  try {
    const parsed: unknown = YAML.parse(readFileSync(path, 'utf8'));
    return isPlain(parsed) ? parsed : {};
  } catch {
    return { unreadable: true };
  }
}

export function gitWorkflowFilesAbsent(projectRoot: string): boolean {
  return GIT_WORKFLOW_FILES.every((file) => {
    const settings = readSettings(gitWorkflowFilePath(projectRoot, file));
    return (
      settings === null || Object.keys(settings).every((key) => NOT_GIT_WORKFLOW_KEYS.has(key))
    );
  });
}

function keepAiAttribution(projectRoot: string, files: Record<GitWorkflowFile, string>): void {
  const kept = readSettings(gitWorkflowFilePath(projectRoot, 'commits.yaml'))?.ai_attribution;
  if (kept !== undefined) {
    files['commits.yaml'] = insertKey(
      removeAiAttributionComment(files['commits.yaml']),
      [],
      'ai_attribution',
      kept,
    );
  }
}

export function migrateDeliveryPolicy(
  projectRoot: string,
  options: MigrateOptions = {},
): MigrationResult {
  const oldPath = join(projectRoot, OLD_DELIVERY_POLICY);
  if (!existsSync(oldPath) || !gitWorkflowFilesAbsent(projectRoot)) {
    return { ran: false, lines: [], written: [], deleted: false };
  }
  const version = options.version ?? __PKG_VERSION__;
  const baseBranch = options.baseBranch ?? remoteDefaultBranch(projectRoot);

  let raw: unknown;
  try {
    raw = YAML.parse(readFileSync(oldPath, 'utf8')) ?? {};
  } catch {
    raw = null;
  }

  mkdirSync(gitWorkflowDir(projectRoot), { recursive: true });
  const written: string[] = [];
  if (!oldFileReadable(raw)) {
    for (const file of GIT_WORKFLOW_FILES) {
      const path = gitWorkflowFilePath(projectRoot, file);
      writeFileSync(path, renderDefaultGitWorkflowFile(file, { version, baseBranch }), 'utf8');
      written.push(path);
    }
    stampLastApplied(projectRoot, GIT_WORKFLOW_FILES, { version, now: options.now });
    return { ran: true, lines: [UNREADABLE_MESSAGE], written, deleted: false };
  }

  const converted = convertDeliveryPolicy(raw, { version, baseBranch });
  keepAiAttribution(projectRoot, converted.files);
  const lines: string[] = [];
  for (const file of GIT_WORKFLOW_FILES) {
    const path = gitWorkflowFilePath(projectRoot, file);
    writeFileSync(path, converted.files[file], 'utf8');
    written.push(path);
    lines.push(`Moved delivery rules into ${PATHS.GIT_WORKFLOW_DIR}/${file}.`);
  }
  stampLastApplied(projectRoot, GIT_WORKFLOW_FILES, { version, now: options.now });
  rmSync(oldPath);
  return {
    ran: true,
    lines: [...lines, ...converted.lines, MOVED_MESSAGE],
    written,
    deleted: true,
  };
}
