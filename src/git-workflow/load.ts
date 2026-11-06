import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import YAML from 'yaml';

import { PATHS } from '@/core/constants/paths.js';
import type { TicketProviderKind } from '@/core/types/project-profile.js';
import branchesSchema from '@/validators/schemas/git-workflow/branches.schema.json';
import commitsSchema from '@/validators/schemas/git-workflow/commits.schema.json';
import designSignOffSchema from '@/validators/schemas/git-workflow/design-sign-off.schema.json';
import enforcementSchema from '@/validators/schemas/git-workflow/enforcement.schema.json';
import pullRequestsSchema from '@/validators/schemas/git-workflow/pull-requests.schema.json';
import ticketsSchema from '@/validators/schemas/git-workflow/tickets.schema.json';
import { SchemaValidator } from '@/validators/validator.js';

import { DEFAULT_TRACKER_PATTERNS, defaultGitWorkflow } from './defaults.js';
import {
  GIT_WORKFLOW_FILES,
  type ApproveBy,
  type BranchType,
  type DesignSignOffLane,
  type GitWorkflowFile,
  type GitWorkflowIssue,
  type GitWorkflowLoadResult,
  type ResolvedGitWorkflow,
  type TicketSource,
} from './types.js';

type Raw = Record<string, unknown>;

export interface SchemaNode {
  $id?: string;
  properties?: Record<string, SchemaNode>;
  additionalProperties?: boolean | SchemaNode;
  type?: string;
}

export const GIT_WORKFLOW_SCHEMAS: Readonly<Record<GitWorkflowFile, SchemaNode>> = {
  'tickets.yaml': ticketsSchema as SchemaNode,
  'branches.yaml': branchesSchema as SchemaNode,
  'commits.yaml': commitsSchema as SchemaNode,
  'pull-requests.yaml': pullRequestsSchema as SchemaNode,
  'enforcement.yaml': enforcementSchema as SchemaNode,
  'design-sign-off.yaml': designSignOffSchema as SchemaNode,
};

export function gitWorkflowDir(projectRoot: string): string {
  return join(projectRoot, PATHS.GIT_WORKFLOW_DIR);
}

export function gitWorkflowFilePath(projectRoot: string, file: GitWorkflowFile): string {
  return join(gitWorkflowDir(projectRoot), file);
}

export type GitWorkflowContents = Partial<Record<GitWorkflowFile, string>>;

export function readGitWorkflowContents(projectRoot: string): GitWorkflowContents {
  const contents: GitWorkflowContents = {};
  for (const file of GIT_WORKFLOW_FILES) {
    const path = gitWorkflowFilePath(projectRoot, file);
    if (existsSync(path)) contents[file] = readFileSync(path, 'utf8');
  }
  return contents;
}

export function loadGitWorkflow(projectRoot: string): GitWorkflowLoadResult {
  const result = resolveGitWorkflow(readGitWorkflowContents(projectRoot));
  const source = existsSync(gitWorkflowDir(projectRoot)) ? 'git-workflow' : 'defaults';
  return { ...result, source };
}

export function resolveGitWorkflow(
  contents: GitWorkflowContents,
): Omit<GitWorkflowLoadResult, 'source'> {
  const errors: GitWorkflowIssue[] = [];
  const warnings: GitWorkflowIssue[] = [];
  const raw: Partial<Record<GitWorkflowFile, Raw>> = {};
  const validator = new SchemaValidator();

  for (const file of GIT_WORKFLOW_FILES) {
    const text = contents[file];
    if (text === undefined) continue;
    let parsed: unknown;
    try {
      parsed = YAML.parse(text) ?? {};
    } catch (error) {
      errors.push({
        file,
        path: '',
        message: `${file} isn't valid YAML: ${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }
    if (!isRecord(parsed)) {
      errors.push({
        file,
        path: '',
        message: `${file} must hold settings, not a list or a value.`,
      });
      continue;
    }
    const validation = validator.validate(GIT_WORKFLOW_SCHEMAS[file].$id ?? '', parsed);
    for (const issue of validation.errors) {
      const path = dotted(issue.path);
      errors.push({ file, path, message: `${file} ${path || '(top level)'} ${issue.message}.` });
    }
    for (const path of unknownKeys(parsed, GIT_WORKFLOW_SCHEMAS[file], [])) {
      warnings.push({
        file,
        path,
        message: `${file} has a setting paqad doesn't know: ${path}. It may be from a newer paqad or a typo.`,
      });
    }
    if (validation.valid) raw[file] = parsed;
  }

  const branchesRaw = raw['branches.yaml'] ?? {};
  const base = stringOr(branchesRaw.base_branch, defaultGitWorkflow().branches.base_branch);
  const config = mergeGitWorkflow(defaultGitWorkflow(base), raw);
  if (errors.length === 0) errors.push(...crossFileErrors(config, raw));
  return { config, valid: errors.length === 0, errors, warnings };
}

function mergeGitWorkflow(
  defaults: ResolvedGitWorkflow,
  raw: Partial<Record<GitWorkflowFile, Raw>>,
): ResolvedGitWorkflow {
  const t = raw['tickets.yaml'] ?? {};
  const b = raw['branches.yaml'] ?? {};
  const c = raw['commits.yaml'] ?? {};
  const p = raw['pull-requests.yaml'] ?? {};
  const e = raw['enforcement.yaml'] ?? {};
  const s = raw['design-sign-off.yaml'] ?? {};

  const template = stringOr(b.template, defaults.branches.template);
  const base = defaults.branches.base_branch;
  const rawTypes = isRecord(b.types) ? b.types : null;
  const types: Record<string, BranchType> = {};
  for (const [name, value] of Object.entries(rawTypes ?? defaults.branches.types)) {
    const entry = rawTypes ? (isRecord(value) ? value : {}) : (value as unknown as Raw);
    types[name] = resolveBranchType(name, rawTypes ? entry : pickTypeBasics(entry), base, template);
  }

  const sources: Record<string, TicketSource> = {};
  for (const [name, value] of Object.entries(isRecord(t.sources) ? t.sources : {})) {
    sources[name] = resolveSource(isRecord(value) ? value : {});
  }

  const intake = isRecord(t.intake_decisions) ? t.intake_decisions : {};
  const summary = isRecord(c.summary) ? c.summary : {};
  const ci = isRecord(p.ci) ? p.ci : {};
  const dt = defaults.tickets;
  const dp = defaults.pull_requests;

  return {
    tickets: {
      require_ticket: boolOr(t.require_ticket, dt.require_ticket),
      sources,
      write_back_refined:
        (t.write_back_refined as typeof dt.write_back_refined | undefined) ?? dt.write_back_refined,
      intake_decisions: {
        ...dt.intake_decisions,
        ...(intake as Partial<typeof dt.intake_decisions>),
      },
    },
    branches: {
      base_branch: base,
      template,
      slug_max_length: numberOr(b.slug_max_length, defaults.branches.slug_max_length),
      types,
      default_type: stringOr(b.default_type, defaults.branches.default_type),
    },
    commits: {
      template: stringOr(c.template, defaults.commits.template),
      sign_off: boolOr(c.sign_off, defaults.commits.sign_off),
      ask_when_unspecified: boolOr(c.ask_when_unspecified, defaults.commits.ask_when_unspecified),
      summary: {
        style: (summary.style as 'plain' | 'free' | undefined) ?? defaults.commits.summary.style,
        max_length: numberOr(summary.max_length, defaults.commits.summary.max_length),
      },
    },
    pull_requests: {
      host: (p.host as typeof dp.host | undefined) ?? dp.host,
      host_server: stringOr(p.host_server, dp.host_server, true),
      title_template: stringOr(p.title_template, dp.title_template),
      body_template: stringOr(p.body_template, dp.body_template),
      draft: boolOr(p.draft, dp.draft),
      reviewers: stringList(p.reviewers, dp.reviewers),
      labels: stringList(p.labels, dp.labels),
      link_ticket: boolOr(p.link_ticket, dp.link_ticket),
      also_open_against: stringList(p.also_open_against, dp.also_open_against),
      ci: {
        gate: (ci.gate as typeof dp.ci.gate | undefined) ?? dp.ci.gate,
        timeout_minutes: numberOr(ci.timeout_minutes, dp.ci.timeout_minutes),
        on_red: (ci.on_red as typeof dp.ci.on_red | undefined) ?? dp.ci.on_red,
      },
    },
    enforcement: {
      enabled: boolOr(e.enabled, defaults.enforcement.enabled),
      agents: (e.agents as 'warn' | 'block' | undefined) ?? defaults.enforcement.agents,
      people: (e.people as 'warn' | 'block' | 'off' | undefined) ?? defaults.enforcement.people,
    },
    design_sign_off: resolveDesignSignOff(s, defaults.design_sign_off),
  };
}

function resolveDesignSignOff(
  raw: Raw,
  defaults: ResolvedGitWorkflow['design_sign_off'],
): ResolvedGitWorkflow['design_sign_off'] {
  const channel = isRecord(raw.approval_channel) ? raw.approval_channel : {};
  const format = isRecord(raw.format) ? raw.format : {};
  return {
    enabled: boolOr(raw.enabled, defaults.enabled),
    lanes: stringList(raw.lanes, defaults.lanes) as DesignSignOffLane[],
    approval_channel: {
      server: stringOr(channel.server, defaults.approval_channel.server, true),
      channel: stringOr(channel.channel, defaults.approval_channel.channel, true),
    },
    format: {
      summary_max_words: numberOr(format.summary_max_words, defaults.format.summary_max_words),
      detail_max_words: numberOr(format.detail_max_words, defaults.format.detail_max_words),
    },
    wait_for_approval: boolOr(raw.wait_for_approval, defaults.wait_for_approval),
    approve_by: (raw.approve_by as ApproveBy | undefined) ?? defaults.approve_by,
    approve_words: stringList(raw.approve_words, defaults.approve_words),
    approvers: stringList(raw.approvers, defaults.approvers),
    move_to_on_post: stringOr(raw.move_to_on_post, defaults.move_to_on_post, true),
    approved_status: stringOr(raw.approved_status, defaults.approved_status, true),
    allow_skip_with_reason: boolOr(raw.allow_skip_with_reason, defaults.allow_skip_with_reason),
  };
}

function pickTypeBasics(entry: Raw): Raw {
  return { prefix: entry.prefix, commit_type: entry.commit_type };
}

function resolveBranchType(name: string, raw: Raw, base: string, template: string): BranchType {
  return {
    prefix: stringOr(raw.prefix, name),
    commit_type: stringOr(raw.commit_type, name),
    tickets: stringList(raw.tickets, []),
    ticket_types: stringList(raw.ticket_types, []),
    base_branch: stringOr(raw.base_branch, base),
    labels: stringList(raw.labels, []),
    template: stringOr(raw.template, template),
  };
}

function resolveSource(raw: Raw): TicketSource {
  const tracker = raw.tracker as TicketProviderKind;
  const transitions = isRecord(raw.transitions) ? raw.transitions : {};
  return {
    tracker,
    pattern: stringOr(raw.pattern, DEFAULT_TRACKER_PATTERNS[tracker] ?? ''),
    server: stringOr(raw.server, '', true),
    transitions: {
      on_pr_open: stringOr(transitions.on_pr_open, '', true),
      on_ci_green: stringOr(transitions.on_ci_green, '', true),
    },
  };
}

function crossFileErrors(
  config: ResolvedGitWorkflow,
  raw: Partial<Record<GitWorkflowFile, Raw>>,
): GitWorkflowIssue[] {
  const errors: GitWorkflowIssue[] = [];
  const sources = config.tickets.sources;
  const types = config.branches.types;
  const sourceNames = Object.keys(sources);

  for (const [name, type] of Object.entries(types)) {
    for (const source of type.tickets) {
      if (!sourceNames.includes(source)) {
        errors.push({
          file: 'branches.yaml',
          path: `types.${name}.tickets`,
          message: `branches.yaml types.${name}.tickets names "${source}", which isn't a source in tickets.yaml.`,
        });
      }
    }
  }

  if (!Object.prototype.hasOwnProperty.call(types, config.branches.default_type)) {
    errors.push({
      file: 'branches.yaml',
      path: 'default_type',
      message: `branches.yaml default_type is "${config.branches.default_type}", but there's no branch type with that name.`,
    });
  }

  const byPrefix = new Map<string, string>();
  for (const [name, type] of Object.entries(types)) {
    const other = byPrefix.get(type.prefix);
    if (other !== undefined) {
      errors.push({
        file: 'branches.yaml',
        path: `types.${name}.prefix`,
        message: `branches.yaml types.${name}.prefix "${type.prefix}" is already used by types.${other}. Each type needs its own prefix.`,
      });
    } else {
      byPrefix.set(type.prefix, name);
    }
  }

  const ticketsRaw = raw['tickets.yaml'];
  const rawSources = ticketsRaw && isRecord(ticketsRaw.sources) ? ticketsRaw.sources : {};
  for (const [name, source] of Object.entries(sources)) {
    const rawSource = isRecord(rawSources[name]) ? rawSources[name] : {};
    if (source.tracker === 'generic' && typeof rawSource.pattern !== 'string') {
      errors.push({
        file: 'tickets.yaml',
        path: `sources.${name}.pattern`,
        message: `tickets.yaml sources.${name} is a generic source, so it needs a pattern.`,
      });
      continue;
    }
    try {
      new RegExp(source.pattern);
    } catch (error) {
      errors.push({
        file: 'tickets.yaml',
        path: `sources.${name}.pattern`,
        message: `tickets.yaml sources.${name}.pattern isn't a valid regular expression: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  if (config.tickets.require_ticket && sourceNames.length === 0) {
    errors.push({
      file: 'tickets.yaml',
      path: 'require_ticket',
      message:
        'tickets.yaml require_ticket is true, but there are no sources to match a ticket against.',
    });
  }

  return errors;
}

export function unknownKeys(value: Raw, schema: SchemaNode, path: string[]): string[] {
  const found: string[] = [];
  const properties = schema.properties ?? {};
  const additional = schema.additionalProperties;
  for (const [key, child] of Object.entries(value)) {
    const childSchema = properties[key] ?? (typeof additional === 'object' ? additional : null);
    if (!childSchema) {
      found.push([...path, key].join('.'));
      continue;
    }
    const nested =
      childSchema.properties !== undefined || typeof childSchema.additionalProperties === 'object';
    if (isRecord(child) && nested) found.push(...unknownKeys(child, childSchema, [...path, key]));
  }
  return found;
}

function dotted(pointer: string): string {
  return pointer === '/' ? '' : pointer.replace(/^\//, '').split('/').join('.');
}

function isRecord(value: unknown): value is Raw {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringOr(value: unknown, fallback: string, allowEmpty = false): string {
  return typeof value === 'string' && (allowEmpty || value !== '') ? value : fallback;
}

function boolOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function stringList(value: unknown, fallback: string[]): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string')
    : [...fallback];
}
