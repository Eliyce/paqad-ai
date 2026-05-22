import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { SpecReviewReport } from './types.js';
import { specReviewPath } from './constants.js';
import { isEnoentError } from './index-store.js';

export interface LoadSpecReviewOptions {
  project_root: string;
  review_path?: string;
  spec_file?: string;
}

export async function loadSpecReviewReport(
  options: LoadSpecReviewOptions,
): Promise<SpecReviewReport | null> {
  const reviewPath = resolveReviewPath(
    options.project_root,
    options.review_path,
    options.spec_file,
  );

  try {
    const raw = await readFile(reviewPath, 'utf8');
    return JSON.parse(raw) as SpecReviewReport;
  } catch (error) {
    if (isEnoentError(error)) {
      return null;
    }
    throw error;
  }
}

export interface SaveSpecReviewOptions {
  project_root: string;
  report: SpecReviewReport;
  review_path?: string;
  spec_file?: string;
}

export async function saveSpecReviewReport(options: SaveSpecReviewOptions): Promise<string> {
  const reviewPath = resolveReviewPath(
    options.project_root,
    options.review_path,
    options.spec_file,
  );
  await mkdir(path.dirname(reviewPath), { recursive: true });
  await writeFile(reviewPath, JSON.stringify(options.report, null, 2) + '\n', 'utf8');
  return reviewPath;
}

function resolveReviewPath(projectRoot: string, reviewPath?: string, specFile?: string): string {
  const relativePath = reviewPath ?? (specFile ? specReviewPath(specFile) : undefined);
  if (!relativePath) {
    throw new Error('spec_file or review_path is required to resolve the spec review path');
  }
  return path.resolve(projectRoot, relativePath);
}
