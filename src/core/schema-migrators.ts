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
// The registry is intentionally EMPTY at the baseline (PAQAD_SCHEMA_VERSION
// 1.0.0): the first real migrator lands when a capability bumps its record shape
// (buildout F4+). `runSchemaMigrators` takes the migrator list as an injectable
// argument (defaulting to the registry) so a migration's dispatch can be tested
// without a global-registry mutation — mirroring the injectable-validator pattern
// in src/stage-evidence/recorder.ts.

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
 * The production registry. Frozen and empty at the 1.0.0 baseline; a capability
 * adds its migrator here (as a literal) when it first changes record shape.
 */
export const SCHEMA_MIGRATORS: readonly SchemaMigrator[] = Object.freeze([]);

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
