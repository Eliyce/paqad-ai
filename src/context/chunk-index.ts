import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import type { ChunkIndex, ChunkIndexEntry } from './types.js';
import type { AstChunker } from './ast-chunker.js';
import type { ChunkIndexSyncResult } from '@/rag/types.js';

export class ChunkIndexManager {
  constructor(private readonly projectRoot: string) {}

  get indexPath(): string {
    return join(this.projectRoot, '.paqad', 'context', 'chunk-index.json');
  }

  async load(): Promise<ChunkIndex | null> {
    try {
      const raw = await readFile(this.indexPath, 'utf8');
      return JSON.parse(raw) as ChunkIndex;
    } catch {
      return null;
    }
  }

  async save(index: ChunkIndex): Promise<void> {
    await mkdir(dirname(this.indexPath), { recursive: true });
    await writeFile(this.indexPath, JSON.stringify(index, null, 2), 'utf8');
  }

  async rebuild(files: string[], chunker: AstChunker): Promise<ChunkIndex> {
    const entries: ChunkIndexEntry[] = [];

    for (const filePath of files) {
      try {
        const content = await readFile(filePath, 'utf8');
        const fileHash = this.computeFileHash(content);
        const fileStat = await stat(filePath);
        const chunks = chunker.chunk(filePath, content);
        entries.push({
          source_file: filePath,
          source_file_hash: fileHash,
          modified_at: fileStat.mtime.toISOString(),
          chunks,
        });
      } catch {
        // Skip unreadable files
      }
    }

    const index: ChunkIndex = {
      version: 1,
      generated_at: new Date().toISOString(),
      entries,
    };

    await this.save(index);
    return index;
  }

  async incrementalUpdate(
    changedFiles: string[],
    index: ChunkIndex,
    chunker: AstChunker,
  ): Promise<ChunkIndex> {
    const changedSet = new Set(changedFiles);

    const updatedEntries = index.entries.filter((e) => !changedSet.has(e.source_file));

    for (const filePath of changedFiles) {
      try {
        const content = await readFile(filePath, 'utf8');
        const fileHash = this.computeFileHash(content);
        const fileStat = await stat(filePath);
        const chunks = chunker.chunk(filePath, content);
        updatedEntries.push({
          source_file: filePath,
          source_file_hash: fileHash,
          modified_at: fileStat.mtime.toISOString(),
          chunks,
        });
      } catch {
        // Skip
      }
    }

    const updated: ChunkIndex = {
      ...index,
      generated_at: new Date().toISOString(),
      entries: updatedEntries,
    };

    await this.save(updated);
    return updated;
  }

  async isStale(index: ChunkIndex): Promise<{ stale: boolean; changedFiles: string[] }> {
    const changedFiles: string[] = [];

    for (const entry of index.entries) {
      try {
        const content = await readFile(entry.source_file, 'utf8');
        const currentHash = this.computeFileHash(content);
        if (currentHash !== entry.source_file_hash) {
          changedFiles.push(entry.source_file);
        }
      } catch {
        changedFiles.push(entry.source_file); // file deleted/moved
      }
    }

    return { stale: changedFiles.length > 0, changedFiles };
  }

  async sync(files: string[], chunker: AstChunker): Promise<ChunkIndexSyncResult> {
    const normalizedFiles = [...new Set(files)].sort();
    const index = await this.load();

    if (!index) {
      return {
        index: await this.rebuild(normalizedFiles, chunker),
        changed_files: [],
        added_files: [...normalizedFiles],
        deleted_files: [],
        updated: true,
      };
    }

    const fileSet = new Set(normalizedFiles);
    const indexedFiles = new Set(index.entries.map((entry) => entry.source_file));
    const addedFiles = normalizedFiles.filter((filePath) => !indexedFiles.has(filePath));
    const deletedFiles = index.entries
      .map((entry) => entry.source_file)
      .filter((filePath) => !fileSet.has(filePath));
    const changedFiles: string[] = [];

    for (const entry of index.entries) {
      if (!fileSet.has(entry.source_file)) {
        continue;
      }
      try {
        const content = await readFile(entry.source_file, 'utf8');
        const currentHash = this.computeFileHash(content);
        if (currentHash !== entry.source_file_hash) {
          changedFiles.push(entry.source_file);
        }
      } catch {
        deletedFiles.push(entry.source_file);
      }
    }

    const changedSet = new Set([...addedFiles, ...changedFiles]);
    const deletedSet = new Set(deletedFiles);

    if (changedSet.size === 0 && deletedSet.size === 0) {
      return {
        index,
        changed_files: changedFiles,
        added_files: addedFiles,
        deleted_files: deletedFiles,
        updated: false,
      };
    }

    const updatedEntries = index.entries.filter(
      (entry) => !changedSet.has(entry.source_file) && !deletedSet.has(entry.source_file),
    );

    for (const filePath of changedSet) {
      try {
        const content = await readFile(filePath, 'utf8');
        const fileHash = this.computeFileHash(content);
        const fileStat = await stat(filePath);
        const chunks = chunker.chunk(filePath, content);
        updatedEntries.push({
          source_file: filePath,
          source_file_hash: fileHash,
          modified_at: fileStat.mtime.toISOString(),
          chunks,
        });
      } catch {
        // ignore unreadable file during sync
      }
    }

    const updated: ChunkIndex = {
      ...index,
      generated_at: new Date().toISOString(),
      entries: updatedEntries.sort((left, right) =>
        left.source_file.localeCompare(right.source_file),
      ),
    };

    await this.save(updated);
    return {
      index: updated,
      changed_files: changedFiles,
      added_files: addedFiles,
      deleted_files: deletedFiles,
      updated: true,
    };
  }

  private computeFileHash(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }
}
