// Issue #110 — the strictness measure for TypeScript projects.
//
// Strictness is the one measure that is cheap and exact to read directly from
// the project's own config, so we do — no external tool needed. We do NOT
// invent a strictness metric; we read the canonical TypeScript strict flags
// from `tsconfig.json` and count how many are *off*. That looseness count is
// the deficiency (lower is better, like every other measure), so a change that
// turns a strict flag off raises the count and trips the ratchet.
//
// Languages without this surface get a `null` (blocked) strictness sample from
// the collector instead — never a fabricated number.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Flags implied by `"strict": true` — off only if explicitly set false.
const STRICT_FAMILY = [
  'noImplicitAny',
  'strictNullChecks',
  'strictFunctionTypes',
  'strictBindCallApply',
  'strictPropertyInitialization',
  'noImplicitThis',
  'alwaysStrict',
  'useUnknownInCatchVariables',
] as const;

// Additional strictness flags NOT implied by `strict` — each off unless set true.
const EXTRA_STRICT_FLAGS = [
  'noUnusedLocals',
  'noUnusedParameters',
  'noImplicitReturns',
  'noFallthroughCasesInSwitch',
  'noUncheckedIndexedAccess',
  'exactOptionalPropertyTypes',
  'noImplicitOverride',
] as const;

export interface StrictnessMeasure {
  /** Number of tracked strict flags that are effectively off. Lower is better. */
  looseness: number;
  /** The strict-family + extra flags considered, for transparency. */
  considered: number;
}

interface CompilerOptions {
  strict?: boolean;
  [flag: string]: unknown;
}

/**
 * Tolerantly parse a tsconfig that may contain // and /* *\/ comments (allowed
 * by tsc, rejected by JSON.parse). Returns null when the file is unparseable
 * even after stripping comments — the collector then records strictness as
 * blocked rather than guessing.
 */
export function parseTsconfig(raw: string): { compilerOptions?: CompilerOptions } | null {
  try {
    return JSON.parse(raw) as { compilerOptions?: CompilerOptions };
  } catch {
    // Strip block + line comments and trailing commas, then retry.
    const stripped = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:"'])\/\/.*$/gm, '$1')
      .replace(/,(\s*[}\]])/g, '$1');
    try {
      return JSON.parse(stripped) as { compilerOptions?: CompilerOptions };
    } catch {
      return null;
    }
  }
}

/**
 * Count the strict flags that are off in the given compiler options.
 *  - strict-family flags are ON when `strict` is true, unless explicitly false;
 *  - extra flags are OFF unless explicitly true.
 */
export function measureStrictnessFromOptions(options: CompilerOptions): StrictnessMeasure {
  const strictUmbrella = options.strict === true;
  let looseness = 0;

  for (const flag of STRICT_FAMILY) {
    const explicit = options[flag];
    const enabled = explicit === undefined ? strictUmbrella : explicit === true;
    if (!enabled) looseness += 1;
  }

  for (const flag of EXTRA_STRICT_FLAGS) {
    if (options[flag] !== true) looseness += 1;
  }

  return { looseness, considered: STRICT_FAMILY.length + EXTRA_STRICT_FLAGS.length };
}

/**
 * Read `tsconfig.json` from the project root and measure looseness. Returns
 * null when there is no tsconfig (not a TS project) or it cannot be parsed.
 */
export function measureStrictness(projectRoot: string): StrictnessMeasure | null {
  const path = join(projectRoot, 'tsconfig.json');
  if (!existsSync(path)) return null;
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    /* v8 ignore next 2 -- existsSync passed but read failed (race / permissions) */
    return null;
  }
  const parsed = parseTsconfig(raw);
  if (parsed === null) return null;
  return measureStrictnessFromOptions(parsed.compilerOptions ?? {});
}
