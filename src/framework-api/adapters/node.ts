// The JS/TS framework-API adapter (issue #397).
//
// Reads the `.d.ts` declaration layer that physically ships inside the installed package
// and answers, per exported symbol: does it exist, and does it carry a static
// `@deprecated` marker? Zero model tokens, zero network (INV-1).
//
// A hand-rolled declaration scan was rejected during planning for a verified reason:
// `@types/react` puts its whole surface inside `declare namespace React` behind
// `export = React`, so a naive export scan misses `useId` entirely and would report a
// false "absent" — the one verdict that hard-blocks a plan compile. The compiler API
// resolves that transparently, along with `export *` barrels and the `exports` condition
// tree, which is why it is worth resolving a compiler at all.
//
// Dynamism is handled honestly (INV-2). A container whose type carries a string index
// signature provides members at runtime that no declaration lists, so instead of letting
// a lookup fall through to "absent", the adapter records a `<Container>.*` wildcard marked
// `unknown-dynamic`. #398's Laravel facades and Python `__getattr__` reuse that shape.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';

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

/** The wildcard suffix that marks a container as accepting runtime-provided members. */
export const DYNAMIC_MEMBER_SUFFIX = '.*';

/**
 * How many exported containers get drilled for members. Class and interface members are
 * where the most valuable deprecations live (React's legacy lifecycles are members of
 * `Component`, not top-level exports), but drilling every export of every package is what
 * would blow the time budget, so the drill is bounded (AC-7).
 */
const MAX_DRILLED_CONTAINERS = 200;

/** The compiler `Symbol` surface this adapter uses, kept structural. */
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

/** A wildcard record saying "this container also provides members at runtime" (INV-2). */
function dynamicRecord(container: string): FrameworkApiSymbol {
  return {
    name: `${container}${DYNAMIC_MEMBER_SUFFIX}`,
    kind: 'member',
    exists: true,
    deprecated: false,
    message: null,
    since: null,
    for_removal: false,
    provenance: 'unknown-dynamic',
  };
}

export const nodeFrameworkApiAdapter: FrameworkApiAdapter = {
  ecosystem: 'node',

  resolveInstalled(projectRoot, packageName) {
    return resolveInstalledVersion(projectRoot, packageName);
  },

  /**
   * Content-address the declaration inputs. Package + resolved version + the bytes of the
   * declaration entry: within one published version those bytes are immutable, so an equal
   * hash means an equal surface and the stored entry can be reused (FR-13).
   */
  contentHash(input: FrameworkApiAdapterInput): string {
    const entry = resolveTypesEntry(input.projectRoot, input.package, input.packageDir);
    const hash = createHash('sha256').update(`${input.package}@${input.version}`);
    if (entry !== null) {
      hash.update(entry);
      try {
        hash.update(readFileSync(entry));
      } catch {
        // An unreadable entry still hashes by path+version; the index build will record
        // `no-types` for it anyway, so this never silently passes off a stale surface.
      }
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
    const entry = resolveTypesEntry(input.projectRoot, input.package, input.packageDir);
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
    const moduleSymbol = sourceFile ? checker.getSymbolAtLocation(sourceFile) : undefined;
    if (!moduleSymbol) {
      // A declaration file with no module symbol is a global-script `.d.ts`: it declares
      // no exports to resolve, so nothing here can be asserted absent.
      return {
        indexed: false,
        reason: 'no-types',
        detail: `${input.package}@${input.version} declares no module surface at ${relative(input.projectRoot, entry)}`,
      };
    }

    const symbols: FrameworkApiSymbol[] = [];
    const exported = checker.getExportsOfModule(moduleSymbol) as TsSymbolLike[];
    let drilled = 0;
    for (const symbol of exported) {
      const name = symbol.getName();
      symbols.push(toRecord(ts, checker, symbol, name));
      if (drilled >= MAX_DRILLED_CONTAINERS) {
        continue;
      }
      const isContainer = Boolean(symbol.flags & (ts.SymbolFlags.Class | ts.SymbolFlags.Interface));
      if (!isContainer) {
        continue;
      }
      drilled += 1;
      symbols.push(...drillMembers(ts, checker, symbol, name));
    }

    return {
      indexed: true,
      sources: [relative(input.projectRoot, entry)],
      symbols,
    };
  },
};

/**
 * One level of members for an exported class or interface, plus a wildcard when the
 * container accepts runtime-provided members. One level is deliberate: it captures the
 * deprecations that matter (React's `Component.componentWillMount` and friends) without
 * the unbounded walk that would break the time budget.
 */
function drillMembers(
  ts: TypeScriptModule,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the compiler's checker is opaque here
  checker: any,
  container: TsSymbolLike,
  containerName: string,
): FrameworkApiSymbol[] {
  const records: FrameworkApiSymbol[] = [];
  let type: unknown;
  try {
    type = checker.getDeclaredTypeOfSymbol(container);
  } catch {
    // A container whose type cannot be resolved must not make its members look absent.
    return [dynamicRecord(containerName)];
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- structural compiler type
  const properties = ((type as any)?.getProperties?.() ?? []) as TsSymbolLike[];
  for (const property of properties) {
    records.push(
      toRecord(ts, checker, property, `${containerName}.${property.getName()}`, 'member'),
    );
  }
  if (hasStringIndex(ts, checker, type)) {
    records.push(dynamicRecord(containerName));
  }
  return records;
}

/**
 * Whether a type carries a string index signature — the declaration-level tell that
 * members arrive at runtime. This is the node analogue of a Laravel facade's
 * `__callStatic` or a Python `__getattr__`, and it is what keeps a dynamic member out of
 * the "absent" bucket (AC-5).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- opaque compiler objects
function hasStringIndex(ts: TypeScriptModule, checker: any, type: unknown): boolean {
  try {
    return Boolean(checker.getIndexInfoOfType(type, ts.IndexKind.String));
  } catch {
    return false;
  }
}
