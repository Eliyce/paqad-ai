import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { renameWithRetrySync } from '@/core/fs/atomic-rename.js';
import { readTextIfExistsSync } from '@/core/fs/read-if-exists.js';

export function atomicWriteText(absPath: string, text: string): void {
  mkdirSync(dirname(absPath), { recursive: true });
  const tmp = `${absPath}.${process.pid}.tmp`;
  writeFileSync(tmp, text, 'utf8');
  renameWithRetrySync(tmp, absPath);
}

export function atomicWriteJson(absPath: string, value: unknown): void {
  atomicWriteText(absPath, `${JSON.stringify(value, null, 2)}\n`);
}

export type JsonRead<T> =
  { state: 'missing' } | { state: 'unreadable'; error: string } | { state: 'ok'; value: T };

export function readJsonFile<T>(absPath: string): JsonRead<T> {
  const text = readTextIfExistsSync(absPath);
  if (text === null) {
    return { state: 'missing' };
  }
  try {
    return { state: 'ok', value: JSON.parse(text) as T };
  } catch (error) {
    return { state: 'unreadable', error: error instanceof Error ? error.message : String(error) };
  }
}
