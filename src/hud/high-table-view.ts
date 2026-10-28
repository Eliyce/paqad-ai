import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { readSpecAdoption } from '@/feature-evidence/manifest.js';
import { featureFilePath } from '@/feature-evidence/paths.js';
import {
  CHIEF_ROLE,
  foldHighTable,
  highTableDoneTimes,
  readHighTable,
  type FoldedSeat,
} from '@/spec-pipeline/high-table.js';

export type HudSeatState = 'seated' | 'writing' | 'done';

export interface HudSeatTokens {
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
  total: number;
}

export interface HudTrackRecord {
  changes: number;
  changed_spec: number;
  empty: number;
  avg_tokens: number;
}

export interface HudSeat {
  role: string;
  reason: string | null;
  origin: string | null;
  state: HudSeatState;
  seated_at: string | null;
  started_at: string | null;
  done_at: string | null;
  budget_tokens: number | null;
  clamped: boolean | null;
  tokens_estimate: number | null;
  tokens: HudSeatTokens | null;
  tokens_exact: boolean;
  findings: number | null;
  late: boolean;
  track_record: HudTrackRecord | null;
}

export interface HudChiefRulings {
  accepted: string[];
  declined: Array<{ id: string; reason: string }>;
  conflicts: Array<{ target: string; recommendation: string; rationale: string }>;
  merged: Array<{ target: string; merged_claim: string; rationale: string }>;
  renames: Array<{ id: string; target: string }>;
  settled: Array<{ target: string; chosen: string; source: string }>;
}

export interface HudChief extends HudSeat {
  verdict: string | null;
}

export interface HudHighTable {
  skipped: boolean;
  met_after_freeze: boolean;
  seats: HudSeat[];
  chief: HudChief | null;
  rulings: HudChiefRulings | null;
  gaps: Array<{ area: string; why_it_matters: string; question: string | null }>;
  questions: { asked: number; auto_answered: Array<{ question: string; source: string }> } | null;
  credits: Array<{ line: string; roles: string[] }>;
}

function readJsonFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.map(asRecord).filter((entry): entry is Record<string, unknown> => entry !== null)
    : [];
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function after(at: string | null, frozenAt: number | null): boolean {
  if (at === null || frozenAt === null) return false;
  const time = Date.parse(at);
  return !Number.isNaN(time) && time > frozenAt;
}

function frozenAtOf(specJson: unknown): number | null {
  const at = str(asRecord(asRecord(specJson)?.frozen)?.frozen_at);
  if (at === null) return null;
  const time = Date.parse(at);
  return Number.isNaN(time) ? null : time;
}

function seatFrom(
  role: string,
  entry: Record<string, unknown> | null,
  folded: FoldedSeat | undefined,
  recordedFindings: number | null,
  frozenAt: number | null,
): HudSeat {
  const tokensUsed = num(entry?.tokens_used);
  const fallbackState: HudSeatState =
    tokensUsed !== null || (recordedFindings ?? 0) > 0 ? 'done' : 'seated';
  const exact = folded?.tokens ?? null;
  return {
    role,
    reason: folded?.reason ?? str(entry?.reason),
    origin: folded?.origin ?? str(entry?.origin),
    state: folded?.state ?? fallbackState,
    seated_at: folded?.seated_at ?? null,
    started_at: folded?.started_at ?? null,
    done_at: folded?.done_at ?? null,
    budget_tokens: folded?.budget_tokens ?? num(entry?.budget_tokens),
    clamped: folded?.clamped ?? null,
    tokens_estimate: folded?.tokens_estimate ?? tokensUsed,
    tokens: exact
      ? {
          input: exact.input,
          output: exact.output,
          cache_read: exact.cache_read,
          cache_write: exact.cache_write,
          total: exact.total,
        }
      : null,
    tokens_exact: exact !== null,
    findings: folded?.findings ?? recordedFindings,
    late: after(folded?.done_at ?? null, frozenAt),
    track_record: null,
  };
}

function rulingsFrom(synthesis: Record<string, unknown>): HudChiefRulings {
  return {
    accepted: Array.isArray(synthesis.accepted)
      ? synthesis.accepted.filter((id): id is string => typeof id === 'string')
      : [],
    declined: records(synthesis.declined).map((entry) => ({
      id: str(entry.id) ?? '',
      reason: str(entry.reason) ?? '',
    })),
    conflicts: records(synthesis.conflicts)
      .filter((entry) => entry.ruling !== 'compatible')
      .map((entry) => ({
        target: str(entry.target) ?? '',
        recommendation: str(entry.recommendation) ?? '',
        rationale: str(entry.rationale) ?? '',
      })),
    merged: records(synthesis.conflicts)
      .filter((entry) => entry.ruling === 'compatible')
      .map((entry) => ({
        target: str(entry.target) ?? '',
        merged_claim: str(entry.merged_claim) ?? '',
        rationale: str(entry.rationale) ?? '',
      })),
    renames: records(synthesis.renames).map((entry) => ({
      id: str(entry.id) ?? '',
      target: str(entry.target) ?? '',
    })),
    settled: records(synthesis.auto_resolved).map((entry) => ({
      target: str(entry.target) ?? '',
      chosen: str(entry.chosen) ?? '',
      source: str(entry.source) ?? '',
    })),
  };
}

function chiefFrom(
  folded: FoldedSeat | undefined,
  synthesis: Record<string, unknown> | null,
  frozenAt: number | null,
): HudChief | null {
  if (!folded && !synthesis) return null;
  const seat = seatFrom(CHIEF_ROLE, null, folded, null, frozenAt);
  return {
    ...seat,
    state: synthesis ? 'done' : seat.state,
    tokens_estimate: seat.tokens_estimate ?? num(synthesis?.tokens),
    findings: null,
    verdict: str(synthesis?.verdict),
  };
}

function gapsFrom(synthesis: Record<string, unknown> | null): HudHighTable['gaps'] {
  return records(synthesis?.gaps).map((gap) => ({
    area: str(gap.area) ?? '',
    why_it_matters: str(gap.why_it_matters) ?? '',
    question: str(asRecord(gap.question)?.business_text),
  }));
}

function questionsFrom(projectRoot: string, dirName: string): HudHighTable['questions'] {
  const clarification = asRecord(
    readJsonFile(join(projectRoot, featureFilePath(dirName, 'clarification'))),
  );
  const questions = asRecord(clarification?.questions);
  if (!questions) return null;
  const counts = asRecord(questions.counts);
  return {
    asked: num(counts?.asked) ?? (Array.isArray(questions.asked) ? questions.asked.length : 0),
    auto_answered: records(questions.auto_answered).map((entry) => ({
      question: str(entry.question) ?? '',
      source: str(entry.source) ?? '',
    })),
  };
}

const EXPERT_SOURCE = /^EX-(.+)-\d+$/;

function creditsFrom(specJson: unknown): HudHighTable['credits'] {
  const trace = asRecord(asRecord(specJson)?.trace);
  if (!trace) return [];
  const credits: HudHighTable['credits'] = [];
  for (const [line, source] of Object.entries(trace)) {
    const roles = (typeof source === 'string' ? source.split(/[,\s]+/) : [])
      .map((part) => EXPERT_SOURCE.exec(part)?.[1])
      .filter((role): role is string => typeof role === 'string');
    if (roles.length > 0) credits.push({ line, roles: [...new Set(roles)] });
  }
  return credits;
}

export function buildHighTableView(
  projectRoot: string,
  dirName: string,
  specJson: unknown,
  lane: string | null,
): HudHighTable | null {
  if (lane === 'fast') return null;
  const adoption = readSpecAdoption(specJson);
  if (adoption?.fast_lane) return null;
  const skipped = adoption !== null && !adoption.produced;

  const experts = asRecord(readJsonFile(join(projectRoot, featureFilePath(dirName, 'experts'))));
  const roster = Array.isArray(experts?.roster) ? records(experts.roster) : null;
  const rows = readHighTable(projectRoot, dirName);
  const synthesis = asRecord(experts?.synthesis);
  if (!roster && rows.length === 0) {
    return skipped
      ? {
          skipped,
          met_after_freeze: false,
          seats: [],
          chief: null,
          rulings: null,
          gaps: [],
          questions: null,
          credits: [],
        }
      : null;
  }

  const frozenAt = frozenAtOf(specJson);
  const folded = foldHighTable(rows);
  const findingCounts = new Map<string, number>();
  const recordedFindings = Array.isArray(experts?.findings) ? records(experts.findings) : null;
  for (const finding of recordedFindings ?? []) {
    const role = str(finding.role);
    if (role) findingCounts.set(role, (findingCounts.get(role) ?? 0) + 1);
  }
  const findingsFor = (role: string): number | null =>
    recordedFindings === null ? null : (findingCounts.get(role) ?? 0);

  const roles = [
    ...(roster ?? []).map((entry) => str(entry.role) ?? 'unknown'),
    ...[...folded.keys()].filter((role) => role !== CHIEF_ROLE),
  ];
  const seats = [...new Set(roles)].map((role) =>
    seatFrom(
      role,
      (roster ?? []).find((entry) => entry.role === role) ?? null,
      folded.get(role),
      findingsFor(role),
      frozenAt,
    ),
  );
  const metAfterFreeze = highTableDoneTimes(rows).some((at) => after(at, frozenAt));
  return {
    skipped,
    met_after_freeze: metAfterFreeze,
    seats,
    chief: chiefFrom(folded.get(CHIEF_ROLE), synthesis, frozenAt),
    rulings: synthesis ? rulingsFrom(synthesis) : null,
    gaps: gapsFrom(synthesis),
    questions: questionsFrom(projectRoot, dirName),
    credits: metAfterFreeze ? [] : creditsFrom(specJson),
  };
}
