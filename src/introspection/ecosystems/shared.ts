import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function readProjectFile(
  projectRoot: string,
  relativePath: string,
): Promise<string | null> {
  try {
    return await readFile(join(projectRoot, relativePath), 'utf8');
  } catch {
    return null;
  }
}

export function readJson<T>(content: string): T | null {
  try {
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

export function normalizeConstraint(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.sdk === 'string') {
      return `sdk:${record.sdk}`;
    }
    if (typeof record.version === 'string') {
      return record.version;
    }
  }

  return 'unknown';
}

export function parseKeyValueLines(
  content: string,
  separator: string,
): Array<{ name: string; value: string }> {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((line) => {
      const index = line.indexOf(separator);
      if (index === -1) {
        return null;
      }

      const name = line.slice(0, index).trim();
      const value = line.slice(index + separator.length).trim();
      if (name === '' || value === '') {
        return null;
      }

      return { name, value };
    })
    .filter((entry): entry is { name: string; value: string } => entry !== null);
}
