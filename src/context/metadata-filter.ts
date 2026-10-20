import type { Chunk } from './types.js';
import { trimTrailingChar } from '@/core/text/trim-char.js';

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
      const prefix = trimTrailingChar(
        String(filter.value)
          .replace(/\\/g, '/')
          .replace(/^\.?\//, ''),
        '/',
      );
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
      const fw = String(filter.value).toLowerCase();
      const extensions = FRAMEWORK_EXT_PATTERNS[fw] ?? [];
      return chunks.filter((c) => {
        const fileLower = c.source_file.toLowerCase();
        return fileLower.includes(fw) || extensions.some((ext) => fileLower.endsWith(ext));
      });
    }
    case 'recency_cutoff_ms': {
      const cutoff = Date.now() - Number(filter.value);
      return chunks.filter((c) => {
        const ts = c.modified_at_ms;
        if (ts === undefined) return true;
        return ts >= cutoff;
      });
    }
    default:
      return chunks;
  }
}
