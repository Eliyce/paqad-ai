import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { renderDefaultFeatureDevelopmentPolicyYaml } from '@/pipeline/feature-development-policy.js';

// Issue #368, AC-A3 / AC-D1 — the feature-development contract must never claim script
// enforcement it does not have. checks.block_on_failure is genuinely script-enforced;
// review_findings / stale_docs are agent-raised and Decision-Pause-enforced (no script
// detects them). This guard fails if the honest enforcement-tier documentation is
// dropped from either the shipped source-of-truth or this repo's live contract.
const ROOT = resolve(__dirname, '../../..');
const PROJECT_YAML = resolve(ROOT, 'docs/instructions/workflows/feature-development.yaml');

function assertHonestTiers(yaml: string): void {
  expect(yaml).toContain('Enforcement tiers');
  expect(yaml).toContain('SCRIPT-ENFORCED');
  expect(yaml).toContain('AGENT-RAISED');
  expect(yaml).toContain('DECISION-PAUSE-ENFORCED');
}

describe('feature-development enforcement-tier honesty (#368, AC-A3)', () => {
  it('the shipped render source documents the enforcement tiers', () => {
    assertHonestTiers(renderDefaultFeatureDevelopmentPolicyYaml());
  });

  it("this repo's live workflow contract documents the enforcement tiers", () => {
    assertHonestTiers(readFileSync(PROJECT_YAML, 'utf8'));
  });

  it('the live contract annotates review_findings and stale_docs as agent-raised, not script-detected', () => {
    const yaml = readFileSync(PROJECT_YAML, 'utf8');
    // Both agent-raised escalations carry the honest annotation near their declaration.
    expect(yaml).toMatch(/AGENT-RAISED -> DECISION-PAUSE-ENFORCED[\s\S]*review_findings: stop/);
    expect(yaml).toMatch(/AGENT-RAISED -> DECISION-PAUSE-ENFORCED[\s\S]*stale_docs: stop/);
    // checks.block_on_failure is the deterministic one.
    expect(yaml).toMatch(/SCRIPT-ENFORCED[\s\S]*block_on_failure: true/);
  });
});
