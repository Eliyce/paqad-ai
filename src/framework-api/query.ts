import { levenshtein } from '@/module-decisions/schema.js';

import { DYNAMIC_MEMBER_SUFFIX, containerOf, lastNameSegment } from './adapters/shared.js';
import type { FrameworkApiIndex, FrameworkApiPackage, FrameworkApiSymbol } from './types.js';

export type FrameworkApiVerdict =
  'live' | 'deprecated' | 'absent' | 'unknown-dynamic' | 'package-not-indexed';

export interface FrameworkApiQueryResult {
  package: string;
  symbol: string;
  verdict: FrameworkApiVerdict;
  version: string | null;
  record: FrameworkApiSymbol | null;
  nearest: string | null;
}

function findRecord(entry: FrameworkApiPackage, symbol: string): FrameworkApiSymbol | null {
  const exact = entry.symbols.find((record) => record.name === symbol);
  if (exact) {
    return exact;
  }
  const wanted = lastNameSegment(symbol);
  return (
    entry.symbols.find(
      (record) =>
        !record.name.endsWith(DYNAMIC_MEMBER_SUFFIX) && lastNameSegment(record.name) === wanted,
    ) ?? null
  );
}

function coveredByDynamicContainer(entry: FrameworkApiPackage, symbol: string): boolean {
  const container = containerOf(symbol);
  if (container === null) {
    return false;
  }
  const wanted = lastNameSegment(container);
  return entry.symbols.some((record) => {
    if (!record.name.endsWith(DYNAMIC_MEMBER_SUFFIX)) {
      return false;
    }
    const recorded = record.name.slice(0, -DYNAMIC_MEMBER_SUFFIX.length);
    return recorded === container || lastNameSegment(recorded) === wanted;
  });
}

export function nearestFrameworkSymbol(symbol: string, known: string[]): string | null {
  const wanted = lastNameSegment(symbol);
  const bound = Math.max(2, Math.floor(wanted.length / 4));
  let best: string | null = null;
  let bestDistance = bound + 1;
  for (const candidate of known) {
    const distance = levenshtein(wanted, lastNameSegment(candidate), bound);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

export function queryFrameworkApi(
  index: FrameworkApiIndex,
  packageName: string,
  symbol: string,
  version?: string,
): FrameworkApiQueryResult {
  const forPackage = index.packages.filter((candidate) => candidate.package === packageName);
  const entry =
    (version === undefined
      ? forPackage[0]
      : (forPackage.find((candidate) => candidate.version === version) ?? forPackage[0])) ?? null;
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
