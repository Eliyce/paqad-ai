import { mkdtempSync, rmSync, unlinkSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { DocumentationWorkflow } from '@/document/workflow.js';
import { HealthChecker } from '@/health/checker.js';
import { OnboardingOrchestrator } from '@/onboarding/index.js';
import { serializeModuleMap } from '@/onboarding/registry-generator.js';

const cases = [
  ['docs/modules/core/ui/screens.md', 'UI docs present'],
  ['docs/modules/core/api/endpoints.md', 'API docs present'],
  ['docs/modules/core/api/schemas.md', 'API docs present'],
  ['docs/modules/core/api/error-codes.md', 'API docs present'],
  ['docs/modules/core/integration/events.md', 'Integration docs present'],
  ['docs/modules/core/integration/contracts.md', 'Integration docs present'],
  ['docs/modules/core/error-catalog.md', 'Error catalog present'],
] as const;

describe('health check coverage matrix', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-health-matrix-'));
    await new OnboardingOrchestrator().run({
      projectRoot,
      selections: {
        domain: 'coding',
        stack: 'laravel',
        capabilities: [],
      },
    });
    // Stage 1: foundation — writes module-map.yml
    await new DocumentationWorkflow().run({ projectRoot, mode: 'foundation' });
    // Inject a known module map so the health matrix tests can rely on docs/modules/core/**
    mkdirSync(join(projectRoot, PATHS.RULES_DIR), { recursive: true });
    writeFileSync(
      join(projectRoot, PATHS.MODULE_MAP),
      serializeModuleMap({
        version: 1,
        last_updated_at: new Date().toISOString(),
        domain_glossary: { preferred_terms: [], synonyms: {}, notes: '' },
        modules: [
          {
            name: 'Core',
            slug: 'core',
            auto_update_module_name: true,
            derivation: 'inferred',
            confidence: 'high',
            source_paths: [],
            evidence: {},
            features: [],
          },
        ],
      }),
    );
    // Stage 2: module-docs — generates docs/modules/core/**
    await new DocumentationWorkflow().run({ projectRoot, mode: 'module-docs' });
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  for (const [path, check] of cases) {
    it(`fails ${check} when ${path} is missing`, async () => {
      unlinkSync(join(projectRoot, path));

      const report = await new HealthChecker().run(projectRoot);

      expect(report.checks.find((entry) => entry.name === check)?.status).toBe('fail');
    });
  }
});
