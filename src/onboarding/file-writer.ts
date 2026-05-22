import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { GeneratedFile } from '@/adapters/adapter.interface.js';

export interface FileWriteResult {
  written: string[];
  skipped: string[];
}

export function writeGeneratedFiles(projectRoot: string, files: GeneratedFile[]): FileWriteResult {
  const written: string[] = [];
  const skipped: string[] = [];

  for (const file of files) {
    const target = join(projectRoot, file.path);

    if (!file.autoUpdate && existsSync(target)) {
      skipped.push(file.path);
      continue;
    }

    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.content);
    if (file.executable === true) {
      chmodSync(target, 0o755);
    }
    written.push(file.path);
  }

  return { written, skipped };
}
