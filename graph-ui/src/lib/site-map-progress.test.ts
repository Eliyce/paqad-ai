import { describe, expect, it } from 'vitest';

import {
  summarizeSiteMapProgress,
  type SiteMapProgressFile,
  type SiteMapProgressState,
  type SiteMapProgressUnit,
} from './site-map-progress';

function unit(id: string, state: SiteMapProgressState, label = `label:${id}`): SiteMapProgressUnit {
  return {
    id,
    kind: 'group',
    label,
    state,
    started_at: null,
    completed_at: null,
    artifact: null,
    source_files: [],
    source_hash: null,
    error: null,
  };
}

function file(units: SiteMapProgressUnit[]): SiteMapProgressFile {
  return {
    schema_version: '1',
    generated_by: 'paqad-ai',
    framework_version: '1.0.0',
    created_at: '2026-08-31T10:00:00.000Z',
    updated_at: '2026-08-31T10:00:00.000Z',
    inventory: { screens: 0, groups: [] },
    units: Object.fromEntries(units.map((u) => [u.id, u])),
  };
}

describe('summarizeSiteMapProgress (S6)', () => {
  it('projects a populated payload into the strip fields, writing wins the current line', () => {
    const strip = summarizeSiteMapProgress(
      file([
        unit('a', 'done'),
        unit('b', 'done'),
        unit('c', 'writing', 'Billing'),
        unit('d', 'not_started', 'Admin'),
        unit('e', 'failed'),
      ]),
    );

    expect(strip).toEqual({
      current: 'Writing Billing',
      done: 2,
      writing: 1,
      remaining: 1,
      total: 5,
      skipped: '2 units finished in a previous session',
    });
  });

  it('falls back to the next not_started unit when nothing is writing', () => {
    const strip = summarizeSiteMapProgress(
      file([unit('a', 'done', 'Billing'), unit('b', 'not_started', 'Admin')]),
    );
    expect(strip?.current).toBe('Up next: Admin');
    // One done unit uses the singular skipped wording.
    expect(strip?.skipped).toBe('1 unit finished in a previous session');
  });

  it('says all units are mapped and shows no skipped line before anything is done', () => {
    const allDone = summarizeSiteMapProgress(file([unit('a', 'done'), unit('b', 'done')]));
    expect(allDone?.current).toBe('All units mapped');

    const nothingDone = summarizeSiteMapProgress(file([unit('a', 'not_started', 'First')]));
    expect(nothingDone?.current).toBe('Up next: First');
    expect(nothingDone?.skipped).toBeNull();
  });

  it('renders nothing (null) for a null file or a file with no units', () => {
    expect(summarizeSiteMapProgress(null)).toBeNull();
    expect(summarizeSiteMapProgress(file([]))).toBeNull();
  });
});
