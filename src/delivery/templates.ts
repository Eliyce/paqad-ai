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

export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{([a-z_]+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : match,
  );
}

function withTechDebt(template: string, body: string, section: string): string {
  if (section === '' || template.includes('{tech_debt}')) {
    return body;
  }
  const trimmed = stripTrailingChars(body, ' \t\r\n');
  return trimmed === '' ? `${section}\n` : `${trimmed}\n\n${section}\n`;
}

export function renderDelivery(
  config: ResolvedGitWorkflow,
  inputs: DeliveryRenderInputs,
  prBodyTemplate: string,
  typeName: string = resolveBranchTypeName(config, inputs.ticket_type),
): RenderedDelivery {
  const branchType: BranchType | undefined = config.branches.types[typeName];
  const type = branchType?.commit_type ?? typeName;
  const title_slug = slugify(inputs.title, config.branches.slug_max_length);
  const ticket = inputs.ticket || '';
  const scope = inputs.scope ?? type;

  const vars: Record<string, string> = {
    prefix: branchType?.prefix ?? typeName,
    type,
    ticket,
    title: inputs.title,
    title_slug,
    summary: inputs.summary,
    scope,
    tech_debt: inputs.tech_debt ?? '',
  };

  return {
    branch: renderTemplate(branchType?.template ?? config.branches.template, vars),
    commit: renderTemplate(config.commits.template, vars),
    pr_title: renderTemplate(config.pull_requests.title_template, vars),
    pr_body: withTechDebt(prBodyTemplate, renderTemplate(prBodyTemplate, vars), vars.tech_debt),
  };
}
