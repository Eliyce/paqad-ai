import { DecisionStore } from '@/planning/decision-store.js';

import { applyReport, readApplyJournal, scriptableOffer } from './apply.js';
import { atomicWriteJson, readJsonFile } from './files.js';
import { absRunFile } from './paths.js';
import { readProposal } from './proposal.js';
import {
  RUN_DOC_TYPE,
  findOpenRunId,
  openRun,
  readRun,
  updateRun,
  type RunRecord,
} from './run-store.js';
import { NOT_NOW } from './signoff.js';

export type StartOutcome =
  | { state: 'opened'; record: RunRecord }
  | { state: 'resume'; record: RunRecord }
  | { state: 'choose'; record: RunRecord; question: string }
  | { state: 'broken'; run_id: string; reason: string; offer: 'start fresh' };

export interface StartOptions {
  fresh?: boolean;
  continueOpen?: boolean;
  now?: Date;
}

function abandonBroken(projectRoot: string, runId: string, at: string): void {
  const read = readJsonFile<Record<string, unknown>>(absRunFile(projectRoot, runId, 'run'));
  const previous = read.state === 'ok' ? read.value : {};
  atomicWriteJson(absRunFile(projectRoot, runId, 'run'), {
    ...previous,
    schema_version: 1,
    doc_type: RUN_DOC_TYPE,
    run_id: runId,
    revision: typeof previous.revision === 'number' ? previous.revision + 1 : 1,
    step: typeof previous.step === 'string' ? previous.step : 'inventory',
    status: 'abandoned',
    opened_at: typeof previous.opened_at === 'string' ? previous.opened_at : at,
    updated_at: at,
    signoff_decision:
      typeof previous.signoff_decision === 'string' ? previous.signoff_decision : null,
    proposal_hash: typeof previous.proposal_hash === 'string' ? previous.proposal_hash : null,
    steps: Array.isArray(previous.steps) ? previous.steps : [],
  });
}

export function abandonRun(projectRoot: string, runId: string, now: Date = new Date()): void {
  const at = now.toISOString();
  const read = readRun(projectRoot, runId);
  if (read.state !== 'ok') {
    abandonBroken(projectRoot, runId, at);
    return;
  }
  const decisionId = read.record.signoff_decision;
  if (decisionId !== null) {
    const store = new DecisionStore(projectRoot);
    if (store.readPending(decisionId) !== null) {
      store.resolve({
        decisionId,
        humanResponse: {
          chosen_option_key: NOT_NOW,
          intent: 'explicit',
          explanation_rounds_used: 0,
          responded_at: at,
          responded_by: 'rules-discovery',
          carry_over_scope: 'none',
          note: 'closed when a fresh rules discovery run was started',
        },
      });
    }
  }
  const result = updateRun(projectRoot, runId, read.record.revision, { status: 'abandoned' }, now);
  if (!result.ok) {
    throw new Error(result.detail);
  }
}

export function startRun(projectRoot: string, options: StartOptions = {}): StartOutcome {
  const now = options.now ?? new Date();
  const openId = findOpenRunId(projectRoot);
  if (openId !== null && options.fresh === true) {
    abandonRun(projectRoot, openId, now);
    return { state: 'opened', record: openRun(projectRoot, now) };
  }
  if (openId === null) {
    return { state: 'opened', record: openRun(projectRoot, now) };
  }
  const read = readRun(projectRoot, openId);
  if (read.state !== 'ok') {
    return {
      state: 'broken',
      run_id: openId,
      reason:
        read.state === 'missing' ? 'run.json is missing' : `run.json is unreadable: ${read.reason}`,
      offer: 'start fresh',
    };
  }
  if (read.record.step === 'sign_off' && options.continueOpen !== true) {
    return {
      state: 'choose',
      record: read.record,
      question: `Run ${openId} is waiting on its sign-off decision. Continue it or start fresh?`,
    };
  }
  return { state: 'resume', record: read.record };
}

export type ResumeCheck =
  | { ok: true; record: RunRecord }
  | { ok: false; run_id: string; reason: string; offer: 'start fresh' };

export function checkResume(
  projectRoot: string,
  runId: string,
  expectedRevision: number,
): ResumeCheck {
  const read = readRun(projectRoot, runId);
  if (read.state === 'missing') {
    return { ok: false, run_id: runId, reason: 'run.json is missing', offer: 'start fresh' };
  }
  if (read.state === 'unreadable') {
    return {
      ok: false,
      run_id: runId,
      reason: `run.json is unreadable: ${read.reason}`,
      offer: 'start fresh',
    };
  }
  if (read.record.revision !== expectedRevision) {
    return {
      ok: false,
      run_id: runId,
      reason: `run.json is at revision ${read.record.revision}, not ${expectedRevision}; another session changed it`,
      offer: 'start fresh',
    };
  }
  return { ok: true, record: read.record };
}

export function statusLines(projectRoot: string): string[] {
  const openId = findOpenRunId(projectRoot);
  if (openId === null) return ['no rules discovery run is open.'];
  const read = readRun(projectRoot, openId);
  if (read.state !== 'ok') {
    return [
      `run ${openId}: run.json is ${read.state}; say "discover rules" and choose start fresh.`,
    ];
  }
  const record = read.record;
  return [
    `run ${record.run_id} · step ${record.step} · ${record.status} · opened ${record.opened_at} · updated ${record.updated_at} · revision ${record.revision}`,
  ];
}

export interface RunReport {
  run_id: string;
  rules_added: number;
  rules_changed: number;
  rules_removed: number;
  decisions_tagged: number;
  stack_docs_updated: number;
  checks_offered: number;
}

export function writeRunReport(projectRoot: string, runId: string, docsUpdated: number): RunReport {
  const proposal = readProposal(projectRoot, runId);
  const applied =
    proposal === null ? null : applyReport(proposal, readApplyJournal(projectRoot, runId), null);
  const report: RunReport = {
    run_id: runId,
    rules_added: applied?.added ?? 0,
    rules_changed: applied?.changed ?? 0,
    rules_removed: applied?.removed ?? 0,
    decisions_tagged: applied?.tagged ?? 0,
    stack_docs_updated: docsUpdated,
    checks_offered: applied === null || scriptableOffer(applied) === null ? 0 : applied.scriptable,
  };
  atomicWriteJson(absRunFile(projectRoot, runId, 'report'), report);
  return report;
}

export function reportLine(report: RunReport): string {
  return `done — ${report.rules_added} rules added, ${report.rules_changed} changed, ${report.rules_removed} removed; ${report.decisions_tagged} decisions tagged; ${report.stack_docs_updated} stack docs updated; ${report.checks_offered} checks offered.`;
}
