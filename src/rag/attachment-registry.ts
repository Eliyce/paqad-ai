import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';

import type { AttachmentRecord, EphemeralCollectionId } from './attachment-types.js';
import { toEphemeralCollectionId } from './attachment-types.js';

export class AttachmentPathError extends Error {
  constructor(
    readonly sessionId: string,
    message: string,
  ) {
    super(message);
    this.name = 'AttachmentPathError';
  }
}

interface RegistryFile {
  version: 1;
  collections: AttachmentRecord[];
}

export function attachmentCollectionsRoot(projectRoot: string): string {
  return resolve(projectRoot, PATHS.SESSION_ATTACHMENT_COLLECTIONS_DIR);
}

export function resolveCollectionDir(projectRoot: string, sessionId: string): string {
  if (sessionId.trim().length === 0) {
    throw new AttachmentPathError(sessionId, 'Attachment session id must not be empty');
  }
  const root = attachmentCollectionsRoot(projectRoot);
  const dir = resolve(root, sessionId);
  if (dir !== root && !dir.startsWith(root + sep)) {
    throw new AttachmentPathError(
      sessionId,
      `Attachment session id resolves outside the attachments root: ${sessionId}`,
    );
  }
  if (dir === root) {
    throw new AttachmentPathError(
      sessionId,
      `Attachment session id is not a valid segment: ${sessionId}`,
    );
  }
  return dir;
}

export function collectionVectorPaths(
  projectRoot: string,
  sessionId: string,
): { indexPath: string; metaPath: string } {
  resolveCollectionDir(projectRoot, sessionId);
  const base = `${PATHS.SESSION_ATTACHMENT_COLLECTIONS_DIR}/${sessionId}`;
  return { indexPath: `${base}/index.json`, metaPath: `${base}/meta.json` };
}

function registryPath(projectRoot: string): string {
  return join(projectRoot, PATHS.SESSION_ATTACHMENT_REGISTRY);
}

async function readRegistry(projectRoot: string): Promise<RegistryFile> {
  const path = registryPath(projectRoot);
  if (!existsSync(path)) {
    return { version: 1, collections: [] };
  }
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as Partial<RegistryFile>;
    return { version: 1, collections: parsed.collections ?? [] };
  } catch {
    return { version: 1, collections: [] };
  }
}

async function writeRegistry(projectRoot: string, file: RegistryFile): Promise<void> {
  const path = registryPath(projectRoot);
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(file, null, 2), 'utf8');
  await rename(tmp, path);
}

export async function registerCollection(
  projectRoot: string,
  sessionId: string,
  collectionId: EphemeralCollectionId,
  filePaths: string[] = [],
  status: AttachmentRecord['status'] = 'indexed',
): Promise<void> {
  const file = await readRegistry(projectRoot);
  const collections = file.collections.filter((record) => record.sessionId !== sessionId);
  collections.push({ sessionId, collectionId, filePaths, status });
  await writeRegistry(projectRoot, { version: 1, collections });
}

export async function deregisterCollection(projectRoot: string, sessionId: string): Promise<void> {
  const file = await readRegistry(projectRoot);
  const collections = file.collections.filter((record) => record.sessionId !== sessionId);
  if (collections.length === file.collections.length) {
    return;
  }
  await writeRegistry(projectRoot, { version: 1, collections });
}

export async function listCollections(
  projectRoot: string,
): Promise<{ sessionId: string; collectionId: EphemeralCollectionId }[]> {
  const file = await readRegistry(projectRoot);
  return file.collections.map((record) => ({
    sessionId: record.sessionId,
    collectionId: toEphemeralCollectionId(record.collectionId),
  }));
}

export async function getCollectionId(
  projectRoot: string,
  sessionId: string,
): Promise<EphemeralCollectionId | null> {
  const file = await readRegistry(projectRoot);
  const record = file.collections.find((entry) => entry.sessionId === sessionId);
  return record ? toEphemeralCollectionId(record.collectionId) : null;
}
