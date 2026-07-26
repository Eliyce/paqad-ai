// Primitives every framework-API adapter shares (issue #398).
//
// Phase B (#397) shipped these inside the node adapter because it was the only one. Now
// that PHP, Python and the JVM read their own declaration layers, the wildcard contract has
// to mean exactly ONE thing across all four — a second copy of it is how a "not listed"
// quietly turns into a false "absent" in one ecosystem but not another (RULE-13).

import { relative } from 'node:path';

import { toPosixPath } from '@/core/path-utils.js';

import type { FrameworkApiSymbol } from '../types.js';

/** The wildcard suffix that marks a container as accepting runtime-provided members. */
export const DYNAMIC_MEMBER_SUFFIX = '.*';

/**
 * A project-relative path in the repo's posix-everywhere form. The index and the blocked
 * details are output boundaries — persisted JSON a consumer reads — so a Windows
 * `graph-ui\node_modules\…` must never reach them (see `toPosixPath`).
 */
export function projectRelative(projectRoot: string, target: string): string {
  return toPosixPath(relative(projectRoot, target));
}

/**
 * A wildcard record saying "this container's members are not individually enumerated here,
 * so absence cannot be asserted for them" (INV-1).
 *
 * Emitted for every drilled container in every ecosystem, which is what makes storing only
 * the DEPRECATED members honest: an unlisted member reads `unknown-dynamic` (a warning)
 * rather than `absent` (a block). Laravel facades and `Macroable`s, Python module
 * `__getattr__`, and a JVM class the adapter could not read all land here.
 */
export function dynamicRecord(container: string): FrameworkApiSymbol {
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

/**
 * The separators that qualify a symbol name across the ecosystems this index covers:
 * `.` (JS/TS members, Python attributes), `::` (PHP static calls) and `\` (PHP namespaces).
 * Ordered longest-first so `::` is never split as a bare `:`.
 *
 * Segment-aware matching is what lets ONE stored record answer every reasonable spelling of
 * the same claim — `Cache::get`, `Cache.get` and `Illuminate\Support\Facades\Cache::get`
 * all mean one thing, and a plan that writes the fully-qualified form must never be told
 * its symbol is absent because the index happened to store the short one.
 */
const NAME_SEPARATORS = ['::', '.', '\\'];

/** Where a qualified name's last separator starts, and how wide it is. */
function lastSeparator(name: string): { at: number; width: number } {
  let at = -1;
  let width = 0;
  for (const separator of NAME_SEPARATORS) {
    const index = name.lastIndexOf(separator);
    if (index > at) {
      at = index;
      width = separator.length;
    }
  }
  return { at, width };
}

/** The last qualified segment of a name (`Illuminate\Support\Str::random` -> `random`). */
export function lastNameSegment(name: string): string {
  const { at, width } = lastSeparator(name);
  return at === -1 ? name : name.slice(at + width);
}

/** The container part of a qualified name, or null when the name is not qualified. */
export function containerOf(name: string): string | null {
  const { at } = lastSeparator(name);
  return at === -1 ? null : name.slice(0, at);
}
