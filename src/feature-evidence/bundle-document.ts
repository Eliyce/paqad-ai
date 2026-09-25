// Envelope stamping for the per-feature documents (issue #581, FR-5).
//
// `feature.json`, `plan.json` and `review.json` are built by `mint.ts`, which always knows the
// session writing them. The other bundle documents (`delivery.json`, `checks.json`,
// `visual-evidence.json`, `rules-loaded.json`) are written by verbs and git hooks that do not
// always have one: a `post-commit` hook runs outside any agent session. This module is the one
// place those writers stamp the header, so each carries the same `change` (the folder-name
// ULID) and a `session_id` that is never invented: the caller's session when it has one, else
// the session that opened the change, as recorded in `feature.json`.

import { buildDocumentEnvelope, type EnvelopeHeader } from './envelope.js';
import { readFeatureRecord } from './feature-record.js';
import { featureChangeKey } from './paths.js';

/** The `session_id` a document carries when neither the caller nor `feature.json` knows one. */
export const UNKNOWN_DOCUMENT_SESSION = 'unknown';

/**
 * The session a bundle document is stamped with: `sessionId` when the writer has one, else the
 * session that opened the change (`feature.json`), else {@link UNKNOWN_DOCUMENT_SESSION}.
 */
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
  /** The writer's session, when it has one (see {@link documentSessionId}). */
  sessionId?: string | null;
  body: B;
  /** Clock seam for tests. */
  now?: () => Date;
}

/** Stamp one bundle document with the envelope header for the change `dirName` names. */
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
