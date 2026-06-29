// PQD-95 — data shapes for the cross-artifact `.paqad/` schema versioning
// baseline. The I/O and migration logic live in `src/core/schema-version.ts`;
// the `SchemaVersionError` thrown on future-schema refusal lives in
// `src/core/errors/schema-version-error.ts`.

/**
 * The authoritative cross-artifact version stamp, written to
 * `PATHS.SCHEMA_MARKER` (`.paqad/schema-version.json`). Every consumer reads
 * this one file to learn whether the `.paqad/` layout is compatible with the
 * engine it is running.
 */
export interface PaqadSchemaMarker {
  /** Semver of the `.paqad/` layout (see `PAQAD_SCHEMA_VERSION`). */
  paqad_schema_version: string;
  /** ISO-8601 timestamp of when this marker was last written. */
  written_at: string;
  /** The engine release version that last wrote the marker. */
  written_by_engine_version: string;
}

/**
 * One appended line in `PATHS.SCHEMA_MIGRATION_LOG`
 * (`.paqad/schema-migrations.jsonl`), recording a single forward migration.
 * `from_version` is `null` when a legacy/corrupt marker was reset to the
 * current baseline rather than migrated from a known earlier version.
 */
export interface SchemaMigrationRecord {
  from_version: string | null;
  to_version: string;
  /** ISO-8601 timestamp of when the migration ran. */
  migrated_at: string;
  /** The engine release version that performed the migration. */
  engine_version: string;
  /** The `.paqad/`-relative path of the file that was migrated. */
  file: string;
  /**
   * One note per per-artifact migrator that ran during this migration (buildout
   * F1). Absent when no migrator applied to the transition — so a baseline
   * marker-only bump records exactly as it did before this field existed.
   */
  notes?: string[];
}

/** Outcome of comparing a marker's version against the running engine. */
export type SchemaCompatibility = 'compatible' | 'needs-migration' | 'future';
