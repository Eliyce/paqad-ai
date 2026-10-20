import { createRequire } from 'node:module';
import { join } from 'node:path';

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

export interface TsProgram {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- opaque compiler objects
  getTypeChecker(): any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- opaque compiler objects
  getSourceFile(fileName: string): any;
}

const cache = new Map<string, TypeScriptModule | null>();

export function loadTypeScript(projectRoot: string): TypeScriptModule | null {
  const cached = cache.get(projectRoot);
  if (cached !== undefined) {
    return cached;
  }
  const resolved = resolveFromProject(projectRoot) ?? resolveFromPaqad();
  cache.set(projectRoot, resolved);
  return resolved;
}

export function clearTypeScriptCache(): void {
  cache.clear();
}

function resolveFromProject(projectRoot: string): TypeScriptModule | null {
  try {
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
    /* v8 ignore next 3 -- typescript is a devDependency of this repo, so its own suite can never reach the both-hops-failed path; the degradation it produces is covered through the adapter's `parser-unavailable` branch instead. */
  } catch {
    return null;
  }
}
