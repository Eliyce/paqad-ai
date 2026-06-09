// PQD-174 — registry + path resolution for ephemeral attachment collections.
//
// The registry is a single JSON file mapping each live session to its
// collection. It is the enumeration source the orphan sweep walks to find
// collections whose owning session is gone. This module also owns the on-disk
// path layout for collections and the path-traversal safeguard shared by the
// indexer, sweep, and retriever — a crafted `sessionId` (e.g. `../../`) must
// never let a write or an `rm` escape the attachments root.

import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';

import type { AttachmentRecord, EphemeralCollectionId } from './attachment-types.js';
import { toEphemeralCollectionId } from './attachment-types.js';

/** A `sessionId` whose collection path would escape the attachments root. */
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

/** Absolute path of the attachments root for a given project/storage root. */
export function attachmentCollectionsRoot(projectRoot: string): string {
  return resolve(projectRoot, PATHS.SESSION_ATTACHMENT_COLLECTIONS_DIR);
}

/**
 * Resolve the absolute collection directory for a session, asserting it stays
 * inside the attachments root. Throws {@link AttachmentPathError} for an empty
 * id or one that resolves outside the root (path traversal).
 */
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

/**
 * Project-relative `index.json` / `meta.json` paths for a session's collection,
 * suitable for {@link FileVectorIndex}, which joins them onto `projectRoot`.
 * Resolution is validated via {@link resolveCollectionDir} first.
 */
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
    // A corrupt registry must not wedge indexing or the orphan sweep; treat it
    // as empty. The next write rewrites it cleanly.
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

/**
 * Record (or overwrite) the collection a session owns. Re-registering the same
 * session replaces its row so a reindex never duplicates the mapping.
 */
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

/** Remove a session's registry row. A no-op when the session is unknown. */
export async function deregisterCollection(projectRoot: string, sessionId: string): Promise<void> {
  const file = await readRegistry(projectRoot);
  const collections = file.collections.filter((record) => record.sessionId !== sessionId);
  if (collections.length === file.collections.length) {
    return;
  }
  await writeRegistry(projectRoot, { version: 1, collections });
}

/** Every registered (sessionId, collectionId) pair. */
export async function listCollections(
  projectRoot: string,
): Promise<{ sessionId: string; collectionId: EphemeralCollectionId }[]> {
  const file = await readRegistry(projectRoot);
  return file.collections.map((record) => ({
    sessionId: record.sessionId,
    collectionId: toEphemeralCollectionId(record.collectionId),
  }));
}

/** The collection id registered for a session, or null when none exists. */
export async function getCollectionId(
  projectRoot: string,
  sessionId: string,
): Promise<EphemeralCollectionId | null> {
  const file = await readRegistry(projectRoot);
  const record = file.collections.find((entry) => entry.sessionId === sessionId);
  return record ? toEphemeralCollectionId(record.collectionId) : null;
}
