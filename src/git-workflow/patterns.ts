import { renderTemplate } from '@/delivery/templates.js';

import type { ResolvedGitWorkflow } from './types.js';

export type TemplatePlaceholder =
  'prefix' | 'type' | 'ticket' | 'title' | 'title_slug' | 'summary' | 'scope' | 'tech_debt';

export interface TemplatePatternOptions {
  optional?: TemplatePlaceholder[];
  branch?: boolean;
  prefixes?: string[];
  ticketCapture?: string;
}

export interface TemplateMatcher {
  patterns: RegExp[];
  test(text: string): boolean;
}

const PLACEHOLDERS: readonly TemplatePlaceholder[] = [
  'prefix',
  'type',
  'ticket',
  'title',
  'title_slug',
  'summary',
  'scope',
  'tech_debt',
];

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function alternation(values: string[], fallback: string): string {
  const unique = Array.from(new Set(values.filter((value) => value !== '')));
  return unique.length === 0 ? fallback : `(?:${unique.map(escapeRegExp).join('|')})`;
}

export function ticketPatterns(config: ResolvedGitWorkflow, branch = false): string[] {
  return Object.values(config.tickets.sources)
    .map((source) => source.pattern)
    .filter((pattern) => pattern !== '')
    .map((pattern) => (branch ? pattern.replace(/^#/, '') : pattern));
}

function pieces(
  config: ResolvedGitWorkflow,
  options: TemplatePatternOptions,
): Record<TemplatePlaceholder, string> {
  const types = Object.values(config.branches.types);
  const tickets = ticketPatterns(config, options.branch === true);
  return {
    prefix: alternation(options.prefixes ?? types.map((type) => type.prefix), '[^/\\s]+'),
    type: alternation(
      types.map((type) => type.commit_type),
      '\\w+',
    ),
    ticket:
      options.ticketCapture !== undefined
        ? `(?<ticket>${options.ticketCapture})`
        : tickets.length === 0
          ? '\\S+'
          : `(?:${tickets.map((p) => `(?:${p})`).join('|')})`,
    title_slug: '[a-z0-9]+(?:-[a-z0-9]+)*',
    scope: '[^()\\s]+',
    title: '.+',
    summary: '.+',
    tech_debt: '[\\s\\S]*',
  };
}

function subsets<T>(items: T[]): T[][] {
  return items.reduce<T[][]>(
    (all, item) => [...all, ...all.map((subset) => [...subset, item])],
    [[]],
  );
}

export function templateToRegExp(
  template: string,
  config: ResolvedGitWorkflow,
  options: TemplatePatternOptions = {},
): TemplateMatcher {
  const regexPieces = pieces(config, options);
  const present = PLACEHOLDERS.filter((key) => template.includes(`{${key}}`));
  const optional = (options.optional ?? []).filter((key) => present.includes(key));
  const patterns = subsets(optional).map((emptied) => {
    const vars: Record<string, string> = {};
    for (const key of PLACEHOLDERS) {
      vars[key] = emptied.includes(key) ? '' : `\uE000${key}\uE001`;
    }
    const rendered = renderTemplate(template, vars, { branch: options.branch === true });
    const source = rendered
      .split(/(\uE000[a-z_]+\uE001)/)
      .map((part) => {
        const key = /^\uE000([a-z_]+)\uE001$/.exec(part)?.[1] as TemplatePlaceholder | undefined;
        return key ? regexPieces[key] : escapeRegExp(part);
      })
      .join('');
    return new RegExp(`^${source}$`);
  });
  return { patterns, test: (text) => patterns.some((pattern) => pattern.test(text)) };
}

export function ticketOptional(config: ResolvedGitWorkflow): TemplatePlaceholder[] {
  return config.tickets.require_ticket ? ['scope'] : ['ticket', 'scope'];
}

export function firstLine(template: string): string {
  return template.split('\n')[0];
}
