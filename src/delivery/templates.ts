import { stripTrailingChars } from '@/core/path-utils.js';
import type { BranchType, ResolvedGitWorkflow } from '@/git-workflow/types.js';

export interface DeliveryRenderInputs {
  ticket: string;
  ticket_type?: string;
  title: string;
  summary: string;
  scope?: string;
  tech_debt?: string;
}

export interface RenderedDelivery {
  branch: string;
  commit: string;
  pr_title: string;
  pr_body: string;
}

export const TEMPLATE_PLACEHOLDERS = [
  'prefix',
  'type',
  'ticket',
  'title',
  'title_slug',
  'summary',
  'scope',
  'tech_debt',
] as const;

const PLACEHOLDER = /\{([a-z_]+)\}/g;
const SEPARATORS = new Set(['-', '_', ':', '/', '|', ' ']);

export function slugify(value: string, maxLength: number): string {
  const slug = value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug.length <= maxLength) {
    return slug;
  }
  return slug.slice(0, maxLength).replace(/-+$/, '');
}

export function resolveBranchTypeName(
  config: ResolvedGitWorkflow,
  ticketType: string | undefined,
): string {
  if (ticketType) {
    const match = Object.entries(config.branches.types).filter(([, type]) =>
      type.ticket_types.includes(ticketType),
    );
    if (match.length === 1) return match[0][0];
  }
  return config.branches.default_type;
}

function known(vars: Record<string, string>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(vars, key);
}

function placeholdersIn(line: string, vars: Record<string, string>): string[] {
  return Array.from(line.matchAll(PLACEHOLDER), (match) => match[1]).filter((key) =>
    known(vars, key),
  );
}

function dropEmptyLines(template: string, vars: Record<string, string>): string {
  const lines = template.split('\n');
  const kept = lines.filter((line, index) => {
    if (index === 0) return true;
    const keys = placeholdersIn(line, vars);
    return keys.length === 0 || keys.some((key) => vars[key] !== '');
  });
  while (kept.length > 1 && kept[kept.length - 1].trim() === '') kept.pop();
  return kept.join('\n');
}

function cleanEmptyPlaceholders(line: string, vars: Record<string, string>): string {
  let out = line;
  for (;;) {
    const match = Array.from(out.matchAll(PLACEHOLDER)).find(
      (m) => known(vars, m[1]) && vars[m[1]] === '',
    );
    if (!match || match.index === undefined) return out;
    const start = match.index;
    const end = start + match[0].length;
    let after = end;
    while (after < out.length && SEPARATORS.has(out[after])) after += 1;
    const rest = out
      .slice(end)
      .replace(PLACEHOLDER, (m, key: string) => (known(vars, key) && vars[key] === '' ? '' : m));
    if ([...rest].every((ch) => SEPARATORS.has(ch))) {
      let before = start;
      while (before > 0 && SEPARATORS.has(out[before - 1])) before -= 1;
      out = out.slice(0, before) + out.slice(end);
    } else {
      out = out.slice(0, start) + out.slice(after);
    }
  }
}

function removeEmptyBrackets(text: string): string {
  return text.replace(/ ?(\(\)|\[\])/g, '');
}

function cleanBranch(text: string): string {
  return text
    .replace(/-{2,}/g, '-')
    .replace(/\/{2,}/g, '/')
    .replace(/^[-_/]+|[-_/]+$/g, '');
}

export interface RenderOptions {
  branch?: boolean;
}

export function renderTemplate(
  template: string,
  vars: Record<string, string>,
  options: RenderOptions = {},
): string {
  const endsWithNewline = template.endsWith('\n');
  const lines = dropEmptyLines(template, vars)
    .split('\n')
    .map((line) => removeEmptyBrackets(cleanEmptyPlaceholders(line, vars)));
  let out = lines
    .join('\n')
    .replace(PLACEHOLDER, (match, key: string) => (known(vars, key) ? vars[key] : match));
  if (options.branch) out = cleanBranch(out);
  return endsWithNewline && !out.endsWith('\n') ? `${out}\n` : out;
}

function withTechDebt(template: string, body: string, section: string): string {
  if (section === '' || template.includes('{tech_debt}')) {
    return body;
  }
  const trimmed = stripTrailingChars(body, ' \t\r\n');
  return trimmed === '' ? `${section}\n` : `${trimmed}\n\n${section}\n`;
}

export function renderVars(
  config: ResolvedGitWorkflow,
  typeName: string,
  inputs: DeliveryRenderInputs,
): Record<string, string> {
  const branchType: BranchType | undefined = config.branches.types[typeName];
  return {
    prefix: branchType?.prefix ?? typeName,
    type: branchType?.commit_type ?? typeName,
    ticket: inputs.ticket || '',
    title: inputs.title,
    title_slug: slugify(inputs.title, config.branches.slug_max_length),
    summary: inputs.summary,
    scope: inputs.scope ?? '',
    tech_debt: inputs.tech_debt ?? '',
  };
}

export function renderBranchName(
  config: ResolvedGitWorkflow,
  typeName: string,
  inputs: DeliveryRenderInputs,
): string {
  const vars = renderVars(config, typeName, inputs);
  const template = config.branches.types[typeName]?.template ?? config.branches.template;
  return renderTemplate(
    template,
    { ...vars, ticket: vars.ticket.replace(/^#/, '') },
    { branch: true },
  );
}

export function renderDelivery(
  config: ResolvedGitWorkflow,
  inputs: DeliveryRenderInputs,
  prBodyTemplate: string,
  typeName: string = resolveBranchTypeName(config, inputs.ticket_type),
): RenderedDelivery {
  const vars = renderVars(config, typeName, inputs);
  return {
    branch: renderBranchName(config, typeName, inputs),
    commit: renderTemplate(config.commits.template, vars),
    pr_title: renderTemplate(config.pull_requests.title_template, vars),
    pr_body: withTechDebt(prBodyTemplate, renderTemplate(prBodyTemplate, vars), vars.tech_debt),
  };
}
