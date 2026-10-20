import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { readDeprecation, type JsDocTagLike } from '../deprecation.js';
import { resolveInstalledVersion, resolveTypesEntry } from '../resolve-version.js';
import { loadTypeScript, type TypeScriptModule } from '../typescript-loader.js';
import type {
  FrameworkApiAdapter,
  FrameworkApiAdapterInput,
  FrameworkApiAdapterResult,
  FrameworkApiSymbol,
  FrameworkApiSymbolKind,
} from '../types.js';

import { dynamicRecord, projectRelative } from './shared.js';

const MAX_DRILLED_CONTAINERS = 200;

interface TsSymbolLike {
  getName(): string;
  flags: number;
  getJsDocTags(checker?: unknown): JsDocTagLike[];
}

function symbolKind(ts: TypeScriptModule, flags: number): FrameworkApiSymbolKind {
  const f = ts.SymbolFlags;
  if (flags & (f.Function | f.Method)) return 'function';
  if (flags & f.Class) return 'class';
  if (flags & f.Interface) return 'interface';
  if (flags & (f.TypeAlias | f.TypeParameter)) return 'type';
  if (flags & (f.Enum | f.EnumMember)) return 'enum';
  if (flags & (f.Module | f.NamespaceModule | f.ValueModule)) return 'namespace';
  if (flags & (f.Variable | f.BlockScopedVariable | f.Property)) return 'variable';
  return 'unknown';
}

function toRecord(
  ts: TypeScriptModule,
  checker: unknown,
  symbol: TsSymbolLike,
  name: string,
  kindOverride?: FrameworkApiSymbolKind,
): FrameworkApiSymbol {
  const deprecation = readDeprecation(symbol.getJsDocTags(checker));
  return {
    name,
    kind: kindOverride ?? symbolKind(ts, symbol.flags),
    exists: true,
    deprecated: deprecation.deprecated,
    message: deprecation.message,
    since: deprecation.since,
    for_removal: deprecation.for_removal,
    provenance: 'asserted',
  };
}

export const nodeFrameworkApiAdapter: FrameworkApiAdapter = {
  ecosystem: 'node',

  resolveInstalled(searchRoot, packageName) {
    return resolveInstalledVersion(searchRoot, packageName);
  },

  contentHash(input: FrameworkApiAdapterInput): string {
    const entry = resolveTypesEntry(input.searchRoot, input.package, input.packageDir);
    const hash = createHash('sha256').update(`${input.package}@${input.version}`);
    if (entry !== null) {
      hash.update(entry);
      try {
        hash.update(readFileSync(entry));
        /* v8 ignore next 4 -- resolveTypesEntry only returns a path it just read, so this catch needs the file to vanish mid-build; the entry still hashes by path+version and the build records `no-types`, so a stale surface is never passed off as current. */
      } catch {}
    }
    return `sha256:${hash.digest('hex')}`;
  },

  index(input: FrameworkApiAdapterInput): FrameworkApiAdapterResult {
    const ts = loadTypeScript(input.projectRoot);
    if (ts === null) {
      return {
        indexed: false,
        reason: 'parser-unavailable',
        detail:
          'the TypeScript compiler could not be resolved from this project or from paqad-ai — install typescript to verify framework reuse claims',
      };
    }
    const entry = resolveTypesEntry(input.searchRoot, input.package, input.packageDir);
    if (entry === null) {
      return {
        indexed: false,
        reason: 'no-types',
        detail: `${input.package}@${input.version} ships no .d.ts declarations and has no @types companion installed`,
      };
    }

    const program = ts.createProgram([entry], {
      skipLibCheck: true,
      target: ts.ScriptTarget.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      noEmit: true,
    });
    const checker = program.getTypeChecker();
    const sourceFile = program.getSourceFile(entry);
    /* v8 ignore next -- `entry` is the program's own root file, so it always resolves; the guard exists so a compiler that returned nothing degrades to `no-types` instead of throwing. */
    const moduleSymbol = sourceFile ? checker.getSymbolAtLocation(sourceFile) : undefined;
    if (!moduleSymbol) {
      return {
        indexed: false,
        reason: 'no-types',
        detail: `${input.package}@${input.version} declares no module surface at ${projectRelative(input.projectRoot, entry)}`,
      };
    }

    const symbols: FrameworkApiSymbol[] = [];
    const exported = checker.getExportsOfModule(moduleSymbol) as TsSymbolLike[];
    let drilled = 0;
    for (const symbol of exported) {
      const name = symbol.getName();
      symbols.push(toRecord(ts, checker, symbol, name));
      const isContainer = Boolean(symbol.flags & (ts.SymbolFlags.Class | ts.SymbolFlags.Interface));
      if (!isContainer) {
        continue;
      }
      if (drilled >= MAX_DRILLED_CONTAINERS) {
        symbols.push(dynamicRecord(name));
        continue;
      }
      drilled += 1;
      symbols.push(...drillMembers(ts, checker, symbol, name));
    }

    return {
      indexed: true,
      sources: [projectRelative(input.projectRoot, entry)],
      symbols,
    };
  },
};

function drillMembers(
  ts: TypeScriptModule,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the compiler's checker is opaque here
  checker: any,
  container: TsSymbolLike,
  containerName: string,
): FrameworkApiSymbol[] {
  let type: unknown;
  try {
    type = checker.getDeclaredTypeOfSymbol(container);
    /* v8 ignore next 3 -- defensive guard on an opaque compiler API: no authorable declaration makes getDeclaredTypeOfSymbol throw, but a compiler-version change must degrade to the wildcard rather than let members read absent (INV-2). */
  } catch {
    return [dynamicRecord(containerName)];
  }
  /* v8 ignore next 2 -- the same guard, for a type object that exposes no getProperties. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- structural compiler type
  const properties = ((type as any)?.getProperties?.() ?? []) as TsSymbolLike[];
  const records = properties
    .map((property) =>
      toRecord(ts, checker, property, `${containerName}.${property.getName()}`, 'member'),
    )
    .filter((record) => record.deprecated);
  records.push(dynamicRecord(containerName));
  return records;
}
