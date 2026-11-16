import { readFileSync } from 'node:fs';

export function readTextOrNull(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export function readJsonLines<T>(path: string, accept: (value: T) => boolean): T[] {
  const text = readTextOrNull(path);
  if (text === null) return [];
  const rows: T[] = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    try {
      const value = JSON.parse(line) as T;
      if (accept(value)) rows.push(value);
    } catch {
      continue;
    }
  }
  return rows;
}
