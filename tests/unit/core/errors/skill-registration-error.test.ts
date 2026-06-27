import { describe, expect, it } from 'vitest';

import { SchemaVersionError } from '@/core/errors/schema-version-error.js';
import {
  SkillRegistrationError,
  type SkillRegistrationErrorKind,
} from '@/core/errors/skill-registration-error.js';

describe('SkillRegistrationError', () => {
  const cases: Array<[SkillRegistrationErrorKind, string]> = [
    ['malformed', 'SKILL_MALFORMED'],
    ['duplicate', 'SKILL_DUPLICATE'],
    ['not-found', 'SKILL_NOT_FOUND'],
    ['built-in-protected', 'SKILL_BUILTIN_PROTECTED'],
  ];

  it.each(cases)('maps kind %s to code %s', (kind, code) => {
    const error = new SkillRegistrationError(`skill ${kind}`, { kind });
    expect(error).toBeInstanceOf(SkillRegistrationError);
    expect(error.name).toBe('SkillRegistrationError');
    expect(error.kind).toBe(kind);
    expect(error.code).toBe(code);
    expect(error.details).toMatchObject({ kind });
  });

  it('carries both colliding identifiers and a cause for a duplicate', () => {
    const cause = new Error('underlying');
    const error = new SkillRegistrationError('collision', {
      kind: 'duplicate',
      builtInId: 'builtin:x',
      runtimeId: 'runtime:x',
      cause,
    });
    expect(error.builtInId).toBe('builtin:x');
    expect(error.runtimeId).toBe('runtime:x');
    expect(error.cause).toBe(cause);
    expect(error.details).toMatchObject({ builtInId: 'builtin:x', runtimeId: 'runtime:x' });
  });

  it('leaves the identifiers undefined when not supplied', () => {
    const error = new SkillRegistrationError('missing', { kind: 'not-found' });
    expect(error.builtInId).toBeUndefined();
    expect(error.runtimeId).toBeUndefined();
  });
});

describe('SchemaVersionError', () => {
  it('defaults the code to SCHEMA_VERSION_INCOMPATIBLE', () => {
    const error = new SchemaVersionError('stamped by a newer engine');
    expect(error).toBeInstanceOf(SchemaVersionError);
    expect(error.name).toBe('SchemaVersionError');
    expect(error.code).toBe('SCHEMA_VERSION_INCOMPATIBLE');
  });

  it('honours an explicit code, cause, and details', () => {
    const cause = new Error('lock held');
    const error = new SchemaVersionError('migration lock unavailable', {
      code: 'SCHEMA_MIGRATION_LOCKED',
      cause,
      details: { lock: '.paqad/.lock' },
    });
    expect(error.code).toBe('SCHEMA_MIGRATION_LOCKED');
    expect(error.cause).toBe(cause);
    expect(error.details).toMatchObject({ lock: '.paqad/.lock' });
  });
});
