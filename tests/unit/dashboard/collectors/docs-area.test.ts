import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { collectDocsArea } from '@/dashboard/collectors/docs-area';
import { collectRules } from '@/dashboard/collectors/rules';

const NOW = Date.UTC(2026, 4, 26);

function touch(path: string, daysOld: number): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, '');
  const t = (NOW - daysOld * 86_400_000) / 1000;
  utimesSync(path, t, t);
}

const HELPER = { what: 'w', goodLooksLike: 'g' };

describe('collectDocsArea', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-dash-area-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns unknown when the directory is missing', () => {
    const section = collectDocsArea(
      root,
      { id: 'rules', title: 'Rules', relPath: 'docs/instructions/rules', helper: HELPER },
      NOW,
    );
    expect(section.band).toBe('unknown');
  });

  it('returns red 0 when the directory exists but is empty', () => {
    mkdirSync(join(root, 'docs/instructions/rules'), { recursive: true });
    const section = collectDocsArea(
      root,
      { id: 'rules', title: 'Rules', relPath: 'docs/instructions/rules', helper: HELPER },
      NOW,
    );
    expect(section.band).toBe('red');
    expect(section.score).toBe(0);
  });

  it('scores green with enough fresh files', () => {
    for (let i = 0; i < 5; i++) {
      touch(join(root, `docs/instructions/rules/r${i}.md`), 1);
    }
    const section = collectDocsArea(
      root,
      {
        id: 'rules',
        title: 'Rules',
        relPath: 'docs/instructions/rules',
        expectedMin: 5,
        helper: HELPER,
      },
      NOW,
    );
    expect(section.score).toBe(100);
    expect(section.band).toBe('green');
  });

  it('penalises stale files', () => {
    for (let i = 0; i < 5; i++) {
      touch(join(root, `docs/instructions/rules/r${i}.md`), 200); // past cliff
    }
    const section = collectDocsArea(
      root,
      {
        id: 'rules',
        title: 'Rules',
        relPath: 'docs/instructions/rules',
        expectedMin: 5,
        helper: HELPER,
      },
      NOW,
    );
    // presence 60 + freshness 0 = 60.
    expect(section.score).toBe(60);
    expect(section.band).toBe('amber');
  });

  it('penalises under-population', () => {
    for (let i = 0; i < 2; i++) {
      touch(join(root, `docs/instructions/rules/r${i}.md`), 1);
    }
    const section = collectDocsArea(
      root,
      {
        id: 'rules',
        title: 'Rules',
        relPath: 'docs/instructions/rules',
        expectedMin: 5,
        helper: HELPER,
      },
      NOW,
    );
    // 2/5 = 0.4 presence → 24 + 40 freshness = 64.
    expect(section.score).toBe(64);
  });
});

describe('collectRules wrapper', () => {
  it('targets docs/instructions/rules', () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-dash-rules-'));
    try {
      const section = collectRules(root, NOW);
      expect(section.id).toBe('rules');
      expect(section.band).toBe('unknown');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
