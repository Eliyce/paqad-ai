import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import {
  defaultDeliveryPolicy,
  deliveryPolicyPath,
  loadDeliveryPolicy,
  mergeDeliveryPolicy,
  renderDefaultDeliveryPolicyYaml,
} from '@/pipeline/delivery-policy.js';
import { SchemaValidator } from '@/validators/validator.js';

function makeRepo(): string {
  return mkdtempSync(join(tmpdir(), 'delivery-policy-'));
}

function writePolicy(root: string, yaml: string): void {
  const dir = join(root, PATHS.WORKFLOWS_DIR);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'delivery-policy.yaml'), yaml, 'utf8');
}

describe('delivery policy loader', () => {
  it('returns framework defaults when no file exists', () => {
    const root = makeRepo();
    try {
      const { policy, warnings } = loadDeliveryPolicy(root);
      expect(warnings).toEqual([]);
      expect(policy.enabled).toBe(true);
      expect(policy.process.branch.template).toBe('{type}/{ticket}-{title_slug}');
      expect(policy.process.ci.gate).toBe('wait_for_green');
      // every section defaults to auto
      for (const section of Object.values(policy.process)) {
        expect(section.maintained).toBe('auto');
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('the shipped default YAML validates and round-trips through the loader', () => {
    const root = makeRepo();
    try {
      writePolicy(root, renderDefaultDeliveryPolicyYaml());
      const { policy, warnings } = loadDeliveryPolicy(root);
      expect(warnings).toEqual([]);
      expect(policy).toEqual(defaultDeliveryPolicy());
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('append-merges: project scalars win, lists/type_map append, manual flag preserved', () => {
    const root = makeRepo();
    try {
      writePolicy(
        root,
        [
          'schema_version: "1"',
          'merge_mode: append',
          'enabled: true',
          'process:',
          '  branch:',
          '    maintained: manual',
          '    base: develop',
          '    type_map: { Spike: chore }',
          '  pr:',
          '    reviewers: [alice]',
          '  ci:',
          '    gate: warn_only',
        ].join('\n'),
      );
      const { policy, warnings } = loadDeliveryPolicy(root);
      expect(warnings).toEqual([]);
      // scalar override wins
      expect(policy.process.branch.base).toBe('develop');
      expect(policy.process.branch.maintained).toBe('manual');
      expect(policy.process.ci.gate).toBe('warn_only');
      // type_map merges (default keys + new key)
      expect(policy.process.branch.type_map).toMatchObject({
        Story: 'feat',
        Spike: 'chore',
      });
      // list appends
      expect(policy.process.pr.reviewers).toEqual(['alice']);
      // untouched section keeps its default
      expect(policy.process.commit.template).toContain('{type}({scope})');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('falls back to defaults with a warning on an invalid (unknown-key) file', () => {
    const root = makeRepo();
    try {
      writePolicy(root, 'schema_version: "1"\nprocess:\n  branch:\n    bogus_key: 1\n');
      const { policy, warnings } = loadDeliveryPolicy(root);
      expect(policy).toEqual(defaultDeliveryPolicy());
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0]).toContain('invalid');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('mergeDeliveryPolicy is pure — it does not mutate the defaults', () => {
    const defaults = defaultDeliveryPolicy();
    const before = JSON.stringify(defaults);
    mergeDeliveryPolicy(defaults, { process: { pr: { reviewers: ['x'] } } });
    expect(JSON.stringify(defaults)).toBe(before);
  });

  it('the schema is registered with the validator', () => {
    const validator = new SchemaValidator();
    const result = validator.validate('delivery-policy', {
      schema_version: '1',
      enabled: true,
      process: { ci: { gate: 'off' } },
    });
    expect(result.valid).toBe(true);
  });

  it('exposes the policy path under the workflows dir', () => {
    expect(deliveryPolicyPath('/repo')).toContain(PATHS.WORKFLOWS_DIR);
    expect(deliveryPolicyPath('/repo').endsWith('delivery-policy.yaml')).toBe(true);
  });
});
