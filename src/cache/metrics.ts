import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { CacheMetrics } from './types.js';

const EVENT_TO_FIELD = {
  cache_hit: 'cache_hits',
  cache_miss: 'cache_misses',
  prewarm_hit: 'prewarm_hits',
  prewarm_miss: 'prewarm_misses',
  prewarm_skipped: 'prewarm_skipped',
} as const satisfies Record<string, keyof CacheMetrics>;

export class CacheMetricsTracker {
  constructor(private readonly projectRoot: string) {}

  private metricsPath(sessionId: string): string {
    return join(this.projectRoot, '.paqad', 'cache', `metrics-${sessionId}.json`);
  }

  async record(
    sessionId: string,
    event: 'cache_hit' | 'cache_miss' | 'prewarm_hit' | 'prewarm_miss' | 'prewarm_skipped',
    tokenSavings = 0,
  ): Promise<void> {
    const metrics = await this.read(sessionId);
    const field = EVENT_TO_FIELD[event];
    (metrics[field] as number)++;
    metrics.total_token_savings_estimate += tokenSavings;
    await this.write(sessionId, metrics);
  }

  async read(sessionId: string): Promise<CacheMetrics> {
    try {
      const raw = await readFile(this.metricsPath(sessionId), 'utf8');
      return JSON.parse(raw) as CacheMetrics;
    } catch {
      return {
        session_id: sessionId,
        cache_hits: 0,
        cache_misses: 0,
        prewarm_hits: 0,
        prewarm_misses: 0,
        prewarm_skipped: 0,
        total_token_savings_estimate: 0,
      };
    }
  }

  private async write(sessionId: string, metrics: CacheMetrics): Promise<void> {
    const path = this.metricsPath(sessionId);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(metrics, null, 2), 'utf8');
  }
}
