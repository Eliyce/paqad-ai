import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import type { FreshnessMetadata } from './types.js';

const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours
const UNKNOWN_NOTE = 'Documentation freshness unknown — run paqad-ai onboard to establish baseline';

export class FreshnessChecker {
  async check(projectRoot: string, evidencePaths: string[]): Promise<FreshnessMetadata> {
    const docProgressPath = join(projectRoot, '.paqad', 'doc-progress.json');
    const stackDriftPath = join(projectRoot, '.paqad', 'stack-drift.json');

    let generatedAt: string | undefined;
    let note: string | undefined;

    try {
      const raw = await readFile(docProgressPath, 'utf8');
      const parsed = JSON.parse(raw) as { generated_at?: string };
      generatedAt = parsed.generated_at;
    } catch {
      note = UNKNOWN_NOTE;
    }

    let driftDetected = false;
    try {
      const raw = await readFile(stackDriftPath, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      driftDetected =
        parsed !== null &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed) &&
        Object.keys(parsed as object).length > 0;
    } catch {
      // no drift file — assume no drift
    }

    const staleSources: string[] = [];

    if (generatedAt) {
      const baseTime = new Date(generatedAt).getTime();
      for (const relativePath of evidencePaths) {
        const absolutePath = join(projectRoot, relativePath);
        try {
          const info = await stat(absolutePath);
          const ageDiff = info.mtimeMs - baseTime;
          if (ageDiff > STALE_THRESHOLD_MS) {
            staleSources.push(relativePath);
          }
        } catch {
          // can't stat — skip
        }
      }
    }

    return {
      stale_sources: staleSources,
      drift_detected: driftDetected,
      ...(generatedAt !== undefined && { generated_at: generatedAt }),
      ...(note !== undefined && { note }),
    };
  }
}
