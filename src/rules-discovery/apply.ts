import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DecisionStore } from '@/planning/decision-store.js';
import type { RulesDiscoveryTag } from '@/planning/decision-packet.js';
import { applyRuleScriptMap } from '@/rule-scripts/apply.js';
import { collectRuleFiles, computeRuleFilesHash } from '@/rule-scripts/analyzer.js';
import { addRule, editRuleText, removeRuleBullet } from '@/rule-scripts/editor.js';
import { loadRuleScriptMap } from '@/rule-scripts/map.js';
import { addRuleEntry, archiveRule, setRuleText } from '@/rule-scripts/mutate.js';
import {
  parseRuleMarker,
  parseRuleMarkerRun,
  ruleTextHash,
  stripRuleMarker,
} from '@/rule-scripts/rule-id.js';
import type { RuleScriptMap } from '@/rule-scripts/types.js';

import { moveBaselineToRun } from './baseline.js';
import { atomicWriteJson, readJsonFile } from './files.js';
import { advanceRun, readInventoryFile } from './flow.js';
import { clearNudgeState } from './nudge.js';
import { absRunFile } from './paths.js';
import {
  finalText,
  proposalFileHash,
  readProposal,
  rowWrites,
  targetProblem,
  type Proposal,
  type ProposalRow,
} from './proposal.js';
import type { ResearchSource } from './research.js';
import { readRun } from './run-store.js';
import { readSignoff } from './signoff.js';
import { normalizeForMatch } from './text.js';

export interface AppliedRow {
  write: 'add' | 'edit' | 'remove' | 'skip' | 'refused';
  rule_id: string | null;
  why?: string;
}

export interface ApplyJournal {
  schema_version: 1;
  run_id: string;
  rows: Record<string, AppliedRow>;
  tagged: string[];
  finished_at: string | null;
}

export interface ApplyReport {
  added: number;
  changed: number;
  removed: number;
  tagged: number;
  refused: Array<{ row_id: string; why: string }>;
  scriptable: number;
  baseline: string | null;
}

export interface ApplyOptions {
  now?: Date;
  expectedRevision?: number;
  beforeWrite?: (what: string) => void;
}

export class ApplyRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApplyRefusedError';
  }
}

function readJournal(projectRoot: string, runId: string): ApplyJournal {
  const read = readJsonFile<ApplyJournal>(absRunFile(projectRoot, runId, 'apply'));
  if (read.state === 'ok' && typeof read.value.rows === 'object' && read.value.rows !== null) {
    return read.value;
  }
  return { schema_version: 1, run_id: runId, rows: {}, tagged: [], finished_at: null };
}

function saveJournal(projectRoot: string, journal: ApplyJournal): void {
  atomicWriteJson(absRunFile(projectRoot, journal.run_id, 'apply'), journal);
}

function syncMap(
  projectRoot: string,
  ruleId: string,
  action: 'edit' | 'remove',
  mutate: (map: RuleScriptMap) => RuleScriptMap,
  note: string,
): void {
  const map = loadRuleScriptMap(projectRoot);
  if (map === null) return;
  const next = mutate(map);
  next.rule_files_hash = computeRuleFilesHash(projectRoot, collectRuleFiles(projectRoot));
  applyRuleScriptMap({
    projectRoot,
    map: next,
    via: `rules-discovery:${ruleId}`,
    event: { action, rule_ids: [ruleId], note },
  });
}

function findWrittenRule(
  projectRoot: string,
  target: string,
  runId: string,
  text: string,
): string | null {
  let body: string;
  try {
    body = readFileSync(join(projectRoot, target), 'utf8');
  } catch {
    return null;
  }
  const key = normalizeForMatch(text);
  for (const line of body.split('\n')) {
    const id = parseRuleMarker(line);
    if (
      id !== null &&
      parseRuleMarkerRun(line) === runId &&
      normalizeForMatch(stripRuleMarker(line).text) === key
    ) {
      return id;
    }
  }
  return null;
}

function writeRow(projectRoot: string, runId: string, row: ProposalRow): AppliedRow {
  const write = rowWrites(row);
  if (write === null) return { write: 'skip', rule_id: row.existing?.rule_id ?? null };
  const text = finalText(row);
  if (write === 'add') {
    const already = findWrittenRule(projectRoot, row.target, runId, text);
    if (already !== null) return { write, rule_id: already };
    const added = addRule(projectRoot, row.target, text, { discovered: runId });
    syncMap(
      projectRoot,
      added.id,
      'edit',
      (map) => addRuleEntry(map, added),
      `add ${added.source}`,
    );
    return { write, rule_id: added.id };
  }
  const ruleId = row.existing!.rule_id;
  if (write === 'edit') {
    const located = editRuleText(projectRoot, ruleId, text, { discovered: runId });
    if (located === null) {
      return { write: 'refused', rule_id: ruleId, why: `rule ${ruleId} is no longer on disk` };
    }
    syncMap(
      projectRoot,
      ruleId,
      'edit',
      (map) => setRuleText(map, ruleId, text, ruleTextHash(text)),
      located.source,
    );
    return { write, rule_id: ruleId };
  }
  const located = removeRuleBullet(projectRoot, ruleId);
  syncMap(projectRoot, ruleId, 'remove', (map) => archiveRule(map, ruleId), row.target);
  return located === null
    ? { write, rule_id: ruleId, why: 'already removed' }
    : { write, rule_id: ruleId };
}

function plannedTags(
  proposal: Proposal,
  journal: ApplyJournal,
  runId: string,
  at: string,
): Array<{ id: string; tag: RulesDiscoveryTag }> {
  const tags = new Map<string, RulesDiscoveryTag>();
  for (const row of proposal.rows) {
    const applied = journal.rows[row.row_id];
    if (applied === undefined || applied.write === 'refused' || applied.rule_id === null) continue;
    if (row.verdict === 'drop') continue;
    for (const id of row.source_decisions) {
      tags.set(id, { status: 'absorbed', run_id: runId, rule_id: applied.rule_id, tagged_at: at });
    }
  }
  for (const fold of proposal.folded) {
    for (const id of fold.source_decisions) {
      if (!tags.has(id)) {
        tags.set(id, { status: 'absorbed', run_id: runId, rule_id: fold.rule_id, tagged_at: at });
      }
    }
  }
  for (const entry of proposal.not_rules) {
    if (!tags.has(entry.id)) {
      tags.set(entry.id, {
        status: 'not-a-rule',
        run_id: runId,
        reason: entry.reason,
        tagged_at: at,
      });
    }
  }
  return [...tags.entries()].map(([id, tag]) => ({ id, tag }));
}

function assertSignedOff(projectRoot: string, runId: string): Proposal {
  const run = readRun(projectRoot, runId);
  if (run.state !== 'ok') {
    throw new ApplyRefusedError(`run ${runId} has a ${run.state} run.json; nothing was written`);
  }
  const record = run.record;
  if (record.status !== 'open' || (record.step !== 'sign_off' && record.step !== 'apply')) {
    throw new ApplyRefusedError(
      `run ${runId} is ${record.status} at ${record.step}; apply needs a run waiting at sign-off`,
    );
  }
  if (record.signoff_decision === null) {
    throw new ApplyRefusedError(`run ${runId} has no sign-off decision; nothing was written`);
  }
  const signoff = readSignoff(projectRoot, record.signoff_decision);
  if (signoff.state !== 'signed') {
    throw new ApplyRefusedError(
      signoff.state === 'not_now'
        ? `sign-off ${record.signoff_decision} was answered not now; nothing was written and the proposal stays`
        : `sign-off ${record.signoff_decision} is ${signoff.state}; nothing was written`,
    );
  }
  const hash = proposalFileHash(projectRoot, runId);
  if (hash === null || hash !== signoff.hash || hash !== record.proposal_hash) {
    throw new ApplyRefusedError(
      `proposal.json changed after sign-off (hash differs from decision ${record.signoff_decision}); nothing was written`,
    );
  }
  const proposal = readProposal(projectRoot, runId);
  if (proposal === null) {
    throw new ApplyRefusedError(`run ${runId} has no proposal.json; nothing was written`);
  }
  return proposal;
}

export function applyProposal(
  projectRoot: string,
  runId: string,
  options: ApplyOptions = {},
): ApplyReport {
  const now = options.now ?? new Date();
  const proposal = assertSignedOff(projectRoot, runId);
  const run = readRun(projectRoot, runId);
  if (run.state === 'ok' && run.record.step === 'sign_off') {
    advanceRun(projectRoot, runId, { step: 'apply' }, options.expectedRevision, now);
  }
  const journal = readJournal(projectRoot, runId);
  for (const row of proposal.rows) {
    if (journal.rows[row.row_id] !== undefined) continue;
    const problem = rowWrites(row) === null ? null : targetProblem(row);
    if (problem !== null) {
      journal.rows[row.row_id] = { write: 'refused', rule_id: null, why: problem };
    } else {
      options.beforeWrite?.(`rule:${row.row_id}`);
      journal.rows[row.row_id] = writeRow(projectRoot, runId, row);
    }
    saveJournal(projectRoot, journal);
  }
  const store = new DecisionStore(projectRoot);
  for (const { id, tag } of plannedTags(proposal, journal, runId, now.toISOString())) {
    if (journal.tagged.includes(id)) continue;
    options.beforeWrite?.(`tag:${id}`);
    const result = store.tagRulesDiscovery(id, tag);
    if (result !== 'missing') {
      journal.tagged.push(id);
      saveJournal(projectRoot, journal);
    }
  }
  const inventory = readInventoryFile(projectRoot, runId);
  const baseline = inventory === null ? null : moveBaselineToRun(projectRoot, inventory, now);
  clearNudgeState(projectRoot);
  journal.finished_at = now.toISOString();
  saveJournal(projectRoot, journal);
  const latest = readRun(projectRoot, runId);
  if (latest.state === 'ok' && latest.record.step === 'apply') {
    advanceRun(projectRoot, runId, { step: 'docs' }, undefined, now);
  }
  return applyReport(proposal, journal, baseline?.inventory ?? null);
}

export function applyReport(
  proposal: Proposal,
  journal: ApplyJournal,
  baseline: string | null,
): ApplyReport {
  const report: ApplyReport = {
    added: 0,
    changed: 0,
    removed: 0,
    tagged: journal.tagged.length,
    refused: [],
    scriptable: 0,
    baseline,
  };
  for (const row of proposal.rows) {
    const applied = journal.rows[row.row_id];
    if (applied === undefined) continue;
    if (applied.write === 'refused') {
      report.refused.push({ row_id: row.row_id, why: applied.why ?? 'refused' });
      continue;
    }
    if (applied.write === 'add') report.added += 1;
    if (applied.write === 'edit') report.changed += 1;
    if (applied.write === 'remove') report.removed += 1;
    if ((applied.write === 'add' || applied.write === 'edit') && row.check === 'script') {
      report.scriptable += 1;
    }
  }
  return report;
}

export function scriptableOffer(report: ApplyReport): string | null {
  if (report.scriptable === 0) return null;
  return `${report.scriptable} new or changed rule${report.scriptable === 1 ? '' : 's'} could be checked by a script. Say "analyze rules" to turn them into checks with rule-analyzer.`;
}

export interface RuleTrace {
  rule_id: string;
  run_id: string;
  signoff_decision: string | null;
  sources: Array<{ id: string; origin: string; verified: string; date: string }>;
  source_decisions: string[];
}

export function traceDiscoveredRule(projectRoot: string, ruleId: string): RuleTrace | null {
  for (const rel of collectRuleFiles(projectRoot)) {
    for (const line of readFileSync(join(projectRoot, rel), 'utf8').split('\n')) {
      if (parseRuleMarker(line) !== ruleId) continue;
      const runId = parseRuleMarkerRun(line);
      if (runId === null) return null;
      const run = readRun(projectRoot, runId);
      const proposal = readProposal(projectRoot, runId);
      const journal = readJournal(projectRoot, runId);
      const row = proposal?.rows.find((entry) => journal.rows[entry.row_id]?.rule_id === ruleId);
      const sources = readJsonFile<ResearchSource[]>(absRunFile(projectRoot, runId, 'sources'));
      const known = sources.state === 'ok' && Array.isArray(sources.value) ? sources.value : [];
      return {
        rule_id: ruleId,
        run_id: runId,
        signoff_decision: run.state === 'ok' ? run.record.signoff_decision : null,
        sources: known
          .filter((source) => row?.sources.includes(source.id) ?? false)
          .map((source) => ({
            id: source.id,
            origin: source.origin,
            verified: source.verified,
            date: source.date,
          })),
        source_decisions: row?.source_decisions ?? [],
      };
    }
  }
  return null;
}
