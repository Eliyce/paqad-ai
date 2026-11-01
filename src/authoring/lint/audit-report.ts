import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

import { splitSkillFrontmatter } from '@/skills/frontmatter-parser.js';

import { readAuthoringConfig } from '../config.js';
import { readTextIfPresent } from '../fs-io.js';
import { expertCollisions, lensFocus, type ExpertProfile } from '../overlap.js';
import {
  AuditUsageError,
  lintAllAgents,
  lintAllSkills,
  type AgentAuditSources,
  type AuditItem,
  type AuditReport,
} from './audit.js';
import { compareText } from './runner.js';

export const AUDIT_DOC = 'docs/instructions/tech-debt/skill-agent-audit.md';
export const LENS_ROOT = 'runtime/base/skills/expert-notes/references/lenses';
export const NAMING_RULES: readonly string[] = ['SK-004', 'AG-002'];
const BEFORE_HEADING = '## Before';
const AFTER_HEADING = '## After';
const BODY_DATA = /<!-- audit-body-tokens (\{.*\}) -->/u;
const NOT_YET = 'Not generated yet. It is rewritten at the end of the change.';

export type AuditSection = 'before' | 'after';

export interface AuditDocInput {
  projectRoot: string;
  asOf: string;
  skills: AuditReport;
  agents: AuditReport;
  previous?: string | null;
  section?: AuditSection;
  exceptions?: ReadonlyMap<string, string>;
}

function cell(text: string | number): string {
  return String(text).replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function row(cells: ReadonlyArray<string | number>): string {
  return `| ${cells.map(cell).join(' | ')} |`;
}

function table(head: readonly string[], rows: ReadonlyArray<ReadonlyArray<string | number>>) {
  return [row(head), row(head.map(() => '---')), ...rows.map(row)];
}

function sum(items: readonly AuditItem[], pick: (item: AuditItem) => number): number {
  return items.reduce((total, item) => total + pick(item), 0);
}

function groupsOf(items: readonly AuditItem[]): Array<[string, AuditItem[]]> {
  const groups = new Map<string, AuditItem[]>();
  for (const item of items) groups.set(item.group, [...(groups.get(item.group) ?? []), item]);
  return [...groups.entries()].sort(([left], [right]) => compareText(left, right));
}

function descriptionChars(projectRoot: string, item: AuditItem): number {
  if (item.class !== 'skill') return 0;
  const split = splitSkillFrontmatter(
    readTextIfPresent(join(projectRoot, item.path, 'SKILL.md')) ?? '',
  );
  if (!split.ok || typeof split.data.description !== 'string') return 0;
  return split.data.description.length;
}

function scriptTestState(projectRoot: string, item: AuditItem): string {
  if (item.class !== 'skill') return '';
  const scripts = join(projectRoot, item.path, 'scripts');
  if (!existsSync(scripts) || readdirSync(scripts).length === 0) return 'no scripts';
  return item.script_test_findings === 0 ? 'tested' : `${item.script_test_findings} SK-010`;
}

function naming(item: AuditItem): string {
  const rules = [
    ...new Set(
      item.findings
        .filter((finding) => NAMING_RULES.includes(finding.rule))
        .map((finding) => finding.rule),
    ),
  ];
  return rules.length === 0 ? '' : rules.join(', ');
}

function fired(item: AuditItem): string {
  return item.fired_30d === null ? 'no activation data' : String(item.fired_30d);
}

function blockingExcepted(item: AuditItem, exceptions: ReadonlyMap<string, string>): string {
  const ids = [
    ...new Set(
      item.findings
        .filter((finding) => finding.severity === 'block')
        .map((finding) => exceptions.get(`${finding.rule}:${item.name}`) ?? null)
        .filter((id): id is string => id !== null),
    ),
  ];
  return ids.join(', ');
}

function agentRivals(projectRoot: string, agents: AuditReport): Map<string, string> {
  const roster: ExpertProfile[] = [];
  const seen = new Set<string>();
  for (const item of agents.items) {
    if (item.class !== 'agent' || seen.has(item.name)) continue;
    seen.add(item.name);
    const text = readTextIfPresent(join(projectRoot, item.path)) ?? '';
    const description = /^description:\s*'?(.*?)'?$/mu.exec(text)?.[1] ?? '';
    roster.push({ role: item.name, owns: description });
  }
  const lensDir = join(projectRoot, LENS_ROOT);
  if (existsSync(lensDir)) {
    for (const file of readdirSync(lensDir).sort(compareText)) {
      if (!file.endsWith('.md')) continue;
      const role = `lens:${basename(file, '.md')}`;
      roster.push({ role, owns: lensFocus(readFileSync(join(lensDir, file), 'utf8')) });
    }
  }
  const threshold = readAuthoringConfig(projectRoot).authoring_collision_jaccard;
  const best = new Map<string, { other: string; score: number }>();
  const note = (role: string, other: string, score: number): void => {
    const current = best.get(role);
    if (
      current === undefined ||
      score > current.score ||
      (score === current.score && compareText(other, current.other) < 0)
    ) {
      best.set(role, { other, score });
    }
  };
  for (const collision of expertCollisions(roster, threshold)) {
    note(collision.role, collision.owner, collision.score);
    note(collision.owner, collision.role, collision.score);
  }
  return new Map(
    [...best.entries()].map(([role, entry]) => [
      role,
      `${entry.other} (${entry.score.toFixed(2)})`,
    ]),
  );
}

function rivalText(item: AuditItem, agentRival: ReadonlyMap<string, string>): string {
  if (item.class === 'skill') {
    return item.rival === null ? '' : `${item.rival.name} (${item.rival.score.toFixed(2)})`;
  }
  return agentRival.get(item.name) ?? '';
}

function summaryLines(input: AuditDocInput): string[] {
  const rules = new Map<string, { blocking: number; warnings: number }>();
  for (const entry of [...input.skills.rules, ...input.agents.rules]) {
    const current = rules.get(entry.rule) ?? { blocking: 0, warnings: 0 };
    rules.set(entry.rule, {
      blocking: current.blocking + entry.blocking,
      warnings: current.warnings + entry.warnings,
    });
  }
  const ruleRows = [...rules.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([rule, counts]) => [rule, counts.blocking, counts.warnings]);
  const groupRows: Array<Array<string | number>> = [];
  for (const [kind, report] of [
    ['skills', input.skills],
    ['agents', input.agents],
  ] as const) {
    for (const [group, items] of groupsOf(report.items)) {
      groupRows.push([
        `${kind}: ${group}`,
        items.length,
        sum(items, (item) => item.blocking),
        sum(items, (item) => item.warnings),
        sum(items, (item) => (item.listed ? item.listing_tokens : 0)),
        sum(items, (item) => descriptionChars(input.projectRoot, item)),
        sum(items, (item) => item.body_tokens),
      ]);
    }
  }
  return [
    '### By rule',
    '',
    ...table(['Rule', 'Blocking', 'Warnings'], ruleRows),
    '',
    '### By group',
    '',
    ...table(
      [
        'Group',
        'Items',
        'Blocking',
        'Warnings',
        'Listing tokens',
        'Description characters',
        'Body tokens',
      ],
      groupRows,
    ),
    '',
  ];
}

function detailLines(
  input: AuditDocInput,
  report: AuditReport,
  kind: 'skill' | 'agent',
  before: ReadonlyMap<string, number> | null,
  agentRival: ReadonlyMap<string, string>,
): string[] {
  const exceptions = input.exceptions ?? new Map<string, string>();
  const lines: string[] = [];
  for (const [group, items] of groupsOf(report.items)) {
    const blocking = sum(items, (item) => item.blocking);
    const head = [
      kind === 'skill' ? 'Skill' : 'Agent',
      'Blocking',
      'Warnings',
      'Fired (30 days)',
      'Listing tokens',
      ...(before === null ? ['Body tokens'] : ['Body tokens before', 'after', 'drop']),
      'Rival (Jaccard 0.4 or more)',
      ...(kind === 'skill' ? ['Script tests'] : []),
      'Naming (later decision)',
      ...(before === null ? [] : ['Open packet']),
    ];
    const rows = items.map((item) => {
      const was = before?.get(item.path);
      const tokens =
        before === null
          ? [item.body_tokens]
          : [was ?? 'new', item.body_tokens, was === undefined ? '' : was - item.body_tokens];
      return [
        `\`${item.path}\``,
        item.blocking,
        item.warnings,
        fired(item),
        item.listing_tokens,
        ...tokens,
        rivalText(item, agentRival),
        ...(kind === 'skill' ? [scriptTestState(input.projectRoot, item)] : []),
        naming(item),
        ...(before === null ? [] : [blockingExcepted(item, exceptions)]),
      ];
    });
    lines.push(
      '<details>',
      `<summary>${kind}s: ${group} (${items.length}, ${blocking} blocking)</summary>`,
      '',
      ...table(head, rows),
      '',
      '</details>',
      '',
    );
  }
  return lines;
}

function personaLines(agents: AuditReport): string[] {
  if (agents.personas.length === 0) return [];
  return [
    '### Personas',
    '',
    'Persona files have no frontmatter, so no host loads them as a subagent. They are listed here and never block.',
    '',
    ...table(
      ['Persona', 'Group', 'Tokens'],
      agents.personas.map((persona) => [`\`${persona.path}\``, persona.group, persona.body_tokens]),
    ),
    '',
  ];
}

function bodyTokenData(input: AuditDocInput): string {
  const data: Record<string, number> = {};
  for (const item of [...input.skills.items, ...input.agents.items]) {
    data[item.path] = item.body_tokens;
  }
  for (const persona of input.agents.personas) data[persona.path] = persona.body_tokens;
  return `<!-- audit-body-tokens ${JSON.stringify(data)} -->`;
}

function readBefore(previous: string | null | undefined): Map<string, number> | null {
  const match = previous === null || previous === undefined ? null : BODY_DATA.exec(previous);
  if (match === null) return null;
  return new Map(Object.entries(JSON.parse(match[1]!) as Record<string, number>));
}

export function renderAuditSection(
  input: AuditDocInput,
  section: AuditSection,
  before: ReadonlyMap<string, number> | null,
): string[] {
  const agentRival = agentRivals(input.projectRoot, input.agents);
  return [
    section === 'before' ? BEFORE_HEADING : AFTER_HEADING,
    '',
    `As of ${input.asOf}: ${input.skills.items_count} skills, ${input.agents.items_count} agents ` +
      `(rendered templates included) and ${input.agents.personas.length} personas.`,
    '',
    ...summaryLines(input),
    '### Skills',
    '',
    ...detailLines(input, input.skills, 'skill', before, agentRival),
    '### Agents',
    '',
    ...detailLines(input, input.agents, 'agent', before, agentRival),
    ...personaLines(input.agents),
    ...(section === 'before' ? [bodyTokenData(input), ''] : listingLines(input.skills)),
  ];
}

export function listingSaving(skills: AuditReport): {
  before: number;
  after: number;
  saving: number;
  unlisted: string[];
} {
  const before = sum(skills.items, (item) => item.listing_tokens);
  const unlistedItems = skills.items.filter((item) => !item.listed);
  const saving = sum(unlistedItems, (item) => item.listing_tokens);
  return {
    before,
    after: before - saving,
    saving,
    unlisted: unlistedItems.map((item) => item.name).sort(compareText),
  };
}

function listingLines(skills: AuditReport): string[] {
  const listing = listingSaving(skills);
  if (listing.unlisted.length === 0) return [];
  return [
    '### Skill listing',
    '',
    `Skills that start only from their command (\`disable-model-invocation: true\`) leave the listing: ` +
      `${listing.unlisted.join(', ')}.`,
    '',
    ...table(
      ['Listing tokens with them', 'Listing tokens without them', 'Saving'],
      [[listing.before, listing.after, listing.saving]],
    ),
    '',
  ];
}

const PREAMBLE = [
  '# Skill and agent audit',
  '',
  'paqad lints its own skills and agents with `paqad-ai skill lint --all` and `paqad-ai agent lint --all`.',
  '`paqad-ai skill audit` renders this page from both reports. The Before section is written once and',
  'kept as it is; a later run rewrites only the After section. Naming warnings (SK-004, AG-002) stay',
  'warnings: no skill or agent is renamed in this audit.',
  '',
];

function beforeSection(previous: string): string | null {
  const start = previous.indexOf(`\n${BEFORE_HEADING}\n`);
  if (start === -1) return null;
  const end = previous.indexOf(`\n${AFTER_HEADING}\n`, start + 1);
  return previous.slice(start + 1, end === -1 ? undefined : end + 1).replace(/\n+$/u, '\n');
}

export function renderAuditDoc(input: AuditDocInput): string {
  const previous = input.previous ?? null;
  const kept = previous === null ? null : beforeSection(previous);
  const section: AuditSection = input.section ?? (kept === null ? 'before' : 'after');
  if (section === 'before') {
    return [
      ...PREAMBLE,
      ...renderAuditSection(input, 'before', null),
      AFTER_HEADING,
      '',
      NOT_YET,
      '',
    ].join('\n');
  }
  const after = renderAuditSection(input, 'after', readBefore(kept));
  return [...PREAMBLE, ...(kept === null ? [] : [kept]), ...after].join('\n');
}

export interface WriteAuditDocOptions {
  out?: string;
  asOf: string;
  section?: AuditSection;
  exceptions?: ReadonlyMap<string, string>;
  agentSources?: AgentAuditSources;
}

export function writeAuditDoc(
  projectRoot: string,
  options: WriteAuditDocOptions,
): { path: string; section: AuditSection } {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(options.asOf) || Number.isNaN(Date.parse(options.asOf))) {
    throw new AuditUsageError(`--as-of ${options.asOf} is not a date (YYYY-MM-DD).`);
  }
  if (options.section !== undefined && !['before', 'after'].includes(options.section)) {
    throw new AuditUsageError(`--section ${String(options.section)} is not before or after.`);
  }
  const out = options.out ?? AUDIT_DOC;
  const abs = resolve(projectRoot, out);
  const previous = existsSync(abs) ? readFileSync(abs, 'utf8') : null;
  const skills = lintAllSkills(projectRoot, { asOf: options.asOf });
  const agents = lintAllAgents(projectRoot, {
    asOf: options.asOf,
    agentSources: options.agentSources,
  });
  const section =
    options.section ?? (previous !== null && beforeSection(previous) !== null ? 'after' : 'before');
  const text = renderAuditDoc({
    projectRoot,
    asOf: options.asOf,
    skills,
    agents,
    previous,
    section,
    exceptions: options.exceptions,
  });
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, text.endsWith('\n') ? text : `${text}\n`, 'utf8');
  return { path: out, section };
}
