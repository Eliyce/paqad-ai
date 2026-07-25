// Looking one framework symbol up in the installed framework-API index (issue #397).
//
// This is the single place a verdict is decided, so the CLI and `plan compile` can never
// disagree about what the index says. The verdict tiers are what keep the gate honest: it
// blocks only on `absent` and `deprecated`, and everything it could not resolve lands in
// `unknown-dynamic`, which warns (INV-2).

import { levenshtein } from '@/module-decisions/schema.js';

import { DYNAMIC_MEMBER_SUFFIX } from './adapters/node.js';
import type { FrameworkApiIndex, FrameworkApiPackage, FrameworkApiSymbol } from './types.js';

/**
 * What the index concluded about one claimed symbol.
 *
 * - `live` — resolved, and carries no static deprecation marker.
 * - `deprecated` — resolved, and carries one.
 * - `absent` — the package resolved and the symbol demonstrably was not among its
 *   exports. The only verdict besides `deprecated` that blocks a compile.
 * - `unknown-dynamic` — the container provides members at runtime, so absence cannot be
 *   asserted.
 * - `package-not-indexed` — the index exists but has no entry for this package.
 */
export type FrameworkApiVerdict =
  'live' | 'deprecated' | 'absent' | 'unknown-dynamic' | 'package-not-indexed';

export interface FrameworkApiQueryResult {
  package: string;
  symbol: string;
  verdict: FrameworkApiVerdict;
  /** The resolved version the verdict is made against, when the package was indexed. */
  version: string | null;
  /** The matched record, when one was found. */
  record: FrameworkApiSymbol | null;
  /** The closest existing symbol name, offered when the verdict is `absent`. */
  nearest: string | null;
}

/** The last dotted segment of a qualified name (`Component.render` -> `render`). */
function lastSegment(name: string): string {
  const index = name.lastIndexOf('.');
  return index === -1 ? name : name.slice(index + 1);
}

/**
 * Match a claimed symbol against a package's records.
 *
 * Exact first, then by last segment, because a plan may reasonably write either
 * `componentWillMount` or `Component.componentWillMount` for the same member and both
 * should reach the same verdict.
 */
function findRecord(entry: FrameworkApiPackage, symbol: string): FrameworkApiSymbol | null {
  const exact = entry.symbols.find((record) => record.name === symbol);
  if (exact) {
    return exact;
  }
  const wanted = lastSegment(symbol);
  return (
    entry.symbols.find(
      (record) =>
        !record.name.endsWith(DYNAMIC_MEMBER_SUFFIX) && lastSegment(record.name) === wanted,
    ) ?? null
  );
}

/**
 * Whether the claimed symbol's container accepts runtime-provided members. A claim on
 * `Facade.anything` must not be called absent when `Facade.*` is in the index.
 */
function coveredByDynamicContainer(entry: FrameworkApiPackage, symbol: string): boolean {
  const separator = symbol.lastIndexOf('.');
  if (separator === -1) {
    return false;
  }
  const container = symbol.slice(0, separator);
  return entry.symbols.some((record) => record.name === `${container}${DYNAMIC_MEMBER_SUFFIX}`);
}

/**
 * The closest existing symbol name within a small edit distance, or null. Reuses the
 * bounded `levenshtein` already exported for module-slug matching — the same helper
 * `src/feature-evidence/reuse.ts` uses for first-party suggestions — rather than adding a
 * second edit-distance implementation. A null result is deliberate: suggesting a wildly
 * unrelated symbol is worse than suggesting nothing.
 */
export function nearestFrameworkSymbol(symbol: string, known: string[]): string | null {
  const wanted = lastSegment(symbol);
  const bound = Math.max(2, Math.floor(wanted.length / 4));
  let best: string | null = null;
  let bestDistance = bound + 1;
  for (const candidate of known) {
    const distance = levenshtein(wanted, lastSegment(candidate), bound);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

/** Look one `package` + `symbol` up in the index. */
export function queryFrameworkApi(
  index: FrameworkApiIndex,
  packageName: string,
  symbol: string,
): FrameworkApiQueryResult {
  const entry = index.packages.find((candidate) => candidate.package === packageName);
  if (!entry) {
    return {
      package: packageName,
      symbol,
      verdict: 'package-not-indexed',
      version: null,
      record: null,
      nearest: null,
    };
  }
  const record = findRecord(entry, symbol);
  if (record) {
    return {
      package: packageName,
      symbol,
      verdict:
        record.provenance === 'asserted'
          ? record.deprecated
            ? 'deprecated'
            : 'live'
          : 'unknown-dynamic',
      version: entry.version,
      record,
      nearest: null,
    };
  }
  if (coveredByDynamicContainer(entry, symbol)) {
    return {
      package: packageName,
      symbol,
      verdict: 'unknown-dynamic',
      version: entry.version,
      record: null,
      nearest: null,
    };
  }
  const known = entry.symbols
    .filter((candidate) => !candidate.name.endsWith(DYNAMIC_MEMBER_SUFFIX))
    .map((candidate) => candidate.name);
  return {
    package: packageName,
    symbol,
    verdict: 'absent',
    version: entry.version,
    record: null,
    nearest: nearestFrameworkSymbol(symbol, known),
  };
}
