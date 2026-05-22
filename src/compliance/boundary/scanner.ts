/**
 * FR-BT1 + FR-BT2 orchestration: scan source files for @boundary annotations,
 * load referenced spec texts, and compute unhandled variants.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import fg from 'fast-glob';

import { detectBoundariesInSource } from './detector.js';
import { extractUnhandledVariants } from './extractor.js';
import type { ExtractionResult } from './extractor.js';

export interface ScanBoundariesOptions {
  project_root: string;
  /** Globs for TypeScript source files to scan (default: src/**\/*.ts). */
  source_globs?: string[];
  /**
   * Map from spec-slug to absolute path of the spec Markdown file.
   * When provided, spec texts are loaded from disk for handling-set extraction.
   */
  spec_paths?: Map<string, string>;
}

export async function scanBoundaries(options: ScanBoundariesOptions): Promise<ExtractionResult[]> {
  const globs = options.source_globs ?? ['src/**/*.ts'];
  const files = await fg(globs, {
    cwd: options.project_root,
    absolute: true,
    onlyFiles: true,
  });

  const allBoundaries = (
    await Promise.all(
      files.map(async (file) => {
        const source = await readFile(file, 'utf8');
        const relativePath = path.relative(options.project_root, file);
        return detectBoundariesInSource(relativePath, source);
      }),
    )
  ).flat();

  // Load spec texts for handling-set extraction
  const specTexts = await loadSpecTexts(options.spec_paths ?? new Map(), options.project_root);

  return allBoundaries.map((boundary) => extractUnhandledVariants(boundary, specTexts));
}

async function loadSpecTexts(
  specPaths: Map<string, string>,
  projectRoot: string,
): Promise<Map<string, string>> {
  const texts = new Map<string, string>();
  for (const [slug, specPath] of specPaths) {
    try {
      const fullPath = path.isAbsolute(specPath) ? specPath : path.resolve(projectRoot, specPath);
      texts.set(slug, await readFile(fullPath, 'utf8'));
    } catch {
      texts.set(slug, '');
    }
  }
  return texts;
}
