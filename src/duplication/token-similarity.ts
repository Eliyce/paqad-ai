const DEFAULT_SHINGLE_SIZE = 4;

const SHINGLE_SEP = '\n';

export function tokenizeCode(source: string): string[] {
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/#[^\n]*/g, ' ');
  const withoutStrings = withoutComments
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/`(?:\\.|[^`\\])*`/g, '``');
  const tokens = withoutStrings.match(/[A-Za-z_$][A-Za-z0-9_$]*|[0-9]+|[^\sA-Za-z0-9_$]/g);
  return tokens ? tokens.map((token) => token.toLowerCase()) : [];
}

export function shingles(tokens: string[], size: number = DEFAULT_SHINGLE_SIZE): Set<string> {
  const result = new Set<string>();
  if (tokens.length === 0) {
    return result;
  }
  if (tokens.length < size) {
    result.add(tokens.join(SHINGLE_SEP));
    return result;
  }
  for (let index = 0; index + size <= tokens.length; index += 1) {
    result.add(tokens.slice(index, index + size).join(SHINGLE_SEP));
  }
  return result;
}

export function jaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const shingle of left) {
    if (right.has(shingle)) {
      intersection += 1;
    }
  }
  const union = left.size + right.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function tokenShingleSimilarity(
  left: string,
  right: string,
  size: number = DEFAULT_SHINGLE_SIZE,
): number {
  return jaccard(shingles(tokenizeCode(left), size), shingles(tokenizeCode(right), size));
}
