import type { Chunk } from './types.js';

export type MetadataFilterType =
  'file_extension' | 'module_path_prefix' | 'framework' | 'recency_cutoff_ms';

export interface MetadataFilter {
  type: MetadataFilterType;
  value: string | number;
}

export type FilterFallbackReason = 'below-min-threshold' | 'empty-corpus';

export interface MetadataFilterResult {
  chunks: Chunk[];
  fallback: boolean;
  fallback_reason?: FilterFallbackReason;
  filter_types_applied: string[];
}

const DEFAULT_MIN_FILTERED_SIZE = 3;

/**
 * Apply metadata filters to a chunk set conservatively.
 * If the filtered set is smaller than `minFilteredSize`, the full set is returned
 * with `fallback = true` so callers can log/record the fallback.
 */
export function applyMetadataFilters(
  chunks: Chunk[],
  filters: MetadataFilter[],
  options: { minFilteredSize?: number } = {},
): MetadataFilterResult {
  const minFilteredSize = options.minFilteredSize ?? DEFAULT_MIN_FILTERED_SIZE;
  const filterTypesApplied: string[] = [];

  if (chunks.length === 0) {
    return {
      chunks,
      fallback: true,
      fallback_reason: 'empty-corpus',
      filter_types_applied: [],
    };
  }

  if (filters.length === 0) {
    return { chunks, fallback: false, filter_types_applied: [] };
  }

  let filtered = chunks;

  for (const filter of filters) {
    filtered = applyFilter(filtered, filter);
    filterTypesApplied.push(filter.type);
  }

  if (filtered.length < minFilteredSize) {
    return {
      chunks,
      fallback: true,
      fallback_reason: 'below-min-threshold',
      filter_types_applied: [],
    };
  }

  return { chunks: filtered, fallback: false, filter_types_applied: filterTypesApplied };
}

/**
 * Known file-extension patterns per framework name (lower-cased).
 * Used as a secondary signal when the framework name does not appear in the file path.
 */
const FRAMEWORK_EXT_PATTERNS: Readonly<Record<string, readonly string[]>> = {
  react: ['.tsx', '.jsx'],
  'react-native': ['.tsx', '.jsx'],
  next: ['.tsx', '.jsx'],
  'next.js': ['.tsx', '.jsx'],
  vue: ['.vue'],
  angular: ['.component.ts', '.module.ts', '.directive.ts'],
  laravel: ['.php'],
  flutter: ['.dart'],
  django: ['.py'],
  fastapi: ['.py'],
};

function applyFilter(chunks: Chunk[], filter: MetadataFilter): Chunk[] {
  switch (filter.type) {
    case 'file_extension': {
      const ext = String(filter.value);
      return chunks.filter((c) => c.source_file.endsWith(ext));
    }
    case 'module_path_prefix': {
      // Normalize separators so repo-relative prefixes (e.g. 'src/billing') match
      // both relative chunk paths and absolute paths ('/abs/root/src/billing/…').
      const prefix = String(filter.value)
        .replace(/\\/g, '/')
        .replace(/^\.?\//, '')
        .replace(/\/+$/, '');
      return chunks.filter((c) => {
        const filePath = c.source_file.replace(/\\/g, '/');
        return (
          filePath === prefix ||
          filePath.startsWith(`${prefix}/`) ||
          filePath.endsWith(`/${prefix}`) ||
          filePath.includes(`/${prefix}/`)
        );
      });
    }
    case 'framework': {
      // Primary: framework name appears anywhere in the source path.
      // Secondary: file extension matches a known pattern for the framework
      // (handles frameworks like 'react' or 'laravel' whose names rarely appear in paths).
      const fw = String(filter.value).toLowerCase();
      const extensions = FRAMEWORK_EXT_PATTERNS[fw] ?? [];
      return chunks.filter((c) => {
        const fileLower = c.source_file.toLowerCase();
        return fileLower.includes(fw) || extensions.some((ext) => fileLower.endsWith(ext));
      });
    }
    case 'recency_cutoff_ms': {
      // Recency filter: retain chunks whose source files were modified within
      // the cutoff window. Falls back to accepting all if stat is unavailable.
      const cutoff = Date.now() - Number(filter.value);
      return chunks.filter((c) => {
        // If no recency info is available for a chunk, accept it conservatively.
        const ts = c.modified_at_ms;
        if (ts === undefined) return true;
        return ts >= cutoff;
      });
    }
    default:
      return chunks;
  }
}
