import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import YAML from 'yaml';

import { collectRagStatus } from '@/dashboard/collectors/rag-status';

const NOW = Date.UTC(2026, 4, 26);

function writeProfile(root: string, body: unknown): void {
  mkdirSync(join(root, '.paqad'), { recursive: true });
  writeFileSync(join(root, '.paqad/project-profile.yaml'), YAML.stringify(body));
}

function writeIndex(root: string, daysOld: number): void {
  mkdirSync(join(root, '.paqad/vectors'), { recursive: true });
  const path = join(root, '.paqad/vectors/meta.json');
  writeFileSync(path, '{}');
  const mtime = (NOW - daysOld * 86_400_000) / 1000;
  utimesSync(path, mtime, mtime);
}

describe('collectRagStatus', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-dash-rag-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns unknown when there is no project profile', () => {
    const section = collectRagStatus(root, NOW);
    expect(section.band).toBe('unknown');
  });

  it('returns unknown when RAG is explicitly disabled', () => {
    writeProfile(root, { intelligence: { rag_enabled: false } });
    const section = collectRagStatus(root, NOW);
    expect(section.band).toBe('unknown');
    expect(section.summary).toMatch(/disabled/);
  });

  it('flags missing index when enabled but no vectors exist', () => {
    writeProfile(root, { intelligence: { rag_enabled: true, embedding_provider: 'local' } });
    const section = collectRagStatus(root, NOW);
    expect(section.summary).toMatch(/no index/i);
    // Provider configured (30) + no index, no freshness → 30.
    expect(section.score).toBe(30);
    expect(section.band).toBe('red');
  });

  it('scores green when enabled, provider set, and index is fresh', () => {
    writeProfile(root, { intelligence: { rag_enabled: true, embedding_provider: 'local' } });
    writeIndex(root, 2);
    const section = collectRagStatus(root, NOW);
    expect(section.band).toBe('green');
    expect(section.score).toBe(100);
    expect(section.summary).toMatch(/local/);
  });

  it('decays as the index ages', () => {
    writeProfile(root, { intelligence: { rag_enabled: true, embedding_provider: 'openai' } });
    writeIndex(root, 200); // past the stale cliff
    const section = collectRagStatus(root, NOW);
    expect(section.score).toBe(60); // provider 30 + index present 30 + freshness 0
    expect(section.band).toBe('amber');
  });
});
