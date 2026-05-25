import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import {
  writeFrameworkVersionPreservingTimestamp,
  writeJsonPreservingTimestamp,
} from '@/onboarding/manifest-writer.js';

describe('writeJsonPreservingTimestamp', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'paqad-mw-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes fresh content when the file does not exist', () => {
    const path = join(dir, 'a.json');
    writeJsonPreservingTimestamp(path, { name: 'x', timestamp: '2025-01-01T00:00:00.000Z' }, 'timestamp');
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
      name: 'x',
      timestamp: '2025-01-01T00:00:00.000Z',
    });
  });

  it('preserves the existing timestamp when other fields are unchanged', () => {
    const path = join(dir, 'a.json');
    writeJsonPreservingTimestamp(path, { name: 'x', timestamp: '2025-01-01T00:00:00.000Z' }, 'timestamp');
    writeJsonPreservingTimestamp(path, { name: 'x', timestamp: '2030-12-31T00:00:00.000Z' }, 'timestamp');
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
      name: 'x',
      timestamp: '2025-01-01T00:00:00.000Z',
    });
  });

  it('writes a fresh timestamp when any other field changes', () => {
    const path = join(dir, 'a.json');
    writeJsonPreservingTimestamp(path, { name: 'x', timestamp: '2025-01-01T00:00:00.000Z' }, 'timestamp');
    writeJsonPreservingTimestamp(path, { name: 'y', timestamp: '2030-12-31T00:00:00.000Z' }, 'timestamp');
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
      name: 'y',
      timestamp: '2030-12-31T00:00:00.000Z',
    });
  });

  it('writes a fresh timestamp when existing content is unparseable', () => {
    const path = join(dir, 'a.json');
    writeFileSync(path, 'not json');
    writeJsonPreservingTimestamp(path, { name: 'x', timestamp: '2030-12-31T00:00:00.000Z' }, 'timestamp');
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
      name: 'x',
      timestamp: '2030-12-31T00:00:00.000Z',
    });
  });
});

describe('writeFrameworkVersionPreservingTimestamp', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'paqad-mw-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes fresh content when the file does not exist', () => {
    const path = join(dir, 'framework-version.txt');
    writeFrameworkVersionPreservingTimestamp(path, '1.0.0', '2025-01-01T00:00:00.000Z');
    expect(readFileSync(path, 'utf8')).toBe('version=1.0.0\nupdated_at=2025-01-01T00:00:00.000Z\n');
  });

  it('preserves updated_at on identical version', () => {
    const path = join(dir, 'framework-version.txt');
    writeFrameworkVersionPreservingTimestamp(path, '1.0.0', '2025-01-01T00:00:00.000Z');
    writeFrameworkVersionPreservingTimestamp(path, '1.0.0', '2030-12-31T00:00:00.000Z');
    expect(readFileSync(path, 'utf8')).toBe('version=1.0.0\nupdated_at=2025-01-01T00:00:00.000Z\n');
  });

  it('refreshes updated_at when version changes', () => {
    const path = join(dir, 'framework-version.txt');
    writeFrameworkVersionPreservingTimestamp(path, '1.0.0', '2025-01-01T00:00:00.000Z');
    writeFrameworkVersionPreservingTimestamp(path, '1.0.1', '2030-12-31T00:00:00.000Z');
    expect(readFileSync(path, 'utf8')).toBe('version=1.0.1\nupdated_at=2030-12-31T00:00:00.000Z\n');
  });
});
