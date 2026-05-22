import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import YAML from 'yaml';

import { PATHS } from '@/core/constants/paths.js';
import { defaultFeatureDevelopmentPolicy } from '@/pipeline/feature-development-policy.js';
import { VerificationPhase } from '@/pipeline/phases/verification.js';
import { VERIFICATION_EVIDENCE_SCHEMA_VERSION } from '@/core/types/verification-evidence.js';
import { VERIFICATION_EVIDENCE_RELATIVE_PATH } from '@/verification/evidence.js';

import { fixtureClassification } from './shared.fixture.js';

function createPhaseContext(projectRoot: string) {
  return {
    project_root: projectRoot,
    lane: 'standard' as const,
    classification: fixtureClassification({
      stack: 'node-cli',
      affected_modules: ['billing'],
    }),
    started_at: new Date().toISOString(),
    phases: [],
    feature_policy: defaultFeatureDevelopmentPolicy(),
    policy_warnings: [],
  };
}

describe('VerificationPhase', () => {
  it('executes test commands and injects structured test results into verification context', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'paqad-verification-phase-'));
    mkdirSync(join(projectRoot, '.paqad'), { recursive: true });
    writeFileSync(join(projectRoot, 'package.json'), JSON.stringify({ name: 'demo' }));
    writeFileSync(
      join(projectRoot, PATHS.PROJECT_PROFILE),
      YAML.stringify({
        project: { name: 'Demo', id: 'demo', description: 'Demo' },
        active_capabilities: ['content', 'coding', 'security'],
        stack_profile: {
          frameworks: ['node-cli'],
          traits: [],
          toolchains: [],
          version_bands: [],
          sources: [],
        },
        commands: {
          install: 'node -e "process.exit(0)"',
          dev: 'node -e "process.exit(0)"',
          test: `node -e "console.log('TAP version 13\\n1..1\\nok 1 - passes')"`,
          test_single: 'node -e "process.exit(0)"',
          lint: 'node -e "process.exit(0)"',
          format: 'node -e "process.exit(0)"',
          migrate: 'node -e "process.exit(0)"',
          build: 'node -e "process.exit(0)"',
        },
      }),
    );

    const result = await new VerificationPhase().execute(createPhaseContext(projectRoot));

    expect(result.status).toBe('pass');
    expect(result.summary).toContain(
      'commands: node -e "process.exit(0)"; node -e "console.log(\'TAP version 13',
    );

    const phaseContext = createPhaseContext(projectRoot);
    await new VerificationPhase().execute(phaseContext);
    expect(phaseContext.verification_context?.structured_test_results).toHaveLength(1);
    expect(
      phaseContext.verification_context?.structured_test_results?.[0]?.parse_metadata
        .parse_strategy,
    ).toBe('structured');
    expect(phaseContext.verification_context?.structured_test_results?.[0]?.summary.passed).toBe(1);
    expect(phaseContext.verification_context?.structured_test_results?.[0]?.evidence_scope).toBe(
      undefined,
    );

    const evidencePath = join(projectRoot, VERIFICATION_EVIDENCE_RELATIVE_PATH);
    expect(existsSync(evidencePath)).toBe(true);
    const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
    expect(evidence.schema_version).toBe(VERIFICATION_EVIDENCE_SCHEMA_VERSION);
    expect(evidence.run_id).toMatch(/^verification-/);
    expect(Array.isArray(evidence.gates)).toBe(true);
    expect(evidence.gates.length).toBeGreaterThan(0);
    expect(['pass', 'fail', 'error']).toContain(evidence.overall_status);
  });
});
