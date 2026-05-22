import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import type { DocProgressEntry, DocProgressFile } from '@/core/types/document-generation.js';
import { VERSION } from '@/index.js';
import { SchemaValidator } from '@/validators/validator.js';

export class DocumentProgressTracker {
  constructor(private readonly validator = new SchemaValidator()) {}

  async load(projectRoot: string): Promise<DocProgressFile> {
    const target = join(projectRoot, PATHS.DOC_PROGRESS);
    let raw: string;

    try {
      raw = await readFile(target, 'utf8');
    } catch (error) {
      if (hasErrorCode(error, 'ENOENT')) {
        return this.createEmpty();
      }

      throw new Error(`Failed to read document progress at ${PATHS.DOC_PROGRESS}`, {
        cause: error,
      });
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(`Invalid JSON in ${PATHS.DOC_PROGRESS}`, { cause: error });
    }

    const validation = this.validator.validate('doc-progress', parsed);
    if (!validation.valid) {
      throw new Error(
        `Invalid document progress schema in ${PATHS.DOC_PROGRESS}: ${validation.errors
          .map((issue) => issue.message)
          .join('; ')}`,
      );
    }

    return parsed as DocProgressFile;
  }

  async save(projectRoot: string, progress: DocProgressFile): Promise<void> {
    const target = join(projectRoot, PATHS.DOC_PROGRESS);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(progress, null, 2)}\n`);
  }

  async resetGeneratingEntries(projectRoot: string, progress: DocProgressFile): Promise<void> {
    await Promise.all(
      resetGeneratingEntries(progress).map((entry) =>
        rm(join(projectRoot, entry.output_path), { force: true }),
      ),
    );
  }

  createEntry(output_path: string, source_files: string[]): DocProgressEntry {
    return {
      output_path,
      state: 'not_started',
      started_at: null,
      completed_at: null,
      source_files,
      source_hash: null,
      tokens_used: null,
      error: null,
    };
  }

  private createEmpty(): DocProgressFile {
    return {
      schema_version: '1',
      generated_by: 'paqad-ai',
      framework_version: VERSION,
      modules: {},
      global: {},
    };
  }
}

export function resetGeneratingEntries(progress: DocProgressFile): DocProgressEntry[] {
  const reset: DocProgressEntry[] = [];

  for (const entry of collectEntries(progress)) {
    if (entry.state !== 'generating') {
      continue;
    }

    entry.state = 'not_started';
    entry.started_at = null;
    entry.completed_at = null;
    entry.error = null;
    reset.push(entry);
  }

  return reset;
}

function collectEntries(progress: DocProgressFile): DocProgressEntry[] {
  return [
    ...Object.values(progress.modules).flatMap((group) => Object.values(group)),
    ...Object.values(progress.global).flatMap((group) => Object.values(group)),
  ];
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}
