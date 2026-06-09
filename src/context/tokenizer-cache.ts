// PQD-167: session-scoped tokenizer cache.
//
// `computeBudget` needs a real tokenizer to size each context slice. Loading a
// tokenizer is expensive, so we keep one per `tokenizer_version` for the process
// lifetime (no disk I/O). `@xenova/transformers` is an optional runtime peer dep
// (declared external in tsup.config.ts); when it is unavailable we fall back to
// the character/4 heuristic and report a `tokenizer_version` of `"heuristic"`.

/** Sentinel version reported when the native tokenizer could not be loaded. */
export const HEURISTIC_TOKENIZER_VERSION = 'heuristic';

/** A loaded tokenizer plus the version label that should be reported for it. */
export interface LoadedTokenizer {
  /** The version actually used; `"heuristic"` when the native load failed. */
  readonly tokenizer_version: string;
  /** Count the tokens in a piece of text. */
  countTokens(text: string): number;
}

interface NativeTokenizer {
  encode(text: string): number[];
}

interface AutoTokenizerModule {
  AutoTokenizer: {
    from_pretrained(version: string): Promise<NativeTokenizer>;
  };
}

const cache = new Map<string, Promise<LoadedTokenizer>>();

function heuristicCount(text: string): number {
  return Math.ceil(text.length / 4);
}

function heuristicTokenizer(): LoadedTokenizer {
  return {
    tokenizer_version: HEURISTIC_TOKENIZER_VERSION,
    countTokens: heuristicCount,
  };
}

async function loadTokenizer(version: string): Promise<LoadedTokenizer> {
  try {
    const { AutoTokenizer } =
      (await import('@xenova/transformers')) as unknown as AutoTokenizerModule;
    const native = await AutoTokenizer.from_pretrained(version);
    return {
      tokenizer_version: version,
      countTokens: (text: string) => native.encode(text).length,
    };
  } catch {
    // The package is an optional peer dep; degrade to the heuristic rather than
    // failing every computeBudget call in environments without it.
    return heuristicTokenizer();
  }
}

/**
 * Return the tokenizer for `version`, loading it once and reusing the cached
 * instance on every subsequent call within the process.
 */
export function getOrLoad(version: string): Promise<LoadedTokenizer> {
  const cached = cache.get(version);
  if (cached) {
    return cached;
  }
  const loading = loadTokenizer(version);
  cache.set(version, loading);
  return loading;
}

/** Clear the cache. Intended for test isolation; not used in production paths. */
export function clearTokenizerCache(): void {
  cache.clear();
}
