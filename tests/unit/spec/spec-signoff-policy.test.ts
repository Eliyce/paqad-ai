import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import YAML from 'yaml';
import { describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import {
  defaultFeatureDevelopmentPolicy,
  loadFeatureDevelopmentPolicy,
} from '@/pipeline/feature-development-policy.js';
import { LANE_PHASES } from '@/pipeline/router.js';

describe('spec sign-off policy (issue #102)', () => {
  it('requires spec sign-off on the specification stage by default', () => {
    const policy = defaultFeatureDevelopmentPolicy();
    expect(policy.stages.specification.strictness.require_spec_signoff).toBe(true);
    expect(policy.stages.specification.escalation.missing_spec_signoff).toBe('stop');
    expect(policy.stages.specification.artifacts).toContain('frozen feature-spec');
  });

  it('cannot be downgraded by a project override (framework-owned strictness)', () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-spec-signoff-'));
    mkdirSync(join(root, PATHS.WORKFLOWS_DIR), { recursive: true });
    writeFileSync(
      join(root, PATHS.WORKFLOWS_DIR, 'feature-development.yaml'),
      YAML.stringify({
        schema_version: '1',
        stages: {
          specification: {
            strictness: { require_spec_signoff: false },
          },
        },
      }),
    );

    const result = loadFeatureDevelopmentPolicy(root);
    expect(result.policy.stages.specification.strictness.require_spec_signoff).toBe(true);
  });

  it('leaves the fast lane free of the specification stage — trivial work needs no spec', () => {
    expect(LANE_PHASES.fast).not.toContain('specification');
    expect(LANE_PHASES.graduated).toContain('specification');
    expect(LANE_PHASES.full).toContain('specification');
  });
});
