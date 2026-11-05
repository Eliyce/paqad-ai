import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { appendFeatureStageRow, readFeatureStageUnit } from '@/feature-evidence/stage-ledger.js';
import type { SessionLedgerRow } from '@/session-ledger/ledger.js';
import {
  isReportRepairRow,
  reportRepairNote,
  REPORT_REPAIR_REASON,
} from '@/stage-evidence/report-repair.js';
import { RECORD_REPAIR_KIND, STAGE_AGENT_KIND } from '@/stage-evidence/types.js';

import { readStageReportStatus } from './stage-agents.js';
import { SUBAGENT_HANDBACK_TOOL } from './stage-handback.js';

export type TranscriptFinder = (agentId: string, sessionId: string) => string | null;

export interface ReportBackfillInput {
  projectRoot: string;
  sessionId: string;
  since: string;
  findTranscript: TranscriptFinder;
  apply?: boolean;
}

export interface ReportBackfillChange {
  dirName: string;
  affected_rows: number;
  note: string;
  written: boolean;
}

interface LastReport {
  source: 'handback' | 'text';
  text: string;
}

function contentBlocks(content: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(content)) return content as Array<Record<string, unknown>>;
  return [{ type: 'text', text: typeof content === 'string' ? content : '' }];
}

export function readLastReport(transcript: string): LastReport | null {
  let last: LastReport | null = null;
  for (const line of transcript.split('\n')) {
    if (line.trim() === '') continue;
    let parsed: { message?: { role?: unknown; content?: unknown } };
    try {
      parsed = JSON.parse(line) as typeof parsed;
    } catch {
      continue;
    }
    if (parsed.message?.role !== 'assistant') continue;
    for (const block of contentBlocks(parsed.message.content)) {
      if (block.type === 'tool_use' && block.name === SUBAGENT_HANDBACK_TOOL) {
        const input = block.input as { message?: unknown } | undefined;
        last = { source: 'handback', text: String(input?.message ?? '') };
      } else if (block.type === 'text' && String(block.text ?? '').trim() !== '') {
        last = { source: 'text', text: String(block.text) };
      }
    }
  }
  return last;
}

function isAffected(row: SessionLedgerRow, since: string): boolean {
  return (
    row.kind === STAGE_AGENT_KIND &&
    row.event_status === 'completed' &&
    row.report_status === 'BLOCKED' &&
    row.report_stated === false &&
    String(row.recorded_at) >= since
  );
}

function readTranscript(path: string | null): string | null {
  if (path === null) return null;
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function agentNote(
  agentId: string,
  stages: string[],
  session: string,
  findTranscript: TranscriptFinder,
): string {
  const label = `${agentId} ${stages.join('+')}`;
  const transcript = readTranscript(findTranscript(agentId, session));
  if (transcript === null) return `${label}: no transcript found`;
  const report = readLastReport(transcript);
  if (report === null) return `${label}: transcript found, no report`;
  const reading = readStageReportStatus(report.text);
  if (!reading.stated) return `${label}: report found (${report.source}), no Status line`;
  return reportRepairNote({
    agent_id: agentId,
    stages,
    report_status: reading.status,
    source: report.source,
  });
}

function changeNote(rows: readonly SessionLedgerRow[], findTranscript: TranscriptFinder): string {
  const agents = new Map<string, { stages: Set<string>; session: string }>();
  for (const row of rows) {
    const agentId = String(row.agent_id);
    const entry = agents.get(agentId) ?? { stages: new Set(), session: String(row.session_id) };
    entry.stages.add(String(row.stage));
    agents.set(agentId, entry);
  }
  return [...agents]
    .map(([agentId, entry]) => agentNote(agentId, [...entry.stages], entry.session, findTranscript))
    .join('; ');
}

export function backfillStageReports(input: ReportBackfillInput): ReportBackfillChange[] {
  const { projectRoot, sessionId, since, findTranscript } = input;
  const base = join(projectRoot, PATHS.FEATURE_EVIDENCE_DIR);
  if (!existsSync(base)) return [];
  const changes: ReportBackfillChange[] = [];
  for (const dirName of readdirSync(base).sort()) {
    if (!existsSync(join(base, dirName, 'stage-evidence.jsonl'))) continue;
    const rows = readFeatureStageUnit(projectRoot, dirName);
    const affected = rows.filter((row) => isAffected(row, since));
    if (affected.length === 0 || rows.some(isReportRepairRow)) continue;
    const note = changeNote(affected, findTranscript);
    if (input.apply === true) {
      appendFeatureStageRow(projectRoot, sessionId, dirName, {
        kind: RECORD_REPAIR_KIND,
        reason: REPORT_REPAIR_REASON,
        note,
      });
    }
    changes.push({
      dirName,
      affected_rows: affected.length,
      note,
      written: input.apply === true,
    });
  }
  return changes;
}

export function claudeTranscriptFinder(home: string): TranscriptFinder {
  return (agentId, sessionId) => {
    const projects = join(home, '.claude/projects');
    if (!existsSync(projects)) return null;
    for (const project of readdirSync(projects)) {
      const path = join(projects, project, sessionId, 'subagents', `agent-${agentId}.jsonl`);
      if (existsSync(path)) return path;
    }
    return null;
  };
}
