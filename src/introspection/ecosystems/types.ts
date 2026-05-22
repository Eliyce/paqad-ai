import type { StackEcosystem } from '@/core/types/introspection.js';

export interface ParsedManifestPackage {
  name: string;
  constraint?: string;
  isDev?: boolean;
}

export interface ParsedManifest {
  ecosystem: StackEcosystem;
  packages: ParsedManifestPackage[];
  scripts?: Record<string, string>;
}

export interface ParsedLockfilePackage {
  name: string;
  version: string;
}

export interface ParsedLockfile {
  ecosystem: StackEcosystem;
  packages: ParsedLockfilePackage[];
}

export interface EcosystemParser {
  ecosystem: StackEcosystem;
  packageManager: string;
  manifestFiles: string[];
  lockfileFiles: string[];
  parseManifest(content: string, filename: string): ParsedManifest;
  parseLockfile(content: string, filename: string): ParsedLockfile;
}
