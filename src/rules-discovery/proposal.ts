import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { collectRuleFiles } from '@/rule-scripts/analyzer.js';
import { cleanRuleText } from '@/rule-scripts/editor.js';
import { loadRuleScriptMap } from '@/rule-scripts/map.js';
import { parseRuleMarker, stripRuleMarker } from '@/rule-scripts/rule-id.js';

import type { DecisionIdea, FromDecisions } from './decisions.js';
import { atomicWriteText, readJsonFile } from './files.js';
import { PROJECT_RULES_DIR, RULES_ROOT, absRunFile } from './paths.js';
import type { ResearchIdea } from './research.js';
import { cleanDiscoveredText, isSlug, normalizeForMatch, sha256Text } from './text.js';
import type { StackInventory } from './types.js';

export type RowChange = 'new' | 'changed' | 'removed' | 'conflict';
export type RowOrigin = 'decisions' | 'research' | 'existing';
export type RowCheck = 'script' | 'judgement' | 'none';
export type Verdict = 'keep' | 'edit' | 'drop' | 'keep_existing' | 'take_new';
export type JudgedOutcome = 'new' | 'fold' | 'conflict' | 'change';

export const ROW_VERDICTS: Record<RowChange, readonly Verdict[]> = {
  new: ['keep', 'edit', 'drop'],
  changed: ['keep', 'edit', 'drop'],
  removed: ['keep', 'drop'],
  conflict: ['keep_existing', 'take_new', 'edit'],
};

export const CHECK_WORDS: Record<RowCheck, string> = {
  script: 'a script can check it',
  judgement: 'it needs judgement',
  none: 'it cannot be checked',
};

export interface ExistingRule {
  rule_id: string;
  text: string;
  source: string;
  check: RowCheck;
}

export interface ProposalRow {
  row_id: string;
  change: RowChange;
  text: string;
  existing: { rule_id: string; text: string; source: string } | null;
  origin: RowOrigin;
  idea_ids: string[];
  source_decisions: string[];
  sources: string[];
  packages: string[];
  target: string;
  topic: string | null;
  check: RowCheck;
  reason: string | null;
  target_hash: string | null;
  verdict: Verdict | null;
  edited_text: string | null;
}

export interface FoldedIdea {
  idea_id: string;
  rule_id: string;
  source_decisions: string[];
}

export interface Proposal {
  schema_version: 1;
  run_id: string;
  generated_at: string;
  rows: ProposalRow[];
  folded: FoldedIdea[];
  not_rules: FromDecisions['not_rules'];
  manifests: Record<string, string>;
}

export interface IdeaJudgement {
  idea_id: string;
  outcome: JudgedOutcome;
  rule_id?: string;
  target?: string | null;
  topic?: string | null;
  check?: RowCheck;
}

export interface BuildProposalInput {
  runId: string;
  now: Date;
  existing: ExistingRule[];
  decisions: FromDecisions;
  research: ResearchIdea[];
  inventory: StackInventory | null;
  judgements: IdeaJudgement[];
  fileHash: (rel: string) => string | null;
  manifests?: Record<string, string>;
}

const CHECK_BY_KIND: Record<string, RowCheck> = {
  deterministic: 'script',
  heuristic: 'judgement',
  unverifiable: 'none',
};

export function readExistingRules(projectRoot: string): ExistingRule[] {
  const kinds = new Map<string, RowCheck>();
  for (const rule of loadRuleScriptMap(projectRoot)?.rules ?? []) {
    kinds.set(rule.id, CHECK_BY_KIND[rule.verifiability.kind] ?? 'judgement');
  }
  const rules: ExistingRule[] = [];
  for (const source of collectRuleFiles(projectRoot)) {
    for (const line of readFileSync(join(projectRoot, source), 'utf8').split('\n')) {
      const ruleId = parseRuleMarker(line);
      if (ruleId === null) continue;
      rules.push({
        rule_id: ruleId,
        text: cleanRuleText(stripRuleMarker(line).text),
        source,
        check: kinds.get(ruleId) ?? 'judgement',
      });
    }
  }
  return rules;
}

export function ruleFileHash(projectRoot: string, rel: string): string | null {
  try {
    return sha256Text(readFileSync(join(projectRoot, rel), 'utf8'));
  } catch {
    return null;
  }
}

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function mentionsPackage(text: string, name: string): boolean {
  if (name.length < 3) return false;
  return new RegExp(`(^|[^A-Za-z0-9@/_-])${escapeRe(name)}($|[^A-Za-z0-9_-])`, 'i').test(text);
}

interface IdeaInput {
  idea_id: string;
  text: string;
  origin: 'decisions' | 'research';
  source_decisions: string[];
  sources: string[];
  packages: string[];
}

function ideaInputs(decisions: FromDecisions, research: ResearchIdea[]): IdeaInput[] {
  return [
    ...decisions.ideas.map((idea: DecisionIdea) => ({
      idea_id: idea.idea_id,
      text: cleanDiscoveredText(idea.text),
      origin: 'decisions' as const,
      source_decisions: [...idea.source_decisions],
      sources: [],
      packages: [],
    })),
    ...research.map((idea) => ({
      idea_id: idea.idea_id,
      text: cleanDiscoveredText(idea.text),
      origin: 'research' as const,
      source_decisions: [],
      sources: [...idea.sources],
      packages: [idea.applies_to.package],
    })),
  ];
}

function defaultTopic(idea: IdeaInput): string {
  const pkg = idea.packages[0];
  if (pkg !== undefined) {
    const slug = pkg
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (isSlug(slug)) return slug;
  }
  return idea.origin === 'decisions' ? 'decisions' : 'stack';
}

function union(left: string[], right: string[]): string[] {
  return [...new Set([...left, ...right])];
}

export function buildProposal(input: BuildProposalInput): Proposal {
  const byRule = new Map(input.existing.map((rule) => [rule.rule_id, rule]));
  const byText = new Map(input.existing.map((rule) => [normalizeForMatch(rule.text), rule]));
  const judged = new Map(input.judgements.map((entry) => [entry.idea_id, entry]));
  const rows: ProposalRow[] = [];
  const folded: FoldedIdea[] = [];
  const rowByText = new Map<string, ProposalRow>();

  const fold = (idea: IdeaInput, rule: ExistingRule): void => {
    folded.push({
      idea_id: idea.idea_id,
      rule_id: rule.rule_id,
      source_decisions: idea.source_decisions,
    });
  };

  for (const idea of ideaInputs(input.decisions, input.research)) {
    if (idea.text === '') continue;
    const judgement = judged.get(idea.idea_id);
    const key = normalizeForMatch(idea.text);
    const sameText = byText.get(key);
    const named = judgement?.rule_id === undefined ? undefined : byRule.get(judgement.rule_id);
    if (sameText !== undefined && judgement?.outcome !== 'conflict') {
      fold(idea, sameText);
      continue;
    }
    if (judgement?.outcome === 'fold' && named !== undefined) {
      fold(idea, named);
      continue;
    }
    const twin = rowByText.get(key);
    if (twin !== undefined) {
      twin.idea_ids.push(idea.idea_id);
      twin.source_decisions = union(twin.source_decisions, idea.source_decisions);
      twin.sources = union(twin.sources, idea.sources);
      twin.packages = union(twin.packages, idea.packages);
      continue;
    }
    const against =
      (judgement?.outcome === 'conflict' || judgement?.outcome === 'change') && named !== undefined
        ? named
        : null;
    const change: RowChange =
      against === null ? 'new' : judgement?.outcome === 'conflict' ? 'conflict' : 'changed';
    const topic =
      against === null && (judgement?.target ?? null) === null
        ? (judgement?.topic ?? defaultTopic(idea))
        : null;
    const target =
      against?.source ??
      judgement?.target ??
      `${PROJECT_RULES_DIR}/${topic ?? defaultTopic(idea)}.md`;
    const row: ProposalRow = {
      row_id: `P-${rows.length + 1}`,
      change,
      text: idea.text,
      existing:
        against === null
          ? null
          : { rule_id: against.rule_id, text: against.text, source: against.source },
      origin: idea.origin,
      idea_ids: [idea.idea_id],
      source_decisions: idea.source_decisions,
      sources: idea.sources,
      packages: idea.packages,
      target,
      topic,
      check: judgement?.check ?? against?.check ?? 'judgement',
      reason: null,
      target_hash: input.fileHash(target),
      verdict: null,
      edited_text: null,
    };
    rows.push(row);
    rowByText.set(key, row);
  }

  const removed = (input.inventory?.packages ?? []).filter((pkg) => pkg.status === 'removed');
  const live = new Set(
    (input.inventory?.packages ?? [])
      .filter((pkg) => pkg.status !== 'removed')
      .map((pkg) => pkg.name.toLowerCase()),
  );
  const touched = new Set(rows.map((row) => row.existing?.rule_id).filter(Boolean));
  for (const rule of input.existing) {
    if (touched.has(rule.rule_id)) continue;
    const gone = removed.find(
      (pkg) => !live.has(pkg.name.toLowerCase()) && mentionsPackage(rule.text, pkg.name),
    );
    if (gone === undefined) continue;
    rows.push({
      row_id: `P-${rows.length + 1}`,
      change: 'removed',
      text: rule.text,
      existing: { rule_id: rule.rule_id, text: rule.text, source: rule.source },
      origin: 'existing',
      idea_ids: [],
      source_decisions: [],
      sources: [],
      packages: [gone.name],
      target: rule.source,
      topic: null,
      check: rule.check,
      reason: `the project no longer uses ${gone.name}`,
      target_hash: input.fileHash(rule.source),
      verdict: null,
      edited_text: null,
    });
  }

  return {
    schema_version: 1,
    run_id: input.runId,
    generated_at: input.now.toISOString(),
    rows,
    folded,
    not_rules: input.decisions.not_rules,
    manifests: input.manifests ?? {},
  };
}

export function isNothingToPropose(proposal: Proposal): boolean {
  return (
    proposal.rows.length === 0 && proposal.folded.length === 0 && proposal.not_rules.length === 0
  );
}

export function finalText(row: ProposalRow): string {
  return cleanDiscoveredText(row.edited_text ?? row.text);
}

export function setVerdict(
  proposal: Proposal,
  rowId: string,
  verdict: Verdict,
  editedText?: string,
): Proposal {
  const row = proposal.rows.find((entry) => entry.row_id === rowId);
  if (row === undefined) throw new Error(`no proposal row ${rowId}`);
  if (!ROW_VERDICTS[row.change].includes(verdict)) {
    throw new Error(
      `row ${rowId} is ${row.change}; choose one of ${ROW_VERDICTS[row.change].join(', ')}`,
    );
  }
  let edited: string | null = null;
  if (verdict === 'edit') {
    edited = cleanDiscoveredText(editedText ?? '');
    if (edited === '') throw new Error(`row ${rowId}: edit needs the new rule text`);
    const key = normalizeForMatch(edited);
    const clash = proposal.rows.find(
      (other) => other.row_id !== rowId && normalizeForMatch(finalText(other)) === key,
    );
    if (clash !== undefined) {
      throw new Error(`row ${rowId}: the edited text repeats row ${clash.row_id}`);
    }
  }
  return {
    ...proposal,
    rows: proposal.rows.map((entry) =>
      entry.row_id === rowId ? { ...entry, verdict, edited_text: edited } : entry,
    ),
  };
}

export function rowsWithoutVerdict(proposal: Proposal): string[] {
  return proposal.rows.filter((row) => row.verdict === null).map((row) => row.row_id);
}

export interface SignoffCounts {
  added: number;
  changed: number;
  removed: number;
}

export function rowWrites(row: ProposalRow): 'add' | 'edit' | 'remove' | null {
  if (row.verdict === null || row.verdict === 'drop' || row.verdict === 'keep_existing') {
    return null;
  }
  if (row.change === 'new') return 'add';
  if (row.change === 'removed') return 'remove';
  return 'edit';
}

export function signoffCounts(proposal: Proposal): SignoffCounts {
  const counts: SignoffCounts = { added: 0, changed: 0, removed: 0 };
  for (const row of proposal.rows) {
    const write = rowWrites(row);
    if (write === 'add') counts.added += 1;
    if (write === 'edit') counts.changed += 1;
    if (write === 'remove') counts.removed += 1;
  }
  return counts;
}

export function signoffQuestion(counts: SignoffCounts): string {
  return `Sign off ${counts.added} new, ${counts.changed} changed, ${counts.removed} removed rules?`;
}

export function staleRows(
  proposal: Proposal,
  existing: ExistingRule[],
  fileHash: (rel: string) => string | null,
  manifests: Record<string, string>,
): Array<{ row_id: string; why: string }> {
  const stackMoved = Object.keys({ ...proposal.manifests, ...manifests }).some(
    (path) => proposal.manifests[path] !== manifests[path],
  );
  const byId = new Map(existing.map((rule) => [rule.rule_id, rule]));
  const stale: Array<{ row_id: string; why: string }> = [];
  for (const row of proposal.rows) {
    if (row.existing !== null) {
      const now = byId.get(row.existing.rule_id);
      if (
        now === undefined ||
        normalizeForMatch(now.text) !== normalizeForMatch(row.existing.text)
      ) {
        stale.push({ row_id: row.row_id, why: `rule ${row.existing.rule_id} changed on disk` });
        continue;
      }
    }
    if (fileHash(row.target) !== row.target_hash) {
      stale.push({ row_id: row.row_id, why: `${row.target} changed` });
      continue;
    }
    if (stackMoved && row.packages.length > 0) {
      stale.push({ row_id: row.row_id, why: 'the stack changed' });
    }
  }
  return stale;
}

export function carryVerdicts(previous: Proposal, next: Proposal): Proposal {
  const key = (row: ProposalRow): string =>
    `${row.change}|${row.existing?.rule_id ?? ''}|${normalizeForMatch(row.text)}`;
  const earlier = new Map(previous.rows.map((row) => [key(row), row]));
  return {
    ...next,
    rows: next.rows.map((row) => {
      const before = earlier.get(key(row));
      return before === undefined
        ? row
        : { ...row, verdict: before.verdict, edited_text: before.edited_text };
    }),
  };
}

export function targetProblem(row: ProposalRow): string | null {
  if (row.topic !== null && !isSlug(row.topic)) {
    return `row ${row.row_id}: topic "${row.topic}" is not a plain slug`;
  }
  const target = row.target.split('\\').join('/');
  const parts = target.split('/');
  if (
    !target.startsWith(`${RULES_ROOT}/`) ||
    !target.endsWith('.md') ||
    parts.some((part) => part === '..' || part === '.' || part === '') ||
    target.includes('\0')
  ) {
    return `row ${row.row_id}: target ${row.target} is not a .md file under ${RULES_ROOT}/`;
  }
  return null;
}

function rowLine(row: ProposalRow): string {
  const head = `### ${row.row_id} · ${row.change} · from ${row.origin}`;
  const lines = [
    head,
    '',
    `- Rule: ${finalText(row)}`,
    `- Target: ${row.target}`,
    `- Check: ${CHECK_WORDS[row.check]}`,
  ];
  if (row.existing !== null)
    lines.push(`- Existing (${row.existing.rule_id}): ${row.existing.text}`);
  if (row.change === 'conflict') lines.push('- Settle with: keep existing, take new or edit');
  if (row.reason !== null) lines.push(`- Reason: ${row.reason}`);
  if (row.source_decisions.length > 0)
    lines.push(`- Decisions: ${row.source_decisions.join(', ')}`);
  if (row.sources.length > 0) lines.push(`- Sources: ${row.sources.join(', ')}`);
  lines.push(`- Verdict: ${row.verdict ?? 'not yet chosen'}`);
  return lines.join('\n');
}

export function proposalMarkdown(proposal: Proposal): string {
  const counts = signoffCounts(proposal);
  const parts = [
    `# Rules proposal ${proposal.run_id}`,
    '',
    `${proposal.rows.length} row(s); signed off so far: ${counts.added} new, ${counts.changed} changed, ${counts.removed} removed. ${proposal.folded.length} idea(s) folded into existing rules.`,
    '',
    ...proposal.rows.map(rowLine).flatMap((block) => [block, '']),
  ];
  if (proposal.not_rules.length > 0) {
    parts.push('## Not rules', '');
    for (const entry of proposal.not_rules) parts.push(`- ${entry.id}: ${entry.reason}`);
    parts.push('');
  }
  return parts.join('\n');
}

export function writeProposal(projectRoot: string, proposal: Proposal): string {
  const text = `${JSON.stringify(proposal, null, 2)}\n`;
  atomicWriteText(absRunFile(projectRoot, proposal.run_id, 'proposal'), text);
  atomicWriteText(
    absRunFile(projectRoot, proposal.run_id, 'proposalMarkdown'),
    proposalMarkdown(proposal),
  );
  return sha256Text(text);
}

export function readProposal(projectRoot: string, runId: string): Proposal | null {
  const read = readJsonFile<Proposal>(absRunFile(projectRoot, runId, 'proposal'));
  if (read.state === 'unreadable') {
    throw new Error(`proposal.json in run ${runId} is unreadable: ${read.error}`);
  }
  return read.state === 'ok' && Array.isArray(read.value.rows) ? read.value : null;
}

export function proposalFileHash(projectRoot: string, runId: string): string | null {
  try {
    return sha256Text(readFileSync(absRunFile(projectRoot, runId, 'proposal'), 'utf8'));
  } catch {
    return null;
  }
}

export function readJudgements(projectRoot: string, runId: string): IdeaJudgement[] {
  const read = readJsonFile<{ ideas?: IdeaJudgement[] }>(
    absRunFile(projectRoot, runId, 'judgements'),
  );
  if (read.state === 'unreadable') {
    throw new Error(`proposal-judgements.json in run ${runId} is unreadable: ${read.error}`);
  }
  return read.state === 'ok' && Array.isArray(read.value.ideas) ? read.value.ideas : [];
}
