import {
  formatEvidenceMigration,
  migrateFeatureEvidence,
  migrationSessionId,
} from '@/feature-evidence/migrate.js';

export interface SchemaMigrationContext {
  projectRoot: string;
  fromVersion: string;
  toVersion: string;
  engineVersion: string;
}

export interface SchemaMigrator {
  id: string;
  appliesTo(fromVersion: string, toVersion: string): boolean;
  migrate(context: SchemaMigrationContext): Promise<string | void>;
}

export const FEATURE_EVIDENCE_MIGRATOR: SchemaMigrator = {
  id: 'feature-evidence',
  appliesTo: (fromVersion) => /^(0|1\.0)\./.test(fromVersion.trim()),
  migrate: async ({ projectRoot }) => {
    try {
      const result = migrateFeatureEvidence(projectRoot, { sessionId: migrationSessionId() });
      return result.actions.length === 0 ? undefined : formatEvidenceMigration(result);
    } catch (error) {
      return `the evidence migration did not finish (${(error as Error).message}); it runs again on the next update, or run \`paqad-ai evidence migrate\`.`;
    }
  },
};

export const SCHEMA_MIGRATORS: readonly SchemaMigrator[] = Object.freeze([
  FEATURE_EVIDENCE_MIGRATOR,
]);

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
