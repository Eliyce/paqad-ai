import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function readJsonFile<T>(
  projectRoot: string,
  relativePath: string,
): Promise<T | null> {
  try {
    return JSON.parse(await readFile(join(projectRoot, relativePath), 'utf8')) as T;
  } catch {
    return null;
  }
}

export async function readTextFile(
  projectRoot: string,
  relativePath: string,
): Promise<string | null> {
  try {
    return await readFile(join(projectRoot, relativePath), 'utf8');
  } catch {
    return null;
  }
}
