import type { ResolvedDeliveryProcess } from '@/core/types/delivery-policy.js';

/**
 * Inputs for delivery template rendering. The orchestrator gathers these
 * from the refined ticket (intake) and the delivery-policy `process:` block.
 */
export interface DeliveryRenderInputs {
  /** Ticket id like "PAQ-123" or "#42". Empty when no ticket was provided. */
  ticket: string;
  /** Ticket type ("Story", "Bug", "Task") that resolves to a conventional type. */
  ticket_type?: string;
  /** Human-readable title, used both for slug and PR title. */
  title: string;
  /** One-line summary for commit/PR body. */
  summary: string;
  /** Conventional commit scope (typically the module). Optional. */
  scope?: string;
}

export interface RenderedDelivery {
  branch: string;
  commit: string;
  pr_title: string;
  pr_body: string;
}

/**
 * Convert an arbitrary string to a URL-safe slug truncated to `maxLength`.
 * Strips diacritics-free characters and collapses runs of non-alphanumeric
 * runs into a single dash.
 */
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

/**
 * Resolves a conventional commit "type" (feat / fix / chore / …) from the
 * ticket type using the conventions.branch.type_map, falling back to
 * `type_map.default`.
 */
export function resolveConventionalType(
  ticketType: string | undefined,
  typeMap: Record<string, string>,
): string {
  if (ticketType && typeMap[ticketType]) {
    return typeMap[ticketType];
  }
  return typeMap.default ?? 'feat';
}

/**
 * Replace `{placeholder}` tokens in `template` with values from `vars`.
 * Unknown placeholders are left intact so we can detect them in tests.
 */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{([a-z_]+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : match,
  );
}

/**
 * Render the full delivery surface (branch name, commit, PR title, PR body)
 * from the delivery-policy `process:` block + inputs. PR body comes verbatim
 * from `process.pr.body_template_path` after substitution — the caller is
 * responsible for reading that file; this renderer accepts the loaded body
 * via `prBodyTemplate`.
 */
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
  };

  return {
    branch: renderTemplate(process.branch.template, vars),
    commit: renderTemplate(process.commit.template, vars),
    pr_title: renderTemplate(process.pr.title_template, vars),
    pr_body: renderTemplate(prBodyTemplate, vars),
  };
}
