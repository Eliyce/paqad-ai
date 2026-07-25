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
// What gets stored is shaped by INV-2 — never claim absence you cannot prove. Top-level
// exports are enumerated in full, so a missing one is a real `absent`. Members are stored
// only when DEPRECATED, and every container carries a `<Container>.*` wildcard marked
// `unknown-dynamic`, so a member the index does not list warns instead of blocking. That
// keeps the file small (measured on this repo: 676 records instead of 18,574, with the
// same 299 deprecations found) without ever converting "not listed" into "does not exist".
// #398's Laravel facades and Python `__getattr__` reuse the same wildcard shape.

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

/**
 * A wildcard record saying "this container's members are not individually enumerated
 * here, so absence cannot be asserted for them" (INV-2).
 *
 * Emitted for every drilled container, which is what makes storing only the DEPRECATED
 * members honest: an unlisted member reads `unknown-dynamic` (a warning) rather than
 * `absent` (a block). Storing every member instead was measured on this repo at 18,317
 * records for react alone against 285 deprecated ones — 98.6% of the file to answer a
 * question the wildcard answers conservatively.
 */
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

  resolveInstalled(searchRoot, packageName) {
    return resolveInstalledVersion(searchRoot, packageName);
  },

  /**
   * Content-address the declaration inputs. Package + resolved version + the bytes of the
   * declaration entry: within one published version those bytes are immutable, so an equal
   * hash means an equal surface and the stored entry can be reused (FR-13).
   */
  contentHash(input: FrameworkApiAdapterInput): string {
    const entry = resolveTypesEntry(input.searchRoot, input.package, input.packageDir);
    const hash = createHash('sha256').update(`${input.package}@${input.version}`);
    if (entry !== null) {
      hash.update(entry);
      try {
        hash.update(readFileSync(entry));
        /* v8 ignore next 4 -- resolveTypesEntry only returns a path it just read, so this catch needs the file to vanish mid-build; the entry still hashes by path+version and the build records `no-types`, so a stale surface is never passed off as current. */
      } catch {
        // Deliberately empty: the path+version already in the hash is enough.
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
      const isContainer = Boolean(symbol.flags & (ts.SymbolFlags.Class | ts.SymbolFlags.Interface));
      if (!isContainer) {
        continue;
      }
      if (drilled >= MAX_DRILLED_CONTAINERS) {
        // Past the budget, the container still gets its wildcard: skipping it silently
        // would let an un-drilled member fall through to a false "absent" (INV-2).
        symbols.push(dynamicRecord(name));
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
 * The DEPRECATED members of an exported class or interface, plus the container's wildcard.
 *
 * One level deep is deliberate: it captures the deprecations that matter (React's
 * `Component.componentWillMount` and friends) without the unbounded walk that would break
 * the time budget. Only deprecated members are stored, because a member's useful question
 * is "is this one deprecated?" — and the wildcard keeps that honest by making every member
 * the index does not list read `unknown-dynamic` rather than `absent` (INV-2).
 */
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
