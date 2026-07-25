// Lazy TypeScript compiler resolution (issue #397, decision D-01KYCFNW46E4AZC9JAAH5ZCR9P).
//
// paqad-ai is installed into onboarded projects of ANY stack — Laravel, Flutter, Python —
// so `typescript` (24MB) is NOT a runtime dependency: it is an optional peer dependency
// that npm never auto-installs, resolved here at build time from the onboarded project
// first, then from paqad-ai's own install (INV-5).
//
// The degradation is self-correlating rather than arbitrary: a JS/TS project without
// `typescript` installed also has no `@types/*` on disk, so "no parser" and "nothing to
// index" coincide almost perfectly. When neither resolves, the package is recorded
// `parser-unavailable` and `plan compile` falls through to its documented AC-6 warning.

import { createRequire } from 'node:module';
import { join } from 'node:path';

/**
 * The slice of the TypeScript compiler API this adapter uses. Declared structurally so
 * the loader stays honest about its surface without `typescript` being a build-time
 * dependency of paqad-ai — a static `import type` from 'typescript' would break
 * `tsc --noEmit` in any consumer that has not installed it.
 */
export interface TypeScriptModule {
  createProgram(rootNames: string[], options: Record<string, unknown>): TsProgram;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the compiler's own enums are opaque here
  readonly SyntaxKind: Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ditto for SymbolFlags
  readonly SymbolFlags: Record<string, any>;
  ScriptTarget: Record<string, number>;
  ModuleResolutionKind: Record<string, number>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- structural passthrough
  [key: string]: any;
}

/** The compiler-program surface the node adapter drives. */
export interface TsProgram {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- opaque compiler objects
  getTypeChecker(): any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- opaque compiler objects
  getSourceFile(fileName: string): any;
}

/** Cache keyed by project root, so a multi-package build resolves the compiler once. */
const cache = new Map<string, TypeScriptModule | null>();

/**
 * Resolve the TypeScript compiler for `projectRoot`, or null when it is unavailable.
 *
 * Resolution order is deliberate: the ONBOARDED PROJECT's copy wins, so the declarations
 * are read by the same compiler version the project itself type-checks with. paqad-ai's
 * own copy is the fallback for the case where paqad is installed but the project keeps
 * typescript out of its own tree.
 */
export function loadTypeScript(projectRoot: string): TypeScriptModule | null {
  const cached = cache.get(projectRoot);
  if (cached !== undefined) {
    return cached;
  }
  const resolved = resolveFromProject(projectRoot) ?? resolveFromPaqad();
  cache.set(projectRoot, resolved);
  return resolved;
}

/** Drop the memoized compiler. Tests use this to exercise both resolution outcomes. */
export function clearTypeScriptCache(): void {
  cache.clear();
}

function resolveFromProject(projectRoot: string): TypeScriptModule | null {
  try {
    // `createRequire` needs a file-ish base; package.json need not exist for resolution
    // to walk up from that directory.
    const projectRequire = createRequire(join(projectRoot, 'package.json'));
    return projectRequire('typescript') as TypeScriptModule;
  } catch {
    return null;
  }
}

function resolveFromPaqad(): TypeScriptModule | null {
  try {
    const selfRequire = createRequire(import.meta.url);
    return selfRequire('typescript') as TypeScriptModule;
  } catch {
    return null;
  }
}
