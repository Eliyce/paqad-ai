// PQD-95 — cross-artifact `.paqad/` schema versioning baseline.
//
// Every file the engine writes under `.paqad/` carries its own per-file
// `schema_version`. This constant is the *cross-artifact* contract: a single
// authoritative version that describes the `.paqad/` layout as a whole. The
// marker file (`PATHS.SCHEMA_MARKER`) stamps a project with this value so a
// future engine can decide whether the layout is compatible, needs forward
// migration, or is newer than the running engine (refuse).
//
// Bump this when a new `.paqad/` artifact format is introduced or an existing
// one changes shape, and add the corresponding migration step in
// `src/core/schema-version.ts › checkAndMigrateSchema`.
export const PAQAD_SCHEMA_VERSION = '1.0.0';
