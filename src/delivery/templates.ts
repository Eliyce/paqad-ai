import { stripTrailingChars } from '@/core/path-utils.js';
import type { ResolvedDeliveryProcess } from '@/core/types/delivery-policy.js';

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

export function resolveConventionalType(
  ticketType: string | undefined,
  typeMap: Record<string, string>,
): string {
  if (ticketType && typeMap[ticketType]) {
    return typeMap[ticketType];
  }
  return typeMap.default ?? 'feat';
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
  process: ResolvedDeliveryProcess,
  inputs: DeliveryRenderInputs,
  prBodyTemplate: string,
): RenderedDelivery {
  const type = resolveConventionalType(inputs.ticket_type, process.branch.type_map);
  const title_slug = slugify(inputs.title, process.branch.slug_max_length);
  const ticket = inputs.ticket || '';
  const scope = inputs.scope ?? type;

  const vars: Record<string, string> = {
    type,
    ticket,
    title: inputs.title,
    title_slug,
    summary: inputs.summary,
    scope,
    tech_debt: inputs.tech_debt ?? '',
  };

  return {
    branch: renderTemplate(process.branch.template, vars),
    commit: renderTemplate(process.commit.template, vars),
    pr_title: renderTemplate(process.pr.title_template, vars),
    pr_body: withTechDebt(prBodyTemplate, renderTemplate(prBodyTemplate, vars), vars.tech_debt),
  };
}
