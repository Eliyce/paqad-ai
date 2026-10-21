import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

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
  looseness: number;
  considered: number;
}

interface CompilerOptions {
  strict?: boolean;
  [flag: string]: unknown;
}

export function parseTsconfig(raw: string): { compilerOptions?: CompilerOptions } | null {
  try {
    return JSON.parse(raw) as { compilerOptions?: CompilerOptions };
  } catch {
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

export function measureStrictness(projectRoot: string): StrictnessMeasure | null {
  const path = join(projectRoot, 'tsconfig.json');
  if (!existsSync(path)) return null;
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    /* v8 ignore start -- existsSync passed but read failed (race / permissions) */
    return null;
  }
  /* v8 ignore stop */
  const parsed = parseTsconfig(raw);
  if (parsed === null) return null;
  return measureStrictnessFromOptions(parsed.compilerOptions ?? {});
}
