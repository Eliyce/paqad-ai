import { describe, expect, it } from 'vitest';

import { ENGINE_ERROR_CODES, getTaxonomyEntry, listErrorTaxonomy } from '@/core/errors/taxonomy.js';

describe('error taxonomy', () => {
  it('returns exactly one entry per EngineErrorCode', () => {
    const entries = listErrorTaxonomy();
    const codes = entries.map((e) => e.code).sort();
    const expected = Object.values(ENGINE_ERROR_CODES).sort();
    expect(codes).toEqual(expected);
    // No duplicates.
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('gives every entry a non-empty description, a boolean retryable, and a payload shape', () => {
    for (const entry of listErrorTaxonomy()) {
      expect(entry.description.length).toBeGreaterThan(0);
      expect(typeof entry.retryable).toBe('boolean');
      expect(Object.keys(entry.payload_shape).length).toBeGreaterThan(0);
      for (const typeDesc of Object.values(entry.payload_shape)) {
        expect(typeof typeDesc).toBe('string');
        expect(typeDesc.length).toBeGreaterThan(0);
      }
    }
  });

  it('marks only the transient codes as retryable', () => {
    const retryable = listErrorTaxonomy()
      .filter((e) => e.retryable)
      .map((e) => e.code)
      .sort();
    expect(retryable).toEqual(
      ['LOGGER_SINK_FAILED', 'MANIFEST_PRODUCTION_TIMEOUT', 'VECTOR_INDEX_STORAGE_ERROR'].sort(),
    );
  });

  it('is stable (identical) across repeated calls', () => {
    expect(listErrorTaxonomy()).toEqual(listErrorTaxonomy());
  });

  it('looks up a known entry and returns undefined for an unknown code', () => {
    expect(getTaxonomyEntry('DECISION_PACKET_CORRUPT')?.code).toBe('DECISION_PACKET_CORRUPT');
    expect(getTaxonomyEntry('NOT_A_REAL_CODE')).toBeUndefined();
  });
});
