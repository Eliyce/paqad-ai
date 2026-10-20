import { buildDocumentEnvelope, type EnvelopeHeader } from './envelope.js';
import { readFeatureRecord } from './feature-record.js';
import { featureChangeKey } from './paths.js';

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
