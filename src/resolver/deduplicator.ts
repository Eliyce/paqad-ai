import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';

import type { DeduplicationStats } from '../core/types/context.js';

export interface DeduplicatorArtifact {
  path: string;
  content?: string;
  type: string;
}

export class ContextDeduplicator {
  private readonly contentHashMap = new Map<string, string>(); // hash -> first-seen artifact path

  async deduplicate(
    projectRoot: string,
    artifacts: DeduplicatorArtifact[],
  ): Promise<{
    artifacts: DeduplicatorArtifact[];
    references: Map<string, string>;
    stats: DeduplicationStats;
  }> {
    const references = new Map<string, string>();
    const result: DeduplicatorArtifact[] = [];
    let deduplicated = 0;
    let tokensSaved = 0;

    for (const artifact of artifacts) {
      const content = artifact.content ?? (await this.readContent(artifact.path));
      const hash = this.computeHash(content);

      if (this.contentHashMap.has(hash)) {
        const originalPath = this.contentHashMap.get(hash)!;
        references.set(artifact.path, originalPath);
        const saved = Math.ceil(content.length / 4);
        tokensSaved += saved;
        deduplicated++;
        result.push({
          ...artifact,
          content: `[See: ${originalPath} already loaded above]`,
        });
      } else {
        this.contentHashMap.set(hash, artifact.path);
        result.push({ ...artifact, content });
      }
    }

    const stats: DeduplicationStats = {
      total_artifacts: artifacts.length,
      deduplicated,
      tokens_saved_estimate: tokensSaved,
    };

    await this.persistStats(projectRoot, stats);

    return { artifacts: result, references, stats };
  }

  reset(): void {
    this.contentHashMap.clear();
  }

  private async readContent(filePath: string): Promise<string> {
    try {
      return await readFile(filePath, 'utf8');
    } catch {
      return '';
    }
  }

  private computeHash(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  private async persistStats(projectRoot: string, stats: DeduplicationStats): Promise<void> {
    try {
      const statsPath = join(projectRoot, '.paqad', 'session', 'dedup-stats.json');
      await mkdir(dirname(statsPath), { recursive: true });
      await writeFile(statsPath, JSON.stringify(stats, null, 2), 'utf8');
    } catch {
      // non-critical
    }
  }
}
