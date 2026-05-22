import type { InstalledPackage, ToolchainInfo } from '@/core/types/introspection.js';

import { readProjectFile } from './shared.js';
import { dartParser } from './dart.js';
import { goParser } from './go.js';
import { jvmParser } from './jvm.js';
import { npmParser } from './node-npm.js';
import { pnpmParser } from './node-pnpm.js';
import { phpParser } from './php.js';
import { pythonParser } from './python.js';
import { rubyParser } from './ruby.js';
import { rustParser } from './rust.js';
import type { EcosystemParser } from './types.js';

export interface ParsedProjectResult {
  toolchain: ToolchainInfo;
  packages: InstalledPackage[];
}

export class EcosystemParserRegistry {
  private readonly parsers: EcosystemParser[] = [];

  constructor(parsers: EcosystemParser[] = []) {
    for (const parser of parsers) {
      this.register(parser);
    }
  }

  register(parser: EcosystemParser): void {
    this.parsers.push(parser);
  }

  list(): EcosystemParser[] {
    return [...this.parsers];
  }

  getKnownFiles(): string[] {
    return Array.from(
      new Set(this.parsers.flatMap((parser) => [...parser.manifestFiles, ...parser.lockfileFiles])),
    ).sort();
  }

  async parseProject(projectRoot: string): Promise<ParsedProjectResult[]> {
    const results: ParsedProjectResult[] = [];

    for (const parser of this.parsers) {
      const manifest = await findFirstExistingFile(projectRoot, parser.manifestFiles);
      if (manifest === null) {
        continue;
      }

      const parsedManifest = parser.parseManifest(manifest.content, manifest.filename);
      const lockfile = await findFirstExistingFile(projectRoot, parser.lockfileFiles);
      const parsedLockfile =
        lockfile === null
          ? { ecosystem: parser.ecosystem, packages: [] }
          : parser.parseLockfile(lockfile.content, lockfile.filename);
      const lockedVersions = new Map(parsedLockfile.packages.map((pkg) => [pkg.name, pkg.version]));

      results.push({
        toolchain: {
          ecosystem: parser.ecosystem,
          package_manager: parser.packageManager,
          lockfile: lockfile?.filename ?? parser.lockfileFiles[0] ?? '',
        },
        packages: parsedManifest.packages
          .map((pkg) => ({
            name: pkg.name,
            version_constraint: pkg.constraint ?? 'unknown',
            locked_version: lockedVersions.get(pkg.name) ?? pkg.constraint ?? 'unknown',
            ecosystem: parser.ecosystem,
            is_dev: pkg.isDev ?? false,
          }))
          .sort((left, right) => left.name.localeCompare(right.name)),
      });
    }

    return results;
  }
}

async function findFirstExistingFile(
  projectRoot: string,
  filenames: string[],
): Promise<{ filename: string; content: string } | null> {
  for (const filename of filenames) {
    const content = await readProjectFile(projectRoot, filename);
    if (content !== null) {
      return { filename, content };
    }
  }

  return null;
}

export function createDefaultEcosystemParserRegistry(): EcosystemParserRegistry {
  return new EcosystemParserRegistry([
    pnpmParser,
    npmParser,
    phpParser,
    dartParser,
    pythonParser,
    rubyParser,
    jvmParser,
    goParser,
    rustParser,
  ]);
}
