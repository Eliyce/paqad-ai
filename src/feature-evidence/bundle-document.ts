import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

import { dirname, join } from 'pathe';

import { buildDocumentEnvelope, type EnvelopeHeader } from './envelope.js';
import { readFeatureRecord } from './feature-record.js';
import { featureChangeKey, featureFilePath, type FeatureBundleFile } from './paths.js';

export const UNKNOWN_DOCUMENT_SESSION = 'unknown';

export function documentSessionId(
  projectRoot: string,
  dirName: string,
  sessionId?: string | null,
): string {
  const given = sessionId?.trim();
  if (given) return given;
  return readFeatureRecord(projectRoot, dirName)?.session_id ?? UNKNOWN_DOCUMENT_SESSION;
}

export interface StampFeatureDocumentInput<B extends Record<string, unknown>> {
  projectRoot: string;
  dirName: string;
  docType: string;
  schemaVersion: number;
  sessionId?: string | null;
  body: B;
  now?: () => Date;
}

export function stampFeatureDocument<B extends Record<string, unknown>>(
  input: StampFeatureDocumentInput<B>,
): EnvelopeHeader & B {
  return buildDocumentEnvelope({
    docType: input.docType,
    change: featureChangeKey(input.dirName),
    sessionId: documentSessionId(input.projectRoot, input.dirName, input.sessionId),
    schemaVersion: input.schemaVersion,
    now: input.now,
    body: input.body,
  });
}

export function readFeatureIndexEntries<E>(
  projectRoot: string,
  dirName: string,
  file: FeatureBundleFile,
  key: string,
): E[] | null {
  try {
    const parsed = JSON.parse(
      readFileSync(join(projectRoot, featureFilePath(dirName, file)), 'utf8'),
    ) as Record<string, unknown>;
    return Array.isArray(parsed[key]) ? (parsed[key] as E[]) : null;
  } catch {
    return null;
  }
}

export interface WriteFeatureIndexInput<E> {
  projectRoot: string;
  dirName: string;
  file: FeatureBundleFile;
  key: string;
  docType: string;
  schemaVersion: number;
  entries: E[];
  sessionId?: string | null;
  now?: () => Date;
}

export function writeFeatureIndexDocument<E>(input: WriteFeatureIndexInput<E>): {
  path: string | null;
  written: boolean;
} {
  const rel = featureFilePath(input.dirName, input.file);
  const current = readFeatureIndexEntries<E>(
    input.projectRoot,
    input.dirName,
    input.file,
    input.key,
  );
  if (current === null && input.entries.length === 0) {
    return { path: null, written: false };
  }
  if (current !== null && JSON.stringify(current) === JSON.stringify(input.entries)) {
    return { path: rel, written: false };
  }
  const doc = stampFeatureDocument({
    projectRoot: input.projectRoot,
    dirName: input.dirName,
    docType: input.docType,
    schemaVersion: input.schemaVersion,
    sessionId: input.sessionId,
    body: { [input.key]: input.entries },
    now: input.now,
  });
  const abs = join(input.projectRoot, rel);
  mkdirSync(dirname(abs), { recursive: true });
  const tmp = `${abs}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  renameSync(tmp, abs);
  return { path: rel, written: true };
}
