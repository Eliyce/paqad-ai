import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { RequestClassifier } from '@/pipeline/classifier.js';

describe('classification pipeline', () => {
  it('produces an enhanced classification result end to end', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-classify-e2e-'));
    mkdirSync(join(root, 'src/components'), { recursive: true });
    writeFileSync(join(root, 'src/components/Button.tsx'), 'export const Button = () => null;\n');
    mkdirSync(join(root, '.paqad/module-health/src/components'), { recursive: true });
    writeFileSync(
      join(root, '.paqad/module-health/src/components/Button.json'),
      JSON.stringify({
        module: 'src/components/Button',
        tier: 'stable',
        metrics: { coverage_pct: 90, defect_frequency: 1, contract_stability: 0.9 },
        updated_at: new Date().toISOString(),
      }),
    );

    const result = await new RequestClassifier({ projectRoot: root }).classify({
      request: 'Rename src/components/Button.tsx with a one-line cleanup',
      profile: {
        active_capabilities: ['content', 'coding', 'security'],
        stack_profile: {
          frameworks: ['react'],
          traits: [],
          toolchains: [],
          version_bands: [],
          sources: [],
        },
      },
      resolved_workflow: {
        workflow: 'cleanup',
        workflow_source: 'routing-skill',
      },
    });

    expect(result.classification_confidence).toBeGreaterThan(0);
    expect(result.resolution_map).toBeDefined();
    expect(result.context_budget_hint).toBeDefined();
    expect(result.affected_modules_source).toBeDefined();
    expect(result.lane_before_override).toBe('fast');
  });
});
