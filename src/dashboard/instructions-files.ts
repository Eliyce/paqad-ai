import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import YAML from 'yaml';

import { PATHS } from '@/core/constants/paths.js';
import { toPosixPath } from '@/core/path-utils.js';

import { readManagedFile, type ManagedFile } from './write-pipeline.js';

/**
 * Issue #146 — `/api/files/instructions*` read side. The tree drives the
 * Knowledge area's two-pane editor; file reads return parsed frontmatter so
 * the editor can render it as fields. Writes go through the shared
 * write-pipeline (allowlist, hash guard, audit) in the server route.
 */

export interface InstructionsTreeNode {
  /** Path relative to docs/instructions, posix. Empty string for the root. */
  path: string;
  name: string;
  type: 'directory' | 'file';
  children?: InstructionsTreeNode[];
}

const EDITABLE_EXTENSIONS = ['.md', '.yml', '.yaml', '.json'];

function buildNode(absolute: string, relative: string, name: string): InstructionsTreeNode | null {
  const entries = readdirSync(absolute, { withFileTypes: true });
  const children: InstructionsTreeNode[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.')) continue;
    const childRelative = relative === '' ? entry.name : `${relative}/${entry.name}`;
    if (entry.isDirectory()) {
      const child = buildNode(join(absolute, entry.name), childRelative, entry.name);
      if (child) children.push(child);
    } else if (EDITABLE_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) {
      children.push({ path: childRelative, name: entry.name, type: 'file' });
    }
  }
  return { path: relative, name, type: 'directory', children };
}

export interface InstructionsTree {
  root: string;
  exists: boolean;
  tree: InstructionsTreeNode | null;
}

export function listInstructionsTree(projectRoot: string): InstructionsTree {
  const root = join(projectRoot, PATHS.INSTRUCTIONS_DIR);
  if (!existsSync(root)) {
    return { root: PATHS.INSTRUCTIONS_DIR, exists: false, tree: null };
  }
  return {
    root: PATHS.INSTRUCTIONS_DIR,
    exists: true,
    tree: buildNode(root, '', 'instructions'),
  };
}

export interface InstructionsFile extends ManagedFile {
  /** Parsed YAML frontmatter for .md files (empty object when none). */
  frontmatter: Record<string, unknown>;
  /** File body with the frontmatter block removed (equals content for non-md). */
  body: string | null;
}

/** Splits a leading `---` YAML frontmatter block from a Markdown document. */
function splitFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content);
  if (!match) {
    return { frontmatter: {}, body: content };
  }
  try {
    const parsed: unknown = YAML.parse(match[1]!);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { frontmatter: {}, body: content };
    }
    return {
      frontmatter: parsed as Record<string, unknown>,
      body: content.slice(match[0].length),
    };
  } catch {
    return { frontmatter: {}, body: content };
  }
}

export function readInstructionsFile(projectRoot: string, treePath: string): InstructionsFile {
  const posix = toPosixPath(treePath).replace(/^\/+/, '');
  const file = readManagedFile(projectRoot, `${PATHS.INSTRUCTIONS_DIR}/${posix}`);
  if (!file.exists || file.content === null || !file.path.endsWith('.md')) {
    return { ...file, frontmatter: {}, body: file.content };
  }
  const { frontmatter, body } = splitFrontmatter(file.content);
  return { ...file, frontmatter, body };
}
