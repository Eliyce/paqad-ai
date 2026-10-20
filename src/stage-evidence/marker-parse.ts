import { sessionClosedAnyFeature } from '@/feature-evidence/adoption.js';
import { currentFeature, readFeatureStageUnit } from '@/feature-evidence/stage-ledger.js';
import { routeIsAffirmativelyNonFeature } from '@/pipeline/route-gate.js';
import { keepingLedgerSessionCache, resolveSessionId } from '@/rag-ledger/session.js';

import { normalizeArtifactPath } from './artifact-path.js';
import { checkBundleArtifacts } from './bundle-artifact.js';
import { recordMarkedStage, type MarkedStagePhase } from './live-writer.js';

const MARKER = /^[ \t>*-]*paqad:stage\s+([a-z_]+)\s+(start|end)(?:\s+--\s+(\S+))?\s*$/gim;

export interface MarkerParseInput {
  projectRoot: string;
  transcriptText?: string;
  sessionId?: string | null;
  keepSessionCache?: boolean;
  adapter?: string;
  now?: () => Date;
}

export interface Marker {
  stage: string;
  phase: MarkedStagePhase;
  artifactPath?: string;
}

export function extractAssistantText(raw: string): string {
  const parts: string[] = [];
  let sawJson = false;
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }
    sawJson = true;
    const record = obj as {
      type?: string;
      role?: string;
      content?: unknown;
      message?: { role?: string; content?: unknown };
      payload?: { role?: string; content?: unknown };
    };
    const container = record.message ?? record.payload;
    const role = container?.role ?? record.role ?? record.type;
    if (role !== 'assistant') continue;
    const content = container?.content ?? record.content;
    parts.push(collectText(content));
  }
  return sawJson ? parts.join('\n') : raw;
}

function collectText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) =>
      block && typeof block === 'object' && typeof (block as { text?: unknown }).text === 'string'
        ? (block as { text: string }).text
        : '',
    )
    .join('\n');
}

export function extractMarkers(text: string): Marker[] {
  const out: Marker[] = [];
  MARKER.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MARKER.exec(text)) !== null) {
    const marker: Marker = { stage: match[1], phase: match[2] as MarkedStagePhase };
    if (marker.phase === 'end' && match[3]) marker.artifactPath = match[3];
    out.push(marker);
  }
  return out;
}

export function parseAndRecordMarkers(input: MarkerParseInput): Marker[] {
  if (input.keepSessionCache === true) {
    return keepingLedgerSessionCache(input.projectRoot, () => recordMarkers(input));
  }
  return recordMarkers(input);
}

function recordMarkers(input: MarkerParseInput): Marker[] {
  try {
    const raw = input.transcriptText;
    if (!raw) return [];
    const markers = extractMarkers(extractAssistantText(raw));
    if (markers.length === 0) return [];

    const sessionId = resolveSessionId(input.projectRoot, input.sessionId);
    if (routeIsAffirmativelyNonFeature(input.projectRoot, sessionId)) return [];
    const dirName = currentFeature(input.projectRoot, sessionId);
    if (!dirName && sessionClosedAnyFeature(input.projectRoot, sessionId)) return [];
    const existing = dirName ? readFeatureStageUnit(input.projectRoot, dirName) : [];
    const seen = new Set<string>();
    for (const row of existing) {
      if (typeof row.stage !== 'string') continue;
      if (row.kind === 'stage_start') seen.add(`${row.stage}:start`);
      if (row.kind === 'stage_end') seen.add(`${row.stage}:end`);
    }

    const recorded: Marker[] = [];
    for (const { stage, phase, artifactPath } of markers) {
      const key = `${stage}:${phase}`;
      if (seen.has(key)) continue;
      let normalizedArtifact: string | undefined;
      if (artifactPath) {
        try {
          normalizedArtifact = normalizeArtifactPath(input.projectRoot, artifactPath);
        } catch {
          normalizedArtifact = undefined;
        }
        if (normalizedArtifact) {
          const check = checkBundleArtifacts(input.projectRoot, sessionId, stage, [
            normalizedArtifact,
          ]);
          if (check.accepted.length === 0) {
            normalizedArtifact = undefined;
          }
        }
      }
      if (
        recordMarkedStage(input.projectRoot, {
          sessionId,
          stage,
          phase,
          artifactPaths: normalizedArtifact ? [normalizedArtifact] : undefined,
          adapter: input.adapter,
          now: input.now,
        })
      ) {
        seen.add(key);
        recorded.push({ stage, phase, artifactPath });
      }
    }
    return recorded;
  } catch {
    return [];
  }
}
