import { describe, expect, it } from 'vitest';

import { SchemaValidator } from '@/validators';

describe('context-hit-log schema', () => {
  const validator = new SchemaValidator();

  it('passes with valid context hit entry', () => {
    const valid = {
      session_id: 'sess-001',
      phase: 'implementation',
      story: '03-add-validation',
      files_loaded: 12,
      files_referenced: 8,
      hit_rate: 0.67,
      unreferenced_files: ['src/Models/User.php'],
      timestamp: '2026-03-16T14:30:00Z',
    };
    const result = validator.validate('context-hit-log', valid);
    expect(result.valid).toBe(true);
  });

  it('fails when hit_rate exceeds 1.0', () => {
    const invalid = {
      session_id: 'sess-001',
      phase: 'implementation',
      files_loaded: 10,
      files_referenced: 12,
      hit_rate: 1.2,
      unreferenced_files: [],
      timestamp: '2026-03-16T14:30:00Z',
    };
    const result = validator.validate('context-hit-log', invalid);
    expect(result.valid).toBe(false);
  });

  it('fails when required fields missing', () => {
    const result = validator.validate('context-hit-log', {});
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
