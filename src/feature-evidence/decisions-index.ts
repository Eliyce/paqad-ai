import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

import { dirname, join } from 'pathe';

import { sha256Hex } from '@/compliance/markdown.js';
import { PATHS } from '@/core/constants/paths.js';

import { stampFeatureDocument } from './bundle-document.js';
import { readFeatureRecord } from './feature-record.js';
import { featureChangeKey, featureFilePath } from './paths.js';
import { DECISIONS_DOC_TYPE, FEATURE_DOC_SCHEMA_VERSION } from './types.js';

export interface DecisionIndexEntry {
  id: string;
  category: string;
  path: string;
  content_hash: string;
}

export interface IndexedDecisionView extends DecisionIndexEntry {
  title: string | null;
  chosen: string | null;
  chosen_label: string | null;
  rationale: string | null;
  state: 'current' | 'changed' | 'missing';
}

interface LoosePacket {
  id?: unknown;
  decision_id?: unknown;
  category?: unknown;
  change?: unknown;
  context?: unknown;
  title?: unknown;
  question?: unknown;
  chosen?: unknown;
  rationale?: unknown;
  resolved_at?: unknown;
  created_at?: unknown;
  options?: { option_key?: unknown; label?: unknown }[];
  human_response?: { chosen_option_key?: unknown; responded_at?: unknown; note?: unknown };
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function parsePacket(raw: string): LoosePacket | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as LoosePacket)
      : null;
  } catch {
    return null;
  }
}

function resolvedAt(packet: LoosePacket): number {
  const iso =
    text(packet.resolved_at) ??
    text(packet.human_response?.responded_at) ??
    text(packet.created_at);
  return iso === null ? Number.NaN : Date.parse(iso);
}

function changeWindow(projectRoot: string, dirName: string): { from: number; to: number } | null {
  const record = readFeatureRecord(projectRoot, dirName);
  if (record === null) return null;
  return {
    from: Date.parse(record.recorded_at),
    to: record.status === 'done' ? Date.parse(record.updated_at) : Number.POSITIVE_INFINITY,
  };
}

function linkedTo(
  packet: LoosePacket,
  changeKey: string,
  window: { from: number; to: number } | null,
): boolean {
  const named = text(packet.change);
  if (named !== null) return named === changeKey;
  if (typeof packet.context === 'string' && packet.context.includes(changeKey)) return true;
  if (window === null) return false;
  const at = resolvedAt(packet);
  return at >= window.from && at <= window.to;
}

export function collectFeatureDecisions(
  projectRoot: string,
  dirName: string,
): DecisionIndexEntry[] {
  const changeKey = featureChangeKey(dirName);
  const window = changeWindow(projectRoot, dirName);
  let files: string[];
  try {
    files = readdirSync(join(projectRoot, PATHS.DECISIONS_RESOLVED_DIR));
  } catch {
    return [];
  }
  const entries: DecisionIndexEntry[] = [];
  for (const file of files.filter((name) => /^D-.+\.json$/.test(name))) {
    const path = join(PATHS.DECISIONS_RESOLVED_DIR, file);
    const raw = readFileSync(join(projectRoot, path), 'utf8');
    const packet = parsePacket(raw);
    if (packet === null || !linkedTo(packet, changeKey, window)) continue;
    entries.push({
      id: text(packet.id) ?? text(packet.decision_id) ?? file.replace(/\.json$/, ''),
      category: text(packet.category) ?? 'unknown',
      path,
      content_hash: sha256Hex(raw),
    });
  }
  return entries.sort((a, b) => a.id.localeCompare(b.id));
}

export function readFeatureDecisionsIndex(
  projectRoot: string,
  dirName: string,
): DecisionIndexEntry[] | null {
  try {
    const parsed = JSON.parse(
      readFileSync(join(projectRoot, featureFilePath(dirName, 'decisions')), 'utf8'),
    ) as { decisions?: unknown };
    return Array.isArray(parsed.decisions) ? (parsed.decisions as DecisionIndexEntry[]) : null;
  } catch {
    return null;
  }
}

export interface WriteDecisionsIndexResult {
  path: string | null;
  decisions: DecisionIndexEntry[];
  written: boolean;
}

export function writeFeatureDecisionsIndex(
  projectRoot: string,
  dirName: string,
  options: { sessionId?: string | null; now?: () => Date } = {},
): WriteDecisionsIndexResult {
  const decisions = collectFeatureDecisions(projectRoot, dirName);
  const rel = featureFilePath(dirName, 'decisions');
  const current = readFeatureDecisionsIndex(projectRoot, dirName);
  if (current === null && decisions.length === 0) {
    return { path: null, decisions, written: false };
  }
  if (current !== null && JSON.stringify(current) === JSON.stringify(decisions)) {
    return { path: rel, decisions, written: false };
  }
  const doc = stampFeatureDocument({
    projectRoot,
    dirName,
    docType: DECISIONS_DOC_TYPE,
    schemaVersion: FEATURE_DOC_SCHEMA_VERSION,
    sessionId: options.sessionId,
    body: { decisions },
    now: options.now,
  });
  const abs = join(projectRoot, rel);
  mkdirSync(dirname(abs), { recursive: true });
  const tmp = `${abs}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  renameSync(tmp, abs);
  return { path: rel, decisions, written: true };
}

export function readIndexedDecisionViews(
  projectRoot: string,
  dirName: string,
): IndexedDecisionView[] {
  return (readFeatureDecisionsIndex(projectRoot, dirName) ?? []).map((entry) => {
    let raw: string;
    try {
      raw = readFileSync(join(projectRoot, entry.path), 'utf8');
    } catch {
      return {
        ...entry,
        title: null,
        chosen: null,
        chosen_label: null,
        rationale: null,
        state: 'missing',
      };
    }
    const packet = parsePacket(raw) ?? {};
    const chosen = text(packet.chosen) ?? text(packet.human_response?.chosen_option_key);
    const label = (packet.options ?? []).find((option) => option.option_key === chosen)?.label;
    return {
      ...entry,
      title: text(packet.title) ?? text(packet.question),
      chosen,
      chosen_label: text(label),
      rationale: text(packet.rationale) ?? text(packet.human_response?.note),
      state: sha256Hex(raw) === entry.content_hash ? 'current' : 'changed',
    };
  });
}
