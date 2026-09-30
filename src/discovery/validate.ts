// Discovery artifact validation (issue #597).
//
// Before a dependent Discovery operation trusts an artifact, this gate rejects it when it is on the
// wrong path, malformed, from another run, owned by another session, stale (its content hash no
// longer matches its bytes), or the wrong artifact for the stage (DW-07, DW-08). A blank template
// or a model-authored JSON never clears the gate: the writer stamped the hash, so a hand edit is
// detectable. Nothing here throws — the caller gets a precise reason and decides.

import { readFileSync } from 'node:fs';
import { join } from 'pathe';

import { documentHashMatches } from '@/feature-evidence/envelope.js';

import { discoveryRunChangeKey, discoveryRunDir } from './paths.js';
import { readDiscoveryRun } from './run-store.js';

export type DiscoveryValidationReason =
  | 'ok'
  | 'wrong-path'
  | 'missing'
  | 'malformed'
  | 'foreign-run'
  | 'foreign-owner'
  | 'stale'
  | 'wrong-artifact';

export interface DiscoveryValidationResult {
  ok: boolean;
  reason: DiscoveryValidationReason;
  /** A human-readable explanation + recovery hint. */
  detail: string;
}

function fail(reason: DiscoveryValidationReason, detail: string): DiscoveryValidationResult {
  return { ok: false, reason, detail };
}

/**
 * Validate a Discovery artifact JSON document for a run before a dependent operation trusts it.
 *
 * @param sessionId the session asking to use the artifact; ownership is the RUN's owner session, so
 *   a session that does not own the run is rejected as `foreign-owner` (DW-10, INV-5).
 * @param artifactRelPath project-relative path to the artifact (must be inside the run dir).
 * @param expectedDocType the doc type the stage requires, or undefined to skip the artifact-kind
 *   check.
 */
export function validateDiscoveryArtifact(
  projectRoot: string,
  dirName: string,
  sessionId: string,
  artifactRelPath: string,
  expectedDocType?: string,
): DiscoveryValidationResult {
  const runDir = discoveryRunDir(dirName);
  const normalized = artifactRelPath.replace(/\\/g, '/');
  if (normalized !== runDir && !normalized.startsWith(`${runDir}/`)) {
    return fail('wrong-path', `artifact ${artifactRelPath} is outside the run dir ${runDir}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(join(projectRoot, artifactRelPath), 'utf8'));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return fail('missing', `artifact ${artifactRelPath} does not exist`);
    }
    return fail('malformed', `artifact ${artifactRelPath} is not readable JSON`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return fail('malformed', `artifact ${artifactRelPath} is not a JSON object`);
  }
  const doc = parsed as Record<string, unknown>;

  const runChange = discoveryRunChangeKey(dirName);
  if (doc.change !== runChange) {
    return fail(
      'foreign-run',
      `artifact names run ${String(doc.change)}, not this run ${runChange}`,
    );
  }

  // Ownership is proven by the run's own owner stamp. If run.json is missing or unreadable the
  // owner cannot be established, so the gate fails CLOSED rather than trusting the artifact (a
  // deleted/corrupted owner record must never validate as owner-OK for any caller).
  const owner = readDiscoveryRun(projectRoot, dirName)?.session_id ?? null;
  if (owner === null || doc.session_id !== owner || sessionId !== owner) {
    return fail(
      'foreign-owner',
      owner === null
        ? `the run owner cannot be established (run.json missing or unreadable)`
        : `artifact/session is not the run owner (${owner}); an ownership transfer is required`,
    );
  }

  if (expectedDocType !== undefined && doc.doc_type !== expectedDocType) {
    return fail(
      'wrong-artifact',
      `artifact is ${String(doc.doc_type)}, not the expected ${expectedDocType}`,
    );
  }

  const hashOk = documentHashMatches(doc);
  if (hashOk === false) {
    return fail('stale', `artifact ${artifactRelPath} was edited outside a writer (hash mismatch)`);
  }

  return { ok: true, reason: 'ok', detail: 'artifact is valid' };
}
