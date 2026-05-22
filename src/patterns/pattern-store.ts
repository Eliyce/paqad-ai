import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

import type { Pattern, PatternIndex, PatternIndexEntry, PatternFilter } from './types.js';

const GLOBAL_PATTERNS_DIR = join(homedir(), '.paqad', 'patterns');

export class PatternStore {
  get indexPath(): string {
    return join(GLOBAL_PATTERNS_DIR, 'index.json');
  }

  get entriesDir(): string {
    return join(GLOBAL_PATTERNS_DIR, 'entries');
  }

  async save(pattern: Pattern): Promise<void> {
    await mkdir(this.entriesDir, { recursive: true });
    const entryPath = join(this.entriesDir, `${pattern.id}.json`);
    await writeFile(entryPath, JSON.stringify(pattern, null, 2), 'utf8');
    await this.updateIndex(pattern);
  }

  async load(id: string): Promise<Pattern | null> {
    try {
      const raw = await readFile(join(this.entriesDir, `${id}.json`), 'utf8');
      return JSON.parse(raw) as Pattern;
    } catch {
      return null;
    }
  }

  async loadIndex(): Promise<PatternIndex> {
    try {
      const raw = await readFile(this.indexPath, 'utf8');
      return JSON.parse(raw) as PatternIndex;
    } catch {
      return { version: 1, entries: [] };
    }
  }

  async updateIndex(pattern: Pattern): Promise<void> {
    const index = await this.loadIndex();
    const existingIdx = index.entries.findIndex((e) => e.id === pattern.id);
    const entry: PatternIndexEntry = {
      id: pattern.id,
      category: pattern.category,
      stack_filter: pattern.stack_filter,
      tags: pattern.tags,
      created_at: pattern.created_at,
      problem_preview: pattern.problem.slice(0, 100),
    };

    if (existingIdx >= 0) {
      index.entries[existingIdx] = entry;
    } else {
      index.entries.push(entry);
    }

    await mkdir(dirname(this.indexPath), { recursive: true });
    await writeFile(this.indexPath, JSON.stringify(index, null, 2), 'utf8');
  }

  async delete(id: string): Promise<void> {
    try {
      await unlink(join(this.entriesDir, `${id}.json`));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }

    const index = await this.loadIndex();
    index.entries = index.entries.filter((e) => e.id !== id);
    await writeFile(this.indexPath, JSON.stringify(index, null, 2), 'utf8');
  }

  async list(filter?: PatternFilter): Promise<Pattern[]> {
    const index = await this.loadIndex();
    let entries = index.entries;

    if (filter?.domain) {
      entries = entries.filter((e) => e.stack_filter.domain === filter.domain);
    }
    if (filter?.frameworks && filter.frameworks.length > 0) {
      entries = entries.filter((e) =>
        filter.frameworks!.some((f) => e.stack_filter.frameworks.includes(f)),
      );
    }
    if (filter?.category) {
      entries = entries.filter((e) => e.category === filter.category);
    }
    if (filter?.keywords && filter.keywords.length > 0) {
      entries = entries.filter((e) =>
        filter.keywords!.some(
          (kw) =>
            e.problem_preview.toLowerCase().includes(kw.toLowerCase()) ||
            e.tags.some((t) => t.toLowerCase().includes(kw.toLowerCase())),
        ),
      );
    }

    const patterns: Pattern[] = [];
    for (const entry of entries) {
      const pattern = await this.load(entry.id);
      if (pattern) patterns.push(pattern);
    }
    return patterns;
  }
}
