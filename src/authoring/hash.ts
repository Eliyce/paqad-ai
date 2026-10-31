import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface HashedFile {
  rel: string;
  bytes: Buffer;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function listFolderFiles(root: string, prefix = ''): HashedFile[] {
  if (!existsSync(join(root, prefix))) return [];
  const files: HashedFile[] = [];
  for (const name of readdirSync(join(root, prefix)).sort(compareText)) {
    const rel = prefix === '' ? name : `${prefix}/${name}`;
    const stat = lstatSync(join(root, rel));
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) files.push(...listFolderFiles(root, rel));
    else files.push({ rel, bytes: readFileSync(join(root, rel)) });
  }
  return files;
}

export function hashFiles(files: readonly HashedFile[]): string {
  const hash = createHash('sha256');
  for (const file of [...files].sort((left, right) => compareText(left.rel, right.rel))) {
    hash.update(file.rel);
    hash.update('\u0000');
    hash.update(file.bytes);
    hash.update('\u0000');
  }
  return `sha256:${hash.digest('hex')}`;
}

export function hashFolder(root: string, include?: (rel: string) => boolean): string {
  const files = listFolderFiles(root).filter((file) => include === undefined || include(file.rel));
  return hashFiles(files);
}

export function hashText(text: string | Buffer): string {
  return `sha256:${createHash('sha256').update(text).digest('hex')}`;
}
