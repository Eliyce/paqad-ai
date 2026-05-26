import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { collectFrameworkVersion } from '@/dashboard/collectors/framework-version';
import { FRAMEWORK_VERSION } from '@/core/constants/version';

function writeVersion(root: string, body: string): void {
  mkdirSync(join(root, '.paqad'), { recursive: true });
  writeFileSync(join(root, '.paqad/framework-version.txt'), body);
}

const NOW = Date.UTC(2026, 4, 26);

describe('collectFrameworkVersion', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-dash-ver-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns unknown when the file is absent', () => {
    const { section } = collectFrameworkVersion(root, NOW);
    expect(section.band).toBe('unknown');
    expect(section.score).toBeNull();
  });

  it('scores green when installed and recorded versions match and the file is fresh', () => {
    const updatedAt = new Date(NOW - 7 * 86_400_000).toISOString();
    writeVersion(root, `version=${FRAMEWORK_VERSION}\nupdated_at=${updatedAt}\n`);
    const { section, frameworkVersion } = collectFrameworkVersion(root, NOW);
    expect(frameworkVersion).toBe(FRAMEWORK_VERSION);
    expect(section.band).toBe('green');
    expect(section.score).toBe(100);
    expect(section.summary).toMatch(/On v/);
  });

  it('caps the score at 60 when the recorded version drifts from the installed one', () => {
    const updatedAt = new Date(NOW - 1 * 86_400_000).toISOString();
    writeVersion(root, `version=0.0.0-old\nupdated_at=${updatedAt}\n`);
    const { section } = collectFrameworkVersion(root, NOW);
    expect(section.band).toBe('amber');
    expect(section.score).toBeLessThanOrEqual(60);
    expect(section.summary).toMatch(/Drift/);
  });

  it('handles malformed files by treating the version as unrecorded', () => {
    writeVersion(root, 'garbage-without-key-value-pairs');
    const { section, frameworkVersion } = collectFrameworkVersion(root, NOW);
    expect(frameworkVersion).toBeNull();
    expect(section.summary).toMatch(/not recorded/);
  });
});
