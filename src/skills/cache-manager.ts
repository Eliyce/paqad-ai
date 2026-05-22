import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import fg from 'fast-glob';

import { getRuntimeRoot } from '@/core/runtime-paths.js';
import type { CacheStats, SkillCacheEntry, SkillCacheResult } from '@/core/types/skill.js';

import { SkillFrontmatterParser } from './frontmatter-parser.js';

interface CacheMetrics {
  hits: number;
  misses: number;
}

const STATS_FILE = '.stats.json';

export class SkillCacheManager {
  private readonly parser = new SkillFrontmatterParser();
  private readonly cacheability = new Map<string, boolean>();
  private cacheabilityLoaded = false;

  constructor(private readonly cacheDir: string) {}

  async checkCache(skillName: string, inputFiles: string[]): Promise<SkillCacheResult> {
    await mkdir(this.cacheDir, { recursive: true });

    const inputHash = await this.computeInputHash(inputFiles);

    if (!(await this.isCacheable(skillName))) {
      await this.updateMetrics('misses');
      return { hit: false, input_hash: inputHash };
    }

    const cachePath = join(this.cacheDir, `${skillName}-${inputHash}.json`);

    try {
      const cached = JSON.parse(await readFile(cachePath, 'utf8')) as SkillCacheEntry;
      await this.updateMetrics('hits');
      return { hit: true, result: cached.result, input_hash: inputHash };
    } catch {
      await this.updateMetrics('misses');
      return { hit: false, input_hash: inputHash };
    }
  }

  async writeCache(
    skillName: string,
    inputHash: string,
    result: unknown,
    filesHashed: string[],
  ): Promise<void> {
    if (!(await this.isCacheable(skillName))) {
      return;
    }

    await mkdir(this.cacheDir, { recursive: true });
    const entry: SkillCacheEntry = {
      skill_name: skillName,
      input_hash: inputHash,
      result,
      created_at: new Date().toISOString(),
      files_hashed: [...filesHashed].sort(),
    };

    await writeFile(
      join(this.cacheDir, `${skillName}-${inputHash}.json`),
      JSON.stringify(entry, null, 2),
    );
  }

  async invalidateModule(moduleName: string): Promise<number> {
    await mkdir(this.cacheDir, { recursive: true });
    const files = await readdir(this.cacheDir);
    let removed = 0;

    for (const file of files) {
      if (file === STATS_FILE || !file.endsWith('.json')) {
        continue;
      }

      const path = join(this.cacheDir, file);
      const entry = JSON.parse(await readFile(path, 'utf8')) as SkillCacheEntry;
      if (entry.files_hashed.some((hashedFile) => hashedFile.includes(moduleName))) {
        await rm(path);
        removed += 1;
      }
    }

    return removed;
  }

  async getStats(): Promise<CacheStats> {
    await mkdir(this.cacheDir, { recursive: true });
    const files = await readdir(this.cacheDir);
    let totalEntries = 0;
    let totalSize = 0;

    for (const file of files) {
      if (file === STATS_FILE || !file.endsWith('.json')) {
        continue;
      }

      const fileStat = await stat(join(this.cacheDir, file));
      totalEntries += 1;
      totalSize += fileStat.size;
    }

    const metrics = await this.readMetrics();
    const totalChecks = metrics.hits + metrics.misses;

    return {
      total_entries: totalEntries,
      total_size_bytes: totalSize,
      hit_rate: totalChecks === 0 ? 0 : metrics.hits / totalChecks,
    };
  }

  async computeInputHash(files: string[]): Promise<string> {
    const hash = createHash('sha256');

    for (const file of [...files].sort()) {
      hash.update(file);
      hash.update('\0');
      hash.update(await readFile(file));
      hash.update('\0');
    }

    return hash.digest('hex');
  }

  private async isCacheable(skillName: string): Promise<boolean> {
    if (!this.cacheabilityLoaded) {
      await this.loadCacheability();
    }

    return this.cacheability.get(skillName) ?? true;
  }

  private async updateMetrics(kind: keyof CacheMetrics): Promise<void> {
    const metrics = await this.readMetrics();
    metrics[kind] += 1;
    await writeFile(join(this.cacheDir, STATS_FILE), JSON.stringify(metrics, null, 2));
  }

  private async readMetrics(): Promise<CacheMetrics> {
    try {
      return JSON.parse(await readFile(join(this.cacheDir, STATS_FILE), 'utf8')) as CacheMetrics;
    } catch {
      return { hits: 0, misses: 0 };
    }
  }

  private async loadCacheability(): Promise<void> {
    const files = await fg(
      [
        'base/skills/**/SKILL.md',
        'capabilities/coding/skills/**/SKILL.md',
        'capabilities/security/skills/**/SKILL.md',
      ],
      {
        cwd: getRuntimeRoot(),
        absolute: true,
        onlyFiles: true,
      },
    );

    for (const file of files) {
      const parsed = this.parser.parse(await readFile(file, 'utf8'));
      this.cacheability.set(parsed.frontmatter.name, parsed.frontmatter.cacheable);
    }

    this.cacheabilityLoaded = true;
  }
}
