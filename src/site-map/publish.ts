// The impure half of publication: land the derived views on disk with differential refresh.
// Uses the site-map module's OWN progress ledger (`.paqad/site-map/progress.json`, issue #448)
// rather than the documentation workflow's shared doc-progress.json — the two are independent
// concerns, and coupling them meant a legacy/invalid doc-progress could abort a site-map run. A
// view whose bytes already match is skipped, so re-running the audit over an unchanged map
// rewrites nothing. A corrupt progress ledger degrades to empty and self-heals on this run.

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { AppMap } from '@/core/types/site-map.js';
import type { SiteMapProgressFile } from '@/core/types/site-map-progress.js';
import { hashSourceFiles } from '@/document/staleness.js';

import { assembleSiteMapPublication, estimateTokens } from './publication.js';
import {
  createSiteMapProgressEntry,
  emptySiteMapProgress,
  readSiteMapProgress,
  writeSiteMapProgress,
} from './progress-store.js';

export interface SiteMapPublishResult {
  /** Repo-relative paths whose bytes changed and were (re)written. */
  published: string[];
  /** Repo-relative paths already up to date, left untouched. */
  skipped: string[];
  /** Repo-relative paths a prior run produced that the map no longer produces — deleted. */
  removed: string[];
}

export interface SiteMapPublishOptions {
  projectRoot: string;
  map: AppMap;
  journeyCount: number;
  now?: () => Date;
}

/** Regenerate and persist every derived view of the map, recording each in the progress ledger. */
export async function publishSiteMap(
  options: SiteMapPublishOptions,
): Promise<SiteMapPublishResult> {
  const { projectRoot, map, journeyCount } = options;
  const now = options.now ?? (() => new Date());

  const outputs = assembleSiteMapPublication(map, journeyCount);
  // A missing or invalid ledger degrades to empty — the run re-establishes its views rather
  // than crashing on an unrelated stale file (INV-3), which is the #448 failure removed here.
  const progress: SiteMapProgressFile = readSiteMapProgress(projectRoot) ?? emptySiteMapProgress();
  const views = progress.views;

  const published: string[] = [];
  const skipped: string[] = [];

  for (const output of outputs) {
    const entry = (views[output.path] ??= createSiteMapProgressEntry(
      output.path,
      output.source_files,
    ));
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

  // Stale-view cleanup: a view a prior run produced but this map no longer produces (e.g. an
  // app that dropped every screen leaves a lingering screen-registry) is deleted and dropped
  // from the ledger, so the published set never over-states what the map contains.
  const currentPaths = new Set(outputs.map((output) => output.path));
  const removed: string[] = [];
  for (const path of Object.keys(views)) {
    if (!currentPaths.has(path)) {
      await rm(join(projectRoot, path), { force: true });
      delete views[path];
      removed.push(path);
    }
  }

  writeSiteMapProgress(projectRoot, progress);
  return { published, skipped, removed: removed.sort() };
}

/**
 * The published view paths whose source files have changed since the last publish — i.e. the
 * map drifted from the code. Compares each ledger entry's recorded `source_hash` against a
 * fresh hash of its source files (the same staleness signal the differential refresh uses).
 * Returns [] when nothing has been published yet (no ledger, or an invalid one), so a project
 * that never ran a site-map audit — or whose ledger is unreadable — is never reported stale.
 */
export async function collectStaleSiteMapViews(projectRoot: string): Promise<string[]> {
  const progress = readSiteMapProgress(projectRoot);
  if (progress === null) {
    return [];
  }

  const stale: string[] = [];
  for (const [path, entry] of Object.entries(progress.views)) {
    const currentHash = await hashSourceFiles(projectRoot, entry.source_files);
    if (entry.source_hash !== currentHash) {
      stale.push(path);
    }
  }

  return stale.sort();
}
