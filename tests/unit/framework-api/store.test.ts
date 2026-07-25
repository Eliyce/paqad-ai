import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { validateFrameworkApiIndex } from '@/framework-api/schema.js';
import {
  frameworkApiIndexPath,
  readFrameworkApiIndex,
  writeFrameworkApiIndex,
} from '@/framework-api/store.js';
import { FRAMEWORK_API_SCHEMA_VERSION, type FrameworkApiIndex } from '@/framework-api/types.js';

let root: string;

function sampleIndex(): FrameworkApiIndex {
  return {
    schema_version: FRAMEWORK_API_SCHEMA_VERSION,
    header: {
      generated_at: '2026-01-01T00:00:00.000Z',
      schema_version: FRAMEWORK_API_SCHEMA_VERSION,
    },
    packages: [
      {
        package: 'react',
        version: '19.2.6',
        ecosystem: 'node',
        root: '.',
        content_hash: 'sha256:abc',
        sources: ['node_modules/@types/react/index.d.ts'],
        symbols: [
          {
            name: 'useId',
            kind: 'function',
            exists: true,
            deprecated: false,
            message: null,
            since: null,
            for_removal: false,
            provenance: 'asserted',
          },
        ],
      },
    ],
    blocked: [],
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-framework-api-store-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('framework-api store', () => {
  it('writes to the canonical path and reads back what it wrote', () => {
    const index = sampleIndex();
    const written = writeFrameworkApiIndex(root, index);
    expect(written).toBe(frameworkApiIndexPath(root));
    expect(readFrameworkApiIndex(root)).toEqual(index);
  });

  it('leaves no temp file behind after an atomic write', () => {
    writeFrameworkApiIndex(root, sampleIndex());
    expect(() => readFileSync(`${frameworkApiIndexPath(root)}.tmp`, 'utf8')).toThrow();
  });

  it('reads a missing index as absent rather than throwing (INV-3)', () => {
    expect(readFrameworkApiIndex(root)).toBeNull();
  });

  it('reads a corrupt index as absent', () => {
    const target = frameworkApiIndexPath(root);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, '{ not json');
    expect(readFrameworkApiIndex(root)).toBeNull();
  });

  it('reads a schema-invalid index as absent, so a bad shape is never trusted (INV-4)', () => {
    const target = frameworkApiIndexPath(root);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, JSON.stringify({ schema_version: 1, packages: 'not-an-array' }));
    expect(readFrameworkApiIndex(root)).toBeNull();
  });
});

describe('validateFrameworkApiIndex', () => {
  it('accepts a well-formed index', () => {
    expect(validateFrameworkApiIndex(sampleIndex())).toEqual({ valid: true, errors: [] });
  });

  it('rejects a symbol missing a required field, naming the path', () => {
    const index = sampleIndex();
    // @ts-expect-error deliberately removing a required field
    delete index.packages[0].symbols[0].provenance;
    const result = validateFrameworkApiIndex(index);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain('provenance');
  });

  it('rejects an unknown provenance value', () => {
    const index = sampleIndex();
    // @ts-expect-error deliberately writing an out-of-contract value
    index.packages[0].symbols[0].provenance = 'vibes';
    expect(validateFrameworkApiIndex(index).valid).toBe(false);
  });

  it('rejects an unknown blocked reason', () => {
    const index = sampleIndex();
    // @ts-expect-error deliberately writing an out-of-contract value
    index.blocked.push({ package: 'vue', ecosystem: 'node', reason: 'shrug', detail: '' });
    expect(validateFrameworkApiIndex(index).valid).toBe(false);
  });

  it('reports the root path for an error at the top level', () => {
    const result = validateFrameworkApiIndex('not an object');
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('/');
  });
});
