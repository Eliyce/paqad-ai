import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DeliveryPolicyValidationError,
  getDeliveryPolicyConfig,
  putDeliveryPolicy,
} from '@/dashboard/config-delivery-policy.js';
import { contentHash, WriteConflictError } from '@/dashboard/write-pipeline.js';

const POLICY_PATH = 'docs/instructions/workflows/delivery-policy.yaml';

const VALID_POLICY = [
  'schema_version: "1"',
  'merge_mode: append',
  'enabled: true',
  'process:',
  '  branch:',
  '    maintained: manual',
  '    base: develop',
  '',
].join('\n');

function write(root: string, relative: string, content: string): void {
  const full = join(root, relative);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

describe('delivery policy config endpoint logic', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-config-dp-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  describe('getDeliveryPolicyConfig', () => {
    it('returns defaults, schema, and a missing file on a bare project', () => {
      const config = getDeliveryPolicyConfig(root);
      expect(config.resolved.enabled).toBe(true);
      expect(config.resolved.process.branch.base).toBe('main');
      expect(config.file.exists).toBe(false);
      expect(config.file.hash).toBeNull();
      expect(config.defaultsYaml).toContain('schema_version: "1"');
      expect(config.schema).toMatchObject({ $id: 'delivery-policy' });
      expect(config.warnings).toEqual([]);
    });

    it('returns the raw file and the resolved merge when the policy exists', () => {
      write(root, POLICY_PATH, VALID_POLICY);
      const config = getDeliveryPolicyConfig(root);
      expect(config.file.exists).toBe(true);
      expect(config.file.content).toBe(VALID_POLICY);
      expect(config.file.hash).toBe(contentHash(VALID_POLICY));
      expect(config.resolved.process.branch.base).toBe('develop');
      // merge keeps framework defaults for untouched sections
      expect(config.resolved.process.pr.base).toBe('main');
    });

    it('surfaces loader warnings for an invalid on-disk policy', () => {
      write(root, POLICY_PATH, 'schema_version: "2"\n');
      const config = getDeliveryPolicyConfig(root);
      expect(config.warnings.length).toBeGreaterThan(0);
      expect(config.resolved.process.branch.base).toBe('main');
    });
  });

  describe('putDeliveryPolicy', () => {
    it('validates, writes, audits, and returns the new resolved policy', () => {
      const result = putDeliveryPolicy(root, { content: VALID_POLICY, baseHash: null });

      expect(result.hash).toBe(contentHash(VALID_POLICY));
      expect(result.resolved.process.branch.base).toBe('develop');
      expect(readFileSync(join(root, POLICY_PATH), 'utf8')).toBe(VALID_POLICY);
      const audit = readFileSync(join(root, '.paqad/audit.log'), 'utf8');
      expect(audit).toContain('dashboard.config.delivery-policy.write');
      expect(audit).toContain('actor="dashboard"');
    });

    it('rejects YAML that does not parse, with a root-level issue', () => {
      expect(() => putDeliveryPolicy(root, { content: '[unbalanced', baseHash: null })).toThrow(
        DeliveryPolicyValidationError,
      );
      try {
        putDeliveryPolicy(root, { content: '[unbalanced', baseHash: null });
      } catch (err) {
        expect((err as DeliveryPolicyValidationError).issues[0]?.path).toBe('/');
      }
    });

    it('rejects non-mapping YAML', () => {
      expect(() => putDeliveryPolicy(root, { content: '- a\n- b\n', baseHash: null })).toThrow(
        /YAML mapping/,
      );
    });

    it('rejects schema violations with field-level issues and writes nothing', () => {
      const invalid = 'schema_version: "1"\nprocess:\n  ci:\n    gate: yolo\n';
      let error: DeliveryPolicyValidationError | null = null;
      try {
        putDeliveryPolicy(root, { content: invalid, baseHash: null });
      } catch (err) {
        error = err as DeliveryPolicyValidationError;
      }
      expect(error).toBeInstanceOf(DeliveryPolicyValidationError);
      expect(error?.issues.some((issue) => issue.path.includes('gate'))).toBe(true);
      expect(() => readFileSync(join(root, POLICY_PATH), 'utf8')).toThrow();
    });

    it('propagates a write conflict when the file changed underneath', () => {
      write(root, POLICY_PATH, VALID_POLICY);
      expect(() =>
        putDeliveryPolicy(root, {
          content: VALID_POLICY.replace('develop', 'trunk'),
          baseHash: contentHash('something stale'),
        }),
      ).toThrow(WriteConflictError);
    });

    it('accepts an update that echoes the current hash', () => {
      write(root, POLICY_PATH, VALID_POLICY);
      const updated = VALID_POLICY.replace('develop', 'trunk');
      const result = putDeliveryPolicy(root, {
        content: updated,
        baseHash: contentHash(VALID_POLICY),
      });
      expect(result.resolved.process.branch.base).toBe('trunk');
    });
  });
});
