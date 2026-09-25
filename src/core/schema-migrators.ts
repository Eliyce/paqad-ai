// Capability Kernel — the per-artifact forward-migration registry (buildout F1).
//
// `checkAndMigrateSchema` (src/core/schema-version.ts) used to advance the schema
// marker with NO data migration — its needs-migration branch carried a literal
// "future versions add steps here" placeholder. That meant a capability could
// never change its on-disk record shape without silently orphaning every
// already-onboarded project's prior rows (the verified C4 gap). This module is
// the seam those steps plug into: each artifact/capability registers a forward
// migrator that runs, idempotently and under the existing migration lock, before
// the marker is rewritten.
//
// The registry was empty at the 1.0.0 baseline. The first real migrator is the
// issue #581 evidence migration (1.1.0), which moves the spec pipeline's old run
// folders into the change bundles. `runSchemaMigrators` takes the migrator list as an injectable
// argument (defaulting to the registry) so a migration's dispatch can be tested
// without a global-registry mutation — mirroring the injectable-validator pattern
// in src/stage-evidence/recorder.ts.

import {
  formatEvidenceMigration,
  migrateFeatureEvidence,
  migrationSessionId,
} from '@/feature-evidence/migrate.js';

/** Context handed to every migrator: the project and the version transition. */
export interface SchemaMigrationContext {
  projectRoot: string;
  /** The project's current marker version (the version we migrate FROM). */
  fromVersion: string;
  /** The running engine's version (the version we migrate TO). */
  toVersion: string;
  /** The engine release performing the migration (for logging). */
  engineVersion: string;
}

/**
 * One forward migrator for a single `.paqad/` artifact or capability record.
 * Migrators MUST be idempotent: `checkAndMigrateSchema` re-checks under the lock,
 * and a migrator may legitimately see an already-partly-migrated tree on a retry.
 */
export interface SchemaMigrator {
  /** Stable id (capability id or artifact name) — used for the migration log. */
  id: string;
  /**
   * Whether this migrator must run for a project moving `fromVersion -> toVersion`.
   * Keep it narrow (own only the transitions you actually change shape across) so
   * an unrelated marker bump never runs every migrator.
   */
  appliesTo(fromVersion: string, toVersion: string): boolean;
  /**
   * Idempotently migrate this artifact's on-disk rows forward. Returns a short
   * human note recorded alongside the migration record, or nothing.
   */
  migrate(context: SchemaMigrationContext): Promise<string | void>;
}

/**
 * Issue #581 — move a project written before 1.1.0 onto the one-packet evidence layout. It runs
 * on the silent-update path through `checkAndMigrateSchema`. It never throws on one bad change
 * (a failed run is left in place and named in the note), so a bad folder cannot wedge updates.
 */
export const FEATURE_EVIDENCE_MIGRATOR: SchemaMigrator = {
  id: 'feature-evidence',
  // Every layout before 1.1.0 is a 0.x or 1.0.x marker.
  appliesTo: (fromVersion) => /^(0|1\.0)\./.test(fromVersion.trim()),
  migrate: async ({ projectRoot }) => {
    // An unexpected throw (a locked file on Windows, say) must not abort the update. The old
    // folder is still there in that case, so the pending step every update and onboarding runs
    // (runPendingEvidenceMigration) picks the migration up again next time.
    try {
      const result = migrateFeatureEvidence(projectRoot, { sessionId: migrationSessionId() });
      return result.actions.length === 0 ? undefined : formatEvidenceMigration(result);
    } catch (error) {
      return `the evidence migration did not finish (${(error as Error).message}); it runs again on the next update, or run \`paqad-ai evidence migrate\`.`;
    }
  },
};

/**
 * The production registry, frozen. A capability adds its migrator here (as a literal) when it
 * first changes record shape.
 */
export const SCHEMA_MIGRATORS: readonly SchemaMigrator[] = Object.freeze([
  FEATURE_EVIDENCE_MIGRATOR,
]);

/**
 * Run every migrator applicable to `context.fromVersion -> context.toVersion`, in
 * registration order, collecting a note per migrator that ran. A migrator that
 * returns no note is recorded by id alone. Throws if a migrator throws — the
 * caller runs this inside `withSchemaMigrationLock` and must NOT advance the
 * marker if a migrator failed, so a partial migration is retried, never sealed.
 */
export async function runSchemaMigrators(
  context: SchemaMigrationContext,
  migrators: readonly SchemaMigrator[] = SCHEMA_MIGRATORS,
): Promise<string[]> {
  const notes: string[] = [];
  for (const migrator of migrators) {
    if (!migrator.appliesTo(context.fromVersion, context.toVersion)) {
      continue;
    }
    const note = await migrator.migrate(context);
    notes.push(note ? `${migrator.id}: ${note}` : migrator.id);
  }
  return notes;
}
