export interface PaqadSchemaMarker {
  paqad_schema_version: string;
  written_at: string;
  written_by_engine_version: string;
}

export interface SchemaMigrationRecord {
  from_version: string | null;
  to_version: string;
  migrated_at: string;
  engine_version: string;
  file: string;
  notes?: string[];
}

export type SchemaCompatibility = 'compatible' | 'needs-migration' | 'future';
