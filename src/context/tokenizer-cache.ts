import { loadOptionalPackage } from '@/core/optional-package.js';

export const HEURISTIC_TOKENIZER_VERSION = 'heuristic';

export interface LoadedTokenizer {
  readonly tokenizer_version: string;
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
    const { AutoTokenizer } = await loadOptionalPackage<AutoTokenizerModule>(
      '@huggingface/transformers',
    );
    const native = await AutoTokenizer.from_pretrained(version);
    return {
      tokenizer_version: version,
      countTokens: (text: string) => native.encode(text).length,
    };
  } catch {
    return heuristicTokenizer();
  }
}

export function getOrLoad(version: string): Promise<LoadedTokenizer> {
  const cached = cache.get(version);
  if (cached) {
    return cached;
  }
  const loading = loadTokenizer(version);
  cache.set(version, loading);
  return loading;
}

export function clearTokenizerCache(): void {
  cache.clear();
}
