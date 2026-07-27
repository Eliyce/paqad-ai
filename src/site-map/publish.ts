// The impure half of publication: land the derived views on disk with differential refresh.
// Reuses the real DocumentProgressTracker so site-map outputs share the crash-recovery and
// staleness machinery every other generated doc uses (registered under a `siteMap` group in
// `.paqad/doc-progress.json`). A view whose bytes already match is skipped, so re-running the
// audit over an unchanged map rewrites nothing.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { AppMap } from '@/core/types/site-map.js';
import { DocumentProgressTracker } from '@/document/progress-tracker.js';
import { hashSourceFiles } from '@/document/staleness.js';

import { assembleSiteMapPublication, estimateTokens } from './publication.js';

export interface SiteMapPublishResult {
  /** Repo-relative paths whose bytes changed and were (re)written. */
  published: string[];
  /** Repo-relative paths already up to date, left untouched. */
  skipped: string[];
}

export interface SiteMapPublishOptions {
  projectRoot: string;
  map: AppMap;
  journeyCount: number;
  now?: () => Date;
  tracker?: DocumentProgressTracker;
}

/** Regenerate and persist every derived view of the map, registering each in the doc tracker. */
export async function publishSiteMap(
  options: SiteMapPublishOptions,
): Promise<SiteMapPublishResult> {
  const { projectRoot, map, journeyCount } = options;
  const now = options.now ?? (() => new Date());
  const tracker = options.tracker ?? new DocumentProgressTracker();

  const outputs = assembleSiteMapPublication(map, journeyCount);
  const progress = await tracker.load(projectRoot);
  const group = (progress.global.siteMap ??= {});

  const published: string[] = [];
  const skipped: string[] = [];

  for (const output of outputs) {
    const entry = (group[output.path] ??= tracker.createEntry(output.path, output.source_files));
    const iso = now().toISOString();
    const currentHash = await hashSourceFiles(projectRoot, entry.source_files);
    const existing = await readFile(join(projectRoot, output.path), 'utf8').catch(() => null);

    if (existing === output.contents) {
      skipped.push(output.path);
    } else {
      await mkdir(dirname(join(projectRoot, output.path)), { recursive: true });
      await writeFile(join(projectRoot, output.path), output.contents);
      published.push(output.path);
    }

    entry.started_at ??= iso;
    entry.state = 'done';
    entry.completed_at = iso;
    entry.source_hash = currentHash;
    entry.tokens_used = estimateTokens(output.contents);
  }

  await tracker.save(projectRoot, progress);
  return { published, skipped };
}
