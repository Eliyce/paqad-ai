import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FrameworkError } from '@/core/errors/framework-error.js';
import {
  DecisionPacketCorruptError,
  DuplicateSkillIdentifierError,
  LoggerSinkFailedError,
  ManifestProductionTimeoutError,
  MissingPolicyContextError,
  UnknownEngineError,
  UnsupportedFileTypeError,
  VectorIndexStorageError,
  VersionIncompatibleError,
  WorkflowAlreadyRunningError,
  isEngineErrorCode,
  toEngineError,
} from '@/core/errors/engine-errors.js';
import * as loggerRegistry from '@/core/logger-registry.js';

describe('typed engine errors', () => {
  it('each subclass fixes its code, retryable default, details, and is a FrameworkError/Error', () => {
    const cases = [
      {
        err: new MissingPolicyContextError('no policy', { policy: 'workflow-allowlist' }),
        code: 'MISSING_POLICY_CONTEXT',
        retryable: false,
      },
      {
        err: new DuplicateSkillIdentifierError('dup', { skill_id: 'lint' }),
        code: 'DUPLICATE_SKILL_IDENTIFIER',
        retryable: false,
      },
      {
        err: new DecisionPacketCorruptError('corrupt', {
          decision_id: 'abc',
          reason: 'parse failed',
        }),
        code: 'DECISION_PACKET_CORRUPT',
        retryable: false,
      },
      {
        err: new UnsupportedFileTypeError('bad', { path: 'a.xyz', extension: '.xyz' }),
        code: 'UNSUPPORTED_FILE_TYPE',
        retryable: false,
      },
      {
        err: new VersionIncompatibleError('ver', {
          found: '2.0.0',
          required: '1.0.0',
          kind: 'engine-too-new',
        }),
        code: 'VERSION_INCOMPATIBLE',
        retryable: false,
      },
      {
        err: new ManifestProductionTimeoutError('slow', { timeout_ms: 5000 }),
        code: 'MANIFEST_PRODUCTION_TIMEOUT',
        retryable: true,
      },
      {
        err: new WorkflowAlreadyRunningError('busy', { workflow: 'plan' }),
        code: 'WORKFLOW_ALREADY_RUNNING',
        retryable: false,
      },
      {
        err: new VectorIndexStorageError('disk', { index: 'vision', reason: 'ENOSPC' }),
        code: 'VECTOR_INDEX_STORAGE_ERROR',
        retryable: true,
      },
      {
        err: new LoggerSinkFailedError('sink', { sink: 'stderr', reason: 'EPIPE' }),
        code: 'LOGGER_SINK_FAILED',
        retryable: true,
      },
      {
        err: new UnknownEngineError('mystery'),
        code: 'UNKNOWN_ENGINE_ERROR',
        retryable: false,
      },
    ] as const;

    for (const { err, code, retryable } of cases) {
      expect(err).toBeInstanceOf(FrameworkError);
      expect(err).toBeInstanceOf(Error);
      expect(err.code).toBe(code);
      expect(err.retryable).toBe(retryable);
    }
  });

  it('preserves typed payload fields on details', () => {
    const err = new DecisionPacketCorruptError('corrupt', {
      decision_id: 'abc',
      reason: 'parse failed',
    });
    expect(err.details?.decision_id).toBe('abc');
    expect(err.details?.reason).toBe('parse failed');
    // No secrets configured ⇒ no redaction marker.
    expect(err.details?.redacted_fields).toBeUndefined();
  });

  describe('credential redaction', () => {
    let root: string;

    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), 'engine-err-redact-'));
      mkdirSync(join(root, '.paqad'), { recursive: true });
      writeFileSync(join(root, '.paqad', 'secrets.env'), 'API_KEY=super-secret-value\n', 'utf8');
    });

    afterEach(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it('redacts secret-bearing string fields and records redacted_fields', () => {
      const err = new VectorIndexStorageError(
        'write failed',
        { index: 'file', reason: 'auth super-secret-value rejected' },
        root,
      );
      expect(err.details?.reason).toBe('auth [REDACTED] rejected');
      expect(err.details?.redacted_fields).toEqual(['reason']);
    });

    it('passes non-string payload fields through redaction untouched', () => {
      const err = new ManifestProductionTimeoutError('slow', { timeout_ms: 5000 }, root);
      expect(err.details?.timeout_ms).toBe(5000);
      expect(err.details?.redacted_fields).toBeUndefined();
    });

    it('leaves clean fields untouched and adds no marker when nothing was redacted', () => {
      const err = new MissingPolicyContextError(
        'no policy',
        { policy: 'workflow-allowlist' },
        root,
      );
      expect(err.details?.policy).toBe('workflow-allowlist');
      expect(err.details?.redacted_fields).toBeUndefined();
    });
  });

  describe('toEngineError', () => {
    it('passes through a framework error whose code is in the taxonomy', () => {
      const original = new DecisionPacketCorruptError('corrupt', {
        decision_id: 'x',
        reason: 'bad',
      });
      expect(toEngineError(original)).toBe(original);
    });

    it('wraps a plain Error in UnknownEngineError without crashing', () => {
      const wrapped = toEngineError(new Error('boom'));
      expect(wrapped).toBeInstanceOf(UnknownEngineError);
      expect(wrapped.code).toBe('UNKNOWN_ENGINE_ERROR');
      expect(wrapped.message).toBe('boom');
    });

    it('wraps a framework error with an off-taxonomy code and logs the missing entry', () => {
      const spy = vi.spyOn(loggerRegistry, 'engineLog').mockImplementation(() => {});
      const offTaxonomy = new FrameworkError('legacy', { code: 'LEGACY_THING' });
      const wrapped = toEngineError(offTaxonomy);
      expect(wrapped).toBeInstanceOf(UnknownEngineError);
      expect(wrapped.code).toBe('UNKNOWN_ENGINE_ERROR');
      expect(spy).toHaveBeenCalledWith(
        'error',
        expect.stringContaining('taxonomy'),
        expect.objectContaining({ missing_code: 'LEGACY_THING' }),
      );
      spy.mockRestore();
    });

    it('wraps a non-Error thrown value', () => {
      const wrapped = toEngineError('just a string');
      expect(wrapped).toBeInstanceOf(UnknownEngineError);
      expect(wrapped.message).toBe('just a string');
    });
  });

  it('isEngineErrorCode narrows known codes only', () => {
    expect(isEngineErrorCode('CANCELLED_BY_CONSUMER')).toBe(true);
    expect(isEngineErrorCode('NOPE')).toBe(false);
  });
});
