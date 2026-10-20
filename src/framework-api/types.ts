import type { StackEcosystem } from '@/core/types/introspection.js';

export const FRAMEWORK_API_SCHEMA_VERSION = 1;

export type FrameworkApiProvenance = 'asserted' | 'unknown-dynamic' | 'doc-derived';

export type FrameworkApiSymbolKind =
  | 'function'
  | 'class'
  | 'interface'
  | 'type'
  | 'variable'
  | 'enum'
  | 'namespace'
  | 'member'
  | 'unknown';

export interface FrameworkApiSymbol {
  name: string;
  kind: FrameworkApiSymbolKind;
  exists: boolean;
  deprecated: boolean;
  message: string | null;
  since: string | null;
  for_removal: boolean;
  provenance: FrameworkApiProvenance;
}

export interface FrameworkApiPackage {
  package: string;
  version: string;
  ecosystem: StackEcosystem;
  root: string;
  content_hash: string;
  sources: string[];
  symbols: FrameworkApiSymbol[];
}

export interface FrameworkApiBlocked {
  package: string;
  ecosystem: StackEcosystem;
  reason: 'no-adapter' | 'not-installed' | 'no-types' | 'parser-unavailable';
  detail: string;
}

export interface FrameworkApiHeader {
  generated_at: string;
  schema_version: number;
}

export interface FrameworkApiIndex {
  schema_version: number;
  header: FrameworkApiHeader;
  packages: FrameworkApiPackage[];
  blocked: FrameworkApiBlocked[];
}

export interface FrameworkApiAdapterInput {
  projectRoot: string;
  searchRoot: string;
  package: string;
  version: string;
  packageDir: string;
}

export type FrameworkApiAdapterResult =
  | { indexed: true; sources: string[]; symbols: FrameworkApiSymbol[] }
  | { indexed: false; reason: FrameworkApiBlocked['reason']; detail: string };

export interface FrameworkApiAdapter {
  ecosystem: StackEcosystem;
  resolveInstalled(
    searchRoot: string,
    packageName: string,
  ): { dir: string; version: string } | null;
  contentHash(input: FrameworkApiAdapterInput): string;
  index(input: FrameworkApiAdapterInput): FrameworkApiAdapterResult;
}
