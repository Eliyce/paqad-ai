import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { FRAMEWORK_VERSION } from '@/core/constants/version.js';

import { ageInDays, bandForScore, scoreFreshness } from '../scoring/index.js';
import type { SectionData } from '../types.js';
import { fileMtime } from './fs-helpers.js';

interface ParsedVersionFile {
  version: string | null;
  updatedAt: number | null;
}

function parseVersionFile(raw: string): ParsedVersionFile {
  const result: ParsedVersionFile = { version: null, updatedAt: null };
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key === 'version') {
      result.version = value;
    } else if (key === 'updated_at') {
      const ts = Date.parse(value);
      if (!Number.isNaN(ts)) result.updatedAt = ts;
    }
  }
  return result;
}

const HELPER = {
  what: 'Pins the paqad-ai framework version the project was last updated to. Written by `paqad-ai update`.',
  goodLooksLike: 'Matches the installed package version and was refreshed in the last 30 days.',
} as const;

export interface FrameworkVersionSection {
  section: SectionData;
  frameworkVersion: string | null;
}

export function collectFrameworkVersion(
  projectRoot: string,
  now: number = Date.now(),
): FrameworkVersionSection {
  const path = join(projectRoot, PATHS.FRAMEWORK_VERSION);
  if (!existsSync(path)) {
    return {
      section: {
        id: 'framework-version',
        title: 'Framework version',
        band: 'unknown',
        score: null,
        summary: 'No framework-version.txt — run `paqad-ai onboard` or `update`.',
        metrics: [],
        helper: HELPER,
      },
      frameworkVersion: null,
    };
  }

  let parsed: ParsedVersionFile;
  try {
    parsed = parseVersionFile(readFileSync(path, 'utf8'));
  } catch {
    parsed = { version: null, updatedAt: null };
  }

  const fileMtimeMs = fileMtime(path);
  const refTimestamp = parsed.updatedAt ?? fileMtimeMs;
  const installed = FRAMEWORK_VERSION;
  const recorded = parsed.version;
  const matches = recorded !== null && recorded === installed;

  const freshness = scoreFreshness(refTimestamp, { now });
  // Out-of-sync versions cap the score at 60 (amber). In-sync just rides
  // freshness.
  const score = matches ? freshness : Math.min(60, freshness);
  const age = ageInDays(refTimestamp, now);

  const summary = matches
    ? `On v${installed}${age !== null ? ` · updated ${age}d ago` : ''}`
    : recorded === null
      ? `Installed v${installed} · version not recorded`
      : `Drift: project on v${recorded}, package v${installed}`;

  return {
    section: {
      id: 'framework-version',
      title: 'Framework version',
      band: bandForScore(score),
      score,
      summary,
      metrics: [
        { label: 'recorded', value: recorded ?? '—' },
        { label: 'installed', value: installed },
        { label: 'age', value: age !== null ? `${age}d` : '—' },
      ],
      helper: HELPER,
      details: {
        recordedVersion: recorded,
        installedVersion: installed,
        updatedAt: parsed.updatedAt,
        mtimeMs: fileMtimeMs,
      },
    },
    frameworkVersion: recorded,
  };
}
