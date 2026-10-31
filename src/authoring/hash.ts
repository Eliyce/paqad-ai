import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import YAML from 'yaml';

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

export function withoutDescription(skillText: string): string {
  const lines = skillText.split(/\r?\n/);
  if (lines[0] !== '---') return skillText;
  const close = lines.indexOf('---', 1);
  if (close === -1) return skillText;
  const kept: string[] = [];
  let skipping = false;
  for (const line of lines.slice(1, close)) {
    if (/^description\s*:/u.test(line)) {
      skipping = true;
      continue;
    }
    if (skipping && /^\s/u.test(line)) continue;
    skipping = false;
    kept.push(line);
  }
  return ['---', ...kept, ...lines.slice(close)].join('\n');
}

export function hashFolderWithoutDescription(root: string): string {
  return hashFiles(
    listFolderFiles(root).map((file) =>
      file.rel === 'SKILL.md'
        ? { rel: file.rel, bytes: Buffer.from(withoutDescription(file.bytes.toString('utf8'))) }
        : file,
    ),
  );
}

function currentDescription(lines: readonly string[], close: number): unknown {
  try {
    return (YAML.parse(lines.slice(1, close).join('\n')) as { description?: unknown } | null)
      ?.description;
  } catch {
    return undefined;
  }
}

/**
 * Writes the description into the frontmatter where it already stands (after name when it is
 * missing), and leaves the text untouched when the description is unchanged, so the published
 * SKILL.md differs from the draft only by the description itself.
 */
export function withDescription(skillText: string, description: string): string {
  const lines = skillText.split('\n');
  if (lines[0] !== '---') return skillText;
  const close = lines.indexOf('---', 1);
  if (close === -1) return skillText;
  if (currentDescription(lines, close) === description) return skillText;
  const line = `description: ${JSON.stringify(description)}`;
  const front = lines.slice(1, close);
  const start = front.findIndex((entry) => /^description\s*:/u.test(entry));
  if (start !== -1) {
    let end = start + 1;
    while (end < front.length && /^\s/u.test(front[end]!)) end += 1;
    front.splice(start, end - start, line);
  } else {
    const name = front.findIndex((entry) => /^name\s*:/u.test(entry));
    front.splice(name + 1, 0, line);
  }
  return ['---', ...front, ...lines.slice(close)].join('\n');
}
