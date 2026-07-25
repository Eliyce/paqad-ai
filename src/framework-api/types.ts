// Shapes for the installed framework-API index (issue #397).
//
// #357 lets a plan DECLARE it reuses a framework API ("I'll use React's `useId()`").
// Nothing checked that claim: `provenance` was model-declared, and the only cross-check
// was that the package's VERSION appeared in the stack snapshot. This index answers the
// two questions that actually matter, for the version actually installed — does the
// symbol exist, and is it deprecated? — by reading the declaration files that physically
// ship inside the installed package. Zero model tokens, zero network (INV-1).
//
// The index is deliberately ecosystem-agnostic at this layer. paqad-ai is installed into
// onboarded projects of ANY stack, so the per-ecosystem work lives behind
// {@link FrameworkApiAdapter} (the JS/TS adapter ships here; PHP/Python/JVM are #398) and
// an ecosystem with no adapter is recorded blocked rather than run through the wrong one.

import type { StackEcosystem } from '@/core/types/introspection.js';

/** Current index schema version. Bump when a stored field's meaning changes. */
export const FRAMEWORK_API_SCHEMA_VERSION = 1;

/**
 * How confident the index is about a symbol's record.
 *
 * - `asserted` — the module resolved and the symbol was found (or demonstrably was not)
 *   in its exports. The verdict is trustworthy enough to block a plan compile.
 * - `unknown-dynamic` — the member is provided at runtime rather than declared: a Laravel
 *   facade `__callStatic`, a `Macroable`, a Python `__getattr__`, or a re-export this
 *   adapter could not follow. Never claim absence here (INV-2).
 * - `doc-derived` — the record came from a version-pinned documentation source rather
 *   than a declaration file. Reserved for ecosystems whose deprecation record is prose
 *   (Laravel's Upgrade Guide); no adapter emits it yet.
 */
export type FrameworkApiProvenance = 'asserted' | 'unknown-dynamic' | 'doc-derived';

/** What kind of declaration a symbol is, as far as the adapter could tell. */
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

/**
 * One normalized symbol record.
 *
 * `deprecated: false` means "no static deprecation marker was found", NOT "this API is
 * live" — a real deprecation does not always carry a tag (react-dom's `render` deprecation
 * is a runtime `console.warn`; Laravel 10.x `Str.php` has zero `@deprecated` docblocks).
 * The docs state this limit plainly rather than letting the field imply more than it knows.
 */
export interface FrameworkApiSymbol {
  name: string;
  kind: FrameworkApiSymbolKind;
  /** Whether the symbol resolves at the installed version. */
  exists: boolean;
  /** Whether a static deprecation marker was found on it. */
  deprecated: boolean;
  /** The deprecation tag's text, when it carried one. */
  message: string | null;
  /** The version the tag says it was deprecated in, when stated. */
  since: string | null;
  /** Whether the tag says the symbol is slated for removal. */
  for_removal: boolean;
  provenance: FrameworkApiProvenance;
}

/** Every symbol indexed for one installed package, at one resolved version. */
export interface FrameworkApiPackage {
  package: string;
  /** The version actually installed, read from the package's own manifest (FR-2). */
  version: string;
  ecosystem: StackEcosystem;
  /**
   * Content address of the inputs this entry was built from. A rebuild whose address
   * matches reuses the stored entry instead of re-walking declarations (FR-13).
   */
  content_hash: string;
  /** Where the declarations were read from, project-relative. Empty when none resolved. */
  sources: string[];
  symbols: FrameworkApiSymbol[];
}

/** Why a detected framework produced no entry. Surfaced, never silently dropped. */
export interface FrameworkApiBlocked {
  package: string;
  ecosystem: StackEcosystem;
  /**
   * `no-adapter` — this ecosystem's adapter is #398's work.
   * `not-installed` — detected in the manifest but absent from the install tree.
   * `no-types` — installed, but ships no declarations to read.
   * `parser-unavailable` — the adapter's toolchain could not be resolved.
   */
  reason: 'no-adapter' | 'not-installed' | 'no-types' | 'parser-unavailable';
  detail: string;
}

/** Freshness contract, mirroring the code-knowledge index header. */
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

/** What an adapter is asked to index: one installed package at one resolved version. */
export interface FrameworkApiAdapterInput {
  projectRoot: string;
  package: string;
  version: string;
  /** Absolute path to the installed package directory. */
  packageDir: string;
}

/** An adapter's answer: the symbols it resolved, or why it could not. */
export type FrameworkApiAdapterResult =
  | { indexed: true; sources: string[]; symbols: FrameworkApiSymbol[] }
  | { indexed: false; reason: FrameworkApiBlocked['reason']; detail: string };

/**
 * One ecosystem's declaration reader. Modelled on the existing `EcosystemParser`
 * interface (`src/introspection/ecosystems/types.ts`) so the two registries read alike.
 */
export interface FrameworkApiAdapter {
  ecosystem: StackEcosystem;
  /**
   * Resolve the installed package directory and its version, or null when the package is
   * not present in this project's install tree.
   */
  resolveInstalled(
    projectRoot: string,
    packageName: string,
  ): { dir: string; version: string } | null;
  /** Content-address the declaration inputs, so an unchanged rebuild is a cache hit. */
  contentHash(input: FrameworkApiAdapterInput): string;
  index(input: FrameworkApiAdapterInput): FrameworkApiAdapterResult;
}
