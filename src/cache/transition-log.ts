import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { TransitionEntry, TransitionLog } from './types.js';

export class TransitionLogManager {
  constructor(
    private readonly projectRoot: string,
    private readonly maxPerKey = 500,
  ) {}

  private get logPath(): string {
    return join(this.projectRoot, '.paqad', 'cache', 'transition-log.json');
  }

  async append(entry: TransitionEntry): Promise<void> {
    const log = await this.load();
    const key = entry.stack_key;

    if (!log.entries[key]) {
      log.entries[key] = [];
    }

    log.entries[key].push(entry);

    // FIFO eviction
    if (log.entries[key].length > log.max_entries_per_key) {
      log.entries[key] = log.entries[key].slice(-log.max_entries_per_key);
    }

    await this.save(log);
  }

  async load(): Promise<TransitionLog> {
    try {
      const raw = await readFile(this.logPath, 'utf8');
      return JSON.parse(raw) as TransitionLog;
    } catch {
      return {
        version: 1,
        entries: {},
        max_entries_per_key: this.maxPerKey,
      };
    }
  }

  async computeProbabilities(
    stackKey: string,
    fromSkill: string,
  ): Promise<Array<{ to_skill: string; probability: number }>> {
    const log = await this.load();
    const entries = (log.entries[stackKey] ?? []).filter((e) => e.from_skill === fromSkill);

    if (entries.length === 0) return [];

    const counts: Record<string, number> = {};
    for (const entry of entries) {
      counts[entry.to_skill] = (counts[entry.to_skill] ?? 0) + 1;
    }

    const total = entries.length;
    return Object.entries(counts)
      .map(([to_skill, count]) => ({
        to_skill,
        probability: count / total,
      }))
      .sort((a, b) => b.probability - a.probability);
  }

  private async save(log: TransitionLog): Promise<void> {
    await mkdir(dirname(this.logPath), { recursive: true });
    await writeFile(this.logPath, JSON.stringify(log, null, 2), 'utf8');
  }
}
