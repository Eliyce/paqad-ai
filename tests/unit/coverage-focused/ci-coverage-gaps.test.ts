import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, posix } from 'node:path';

const { join } = posix;

import { afterEach, describe, expect, it, vi } from 'vitest';
import YAML from 'yaml';

import { PATHS } from '@/core/constants/paths.js';
import {
  discoverBusinessModules,
  generateModuleMapYaml,
  loadModuleMap,
  serializeModuleMap,
  writeModuleMap,
} from '@/onboarding/registry-generator.js';
import { InstructionsDocsStructureGate } from '@/verification/gates/instructions-docs-structure.js';
import { fixtureClassification } from '../pipeline/shared.fixture.js';
import { createVerificationContext } from '../verification/shared.fixture.js';

function tempRoot(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function writeFile(root: string, relativePath: string, content = ''): void {
  const target = join(root, ...relativePath.split('/'));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function createPhaseContext(overrides: Record<string, unknown> = {}) {
  return {
    project_root: '/tmp/phase-project',
    lane: 'standard',
    classification: fixtureClassification(),
    started_at: new Date().toISOString(),
    phases: [],
    feature_policy: null,
    policy_warnings: [],
    ...overrides,
  };
}

function moduleMapYaml(overrides: Record<string, unknown> = {}): string {
  return YAML.stringify({
    version: 1,
    last_updated_at: '2026-05-09T00:00:00.000Z',
    domain_glossary: {
      preferred_terms: [],
      synonyms: {},
      notes: '',
    },
    modules: [
      {
        name: 'Billing',
        slug: 'billing',
        auto_update_module_name: true,
        derivation: 'inferred',
        confidence: 'medium',
        source_paths: ['app/Billing'],
        evidence: {},
        features: [],
      },
    ],
    ...overrides,
  });
}

describe('CI coverage gaps', () => {
  afterEach(() => {
    vi.doUnmock('@/document/workflow.js');
    vi.resetModules();
  });

  it('covers module-documentation phase skip, success, orphan, and failure branches', async () => {
    vi.doMock('@/document/workflow.js', () => ({
      DocumentationWorkflow: vi.fn(() => ({
        run: vi
          .fn()
          .mockResolvedValueOnce({
            steps: ['map', 'write'],
            generated: ['docs/modules/billing/index/summary.md'],
            orphaned_module_dirs: [],
          })
          .mockResolvedValueOnce({
            steps: ['map'],
            generated: ['docs/modules/billing/index/summary.md'],
            orphaned_module_dirs: ['docs/modules/old'],
          })
          .mockRejectedValueOnce(new Error('module docs failed'))
          .mockRejectedValueOnce('unknown failure'),
      })),
    }));

    const { ModuleDocumentationPhase } = await import('@/pipeline/phases/module-doc.js');
    const phase = new ModuleDocumentationPhase();

    await expect(phase.execute(createPhaseContext())).resolves.toMatchObject({
      phase: 'module-documentation',
      status: 'pass',
      summary: 'Not a module-documentation request — skipped',
    });
    await expect(
      phase.execute(
        createPhaseContext({
          classification: fixtureClassification({ workflow: 'module-documentation' }),
        }),
      ),
    ).resolves.toMatchObject({
      summary: 'Module documentation generated in 2 step(s)',
      artifacts: ['docs/modules/billing/index/summary.md'],
    });
    await expect(
      phase.execute(
        createPhaseContext({
          classification: fixtureClassification({ workflow: 'module-documentation' }),
        }),
      ),
    ).resolves.toMatchObject({
      summary: 'Module documentation generated. Orphaned dirs not deleted: docs/modules/old',
    });
    await expect(
      phase.execute(
        createPhaseContext({
          classification: fixtureClassification({ workflow: 'module-documentation' }),
        }),
      ),
    ).resolves.toMatchObject({
      status: 'fail',
      summary: 'module docs failed',
    });
    await expect(
      phase.execute(
        createPhaseContext({
          classification: fixtureClassification({ workflow: 'module-documentation' }),
        }),
      ),
    ).resolves.toMatchObject({
      status: 'fail',
      summary: 'Module documentation workflow failed',
    });
  });

  it('covers registry discovery signal, package, locked, and parse fallback branches', async () => {
    const root = tempRoot('paqad-ci-coverage-registry-');
    try {
      writeFile(root, 'app/Http/Controllers/Admin/BillingController.php');
      writeFile(root, 'app/Http/Controllers/___.php');
      writeFile(root, 'app/Services/PaymentsService.php');
      writeFile(root, 'app/Services/Service.php');
      writeFile(root, 'src/services/ShipmentService.ts');
      writeFile(root, 'src/services/Service.ts');
      writeFile(root, 'src/services/FulfillmentService.js');
      writeFile(root, 'src/models/Invoice.ts');
      mkdirSync(join(root, 'pages/Catalog'), { recursive: true });
      mkdirSync(join(root, 'resources/views/Checkout'), { recursive: true });

      const signalModules = await discoverBusinessModules(root);
      expect(signalModules.map((module) => module.slug)).toEqual(
        expect.arrayContaining([
          'billing',
          'payments',
          'shipment',
          'fulfillment',
          'invoice',
          'catalog',
          'checkout',
        ]),
      );

      rmSync(root, { recursive: true, force: true });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }

    const packageRoot = tempRoot('paqad-ci-coverage-packages-');
    try {
      mkdirSync(join(packageRoot, PATHS.RULES_DIR), { recursive: true });
      await writeModuleMap(
        packageRoot,
        serializeModuleMap({
          version: 1,
          last_updated_at: '2026-05-09T00:00:00.000Z',
          domain_glossary: { preferred_terms: [], synonyms: {}, notes: '' },
          modules: [
            {
              name: 'Customer Portal',
              slug: 'portal',
              auto_update_module_name: false,
              derivation: 'user',
              confidence: 'high',
              source_paths: [],
              evidence: {},
              features: [],
            },
          ],
        }),
      );
      mkdirSync(join(packageRoot, 'packages/Payments'), { recursive: true });
      mkdirSync(join(packageRoot, 'packages/src'), { recursive: true });
      mkdirSync(join(packageRoot, 'apps/Portal'), { recursive: true });
      mkdirSync(join(packageRoot, 'services/Payments'), { recursive: true });
      mkdirSync(join(packageRoot, 'services/Inventory'), { recursive: true });
      const modules = await discoverBusinessModules(packageRoot);
      expect(modules.map((module) => module.slug)).toEqual(
        expect.arrayContaining(['payments', 'portal', 'inventory']),
      );
      expect(modules.find((module) => module.slug === 'payments')?.confidence).toBe('medium');
      expect(modules.find((module) => module.slug === 'portal')?.name).toBe('Customer Portal');
    } finally {
      rmSync(packageRoot, { recursive: true, force: true });
    }

    const branchRoot = tempRoot('paqad-ci-coverage-registry-branches-');
    try {
      mkdirSync(join(branchRoot, PATHS.RULES_DIR), { recursive: true });
      await writeModuleMap(
        branchRoot,
        serializeModuleMap({
          version: 1,
          last_updated_at: '2026-05-09T00:00:00.000Z',
          domain_glossary: { preferred_terms: [], synonyms: {}, notes: '' },
          modules: [
            {
              name: 'Billing',
              slug: 'billing',
              auto_update_module_name: true,
              derivation: 'inferred',
              confidence: 'medium',
              source_paths: [],
              evidence: {},
              features: [
                {
                  name: 'Locked Feature',
                  slug: 'locked-feature',
                  auto_update_feature_name: false,
                  derivation: 'user',
                  confidence: 'high',
                  source_paths: [],
                },
              ],
            },
          ],
        }),
      );
      mkdirSync(join(branchRoot, 'app/Modules/Billing'), { recursive: true });
      mkdirSync(join(branchRoot, 'app/Modules/services'), { recursive: true });
      mkdirSync(join(branchRoot, 'src/Billing'), { recursive: true });

      const modules = await discoverBusinessModules(branchRoot, ['', 'Billing', 'Billing']);
      expect(modules.find((module) => module.slug === 'billing')?.features[0]?.slug).toBe(
        'locked-feature',
      );
      expect(modules.some((module) => module.source_paths.includes('app/Modules/Billing'))).toBe(
        true,
      );
    } finally {
      rmSync(branchRoot, { recursive: true, force: true });
    }

    const signalLockedRoot = tempRoot('paqad-ci-coverage-signal-locked-');
    try {
      mkdirSync(join(signalLockedRoot, PATHS.RULES_DIR), { recursive: true });
      await writeModuleMap(
        signalLockedRoot,
        serializeModuleMap({
          version: 1,
          last_updated_at: '2026-05-09T00:00:00.000Z',
          domain_glossary: { preferred_terms: [], synonyms: {}, notes: '' },
          modules: [
            {
              name: 'Revenue',
              slug: 'billing',
              auto_update_module_name: false,
              derivation: 'user',
              confidence: 'high',
              source_paths: [],
              evidence: {},
              features: [],
            },
          ],
        }),
      );
      writeFile(signalLockedRoot, 'app/Http/Controllers/BillingController.php');

      const modules = await discoverBusinessModules(signalLockedRoot);
      expect(modules).toHaveLength(1);
      expect(modules[0]).toMatchObject({ slug: 'billing', name: 'Revenue' });
    } finally {
      rmSync(signalLockedRoot, { recursive: true, force: true });
    }

    const lockedRoot = tempRoot('paqad-ci-coverage-locked-');
    try {
      mkdirSync(join(lockedRoot, PATHS.RULES_DIR), { recursive: true });
      await writeModuleMap(
        lockedRoot,
        serializeModuleMap({
          version: 1,
          last_updated_at: '2026-05-09T00:00:00.000Z',
          domain_glossary: { preferred_terms: [], synonyms: {}, notes: '' },
          modules: [
            {
              name: 'Revenue',
              slug: 'revenue',
              auto_update_module_name: false,
              derivation: 'user',
              confidence: 'high',
              source_paths: [],
              evidence: {},
              features: [
                {
                  name: 'Manual Review',
                  slug: 'manual-review',
                  auto_update_feature_name: false,
                  derivation: 'user',
                  confidence: 'high',
                  source_paths: [],
                },
              ],
            },
            {
              name: 'Inventory',
              slug: 'inventory',
              auto_update_module_name: false,
              derivation: 'user',
              confidence: 'high',
              source_paths: [],
              evidence: {},
              features: [],
            },
            {
              name: 'Billing',
              slug: 'billing',
              auto_update_module_name: false,
              derivation: 'user',
              confidence: 'high',
              source_paths: [],
              evidence: {},
              features: [],
            },
          ],
        }),
      );
      mkdirSync(join(lockedRoot, 'app/Inventory'), { recursive: true });
      writeFile(lockedRoot, 'app/Http/Controllers/BillingController.php');

      const hinted = await discoverBusinessModules(lockedRoot, ['Revenue']);
      expect(hinted.find((module) => module.slug === 'revenue')?.features[0]?.slug).toBe(
        'manual-review',
      );
      expect(hinted.find((module) => module.slug === 'inventory')?.name).toBe('Inventory');
      expect(hinted.find((module) => module.slug === 'billing')?.name).toBe('Billing');
    } finally {
      rmSync(lockedRoot, { recursive: true, force: true });
    }

    const parseRoot = tempRoot('paqad-ci-coverage-parse-');
    try {
      mkdirSync(join(parseRoot, PATHS.RULES_DIR), { recursive: true });
      writeFile(parseRoot, PATHS.MODULE_MAP, 'not-a-map\n');
      await expect(loadModuleMap(parseRoot)).resolves.toBeNull();

      await writeModuleMap(
        parseRoot,
        YAML.stringify({
          last_updated_at: '2026-05-09T00:00:00.000Z',
          domain_glossary: {
            preferred_terms: ['Revenue'],
            synonyms: { Billing: 'Revenue' },
            notes: 'Prefer revenue.',
          },
          version: 1,
          modules: [
            {},
            {
              name: 'Billing',
              slug: 'billing',
              auto_update_module_name: true,
              derivation: 'inferred',
              confidence: 'medium',
              source_paths: [],
              evidence: {
                routes: ['/billing'],
                tables: ['invoices'],
                symbols: ['BillingService'],
              },
              features: [{}],
            },
          ],
        }),
      );
      const parsed = await loadModuleMap(parseRoot);
      expect(parsed?.last_updated_at).toBe('2026-05-09T00:00:00.000Z');
      expect(parsed?.domain_glossary).toEqual({
        preferred_terms: ['Revenue'],
        synonyms: { Billing: 'Revenue' },
        notes: 'Prefer revenue.',
      });
      expect(parsed?.modules[0]).toMatchObject({
        name: '',
        slug: '',
        derivation: 'inferred',
        confidence: 'medium',
        source_paths: [],
      });
      expect(parsed?.modules[0].evidence).toEqual({
        routes: undefined,
        tables: undefined,
        symbols: undefined,
      });
      expect(parsed?.modules[1].evidence).toEqual({
        routes: ['/billing'],
        tables: ['invoices'],
        symbols: ['BillingService'],
      });

      await writeModuleMap(
        parseRoot,
        YAML.stringify({
          version: 1,
          modules: [
            {
              name: 'Fallbacks',
              slug: 'fallbacks',
              auto_update_module_name: true,
              derivation: 'inferred',
              confidence: 'medium',
              source_paths: [],
              evidence: {},
              features: [],
            },
          ],
        }),
      );
      const fallbackParsed = await loadModuleMap(parseRoot);
      expect(fallbackParsed?.last_updated_at).toEqual(expect.any(String));
      expect(fallbackParsed?.domain_glossary).toEqual({
        preferred_terms: [],
        synonyms: {},
        notes: '',
      });

      await writeModuleMap(
        parseRoot,
        YAML.stringify({
          last_updated_at: '2026-05-09T00:00:00.000Z',
          domain_glossary: null,
          modules: {},
        }),
      );
      const nonArrayModulesParsed = await loadModuleMap(parseRoot);
      expect(nonArrayModulesParsed?.version).toBe(1);
      expect(nonArrayModulesParsed?.modules).toEqual([]);

      await writeModuleMap(
        parseRoot,
        YAML.stringify({
          version: 1,
          last_updated_at: '2026-05-09T00:00:00.000Z',
          domain_glossary: {},
          modules: [
            'bad-module',
            {
              name: 'Fallback Features',
              slug: 'fallback-features',
              source_paths: [],
              evidence: {},
              features: ['bad-feature'],
            },
          ],
        }),
      );
      const malformedEntryParsed = await loadModuleMap(parseRoot);
      expect(malformedEntryParsed?.modules[0]).toMatchObject({
        name: '',
        slug: '',
      });
      expect(malformedEntryParsed?.modules[1]?.features[0]).toMatchObject({
        name: '',
        slug: '',
      });

      const rerunYaml = await generateModuleMapYaml(parseRoot);
      expect(rerunYaml).toContain('modules:');
    } finally {
      rmSync(parseRoot, { recursive: true, force: true });
    }
  });

  it('covers instruction docs structure validation edge cases', async () => {
    const gate = new InstructionsDocsStructureGate();

    const missingContext = createVerificationContext({
      changed_files: ['docs/instructions/stack/missing.md'],
      documentation_files_changed: true,
    });
    await expect(gate.check(missingContext)).resolves.toMatchObject({
      passed: false,
      detail: 'Instruction documentation file docs/instructions/stack/missing.md does not exist',
    });

    const rootOnlyResult = await gate.check(
      createVerificationContext({
        changed_files: ['docs/instructions'],
        documentation_files_changed: true,
      }),
    );
    expect(rootOnlyResult.detail).toBe('Invalid instruction documentation path docs/instructions');

    const rulesTopLevelResult = await gate.check(
      createVerificationContext({
        changed_files: ['docs/instructions/rules/random.md'],
        documentation_files_changed: true,
      }),
    );
    expect(rulesTopLevelResult.detail).toBe(
      'Invalid instruction documentation path docs/instructions/rules/random.md',
    );

    const rulesNestedResult = await gate.check(
      createVerificationContext({
        changed_files: ['docs/instructions/rules/coding/nested/too-deep.md'],
        documentation_files_changed: true,
      }),
    );
    expect(rulesNestedResult.detail).toBe(
      'Invalid instruction documentation path docs/instructions/rules/coding/nested/too-deep.md',
    );

    const benchmarkContext = createVerificationContext({
      changed_files: [
        'docs/instructions/benchmarks/performance.md',
        'docs/instructions/tech-debt/backlog.md',
      ],
      documentation_files_changed: true,
    });
    writeFile(
      benchmarkContext.project_root,
      'docs/instructions/benchmarks/performance.md',
      '# P\n',
    );
    writeFile(benchmarkContext.project_root, 'docs/instructions/tech-debt/backlog.md', '# T\n');
    await expect(gate.check(benchmarkContext)).resolves.toMatchObject({
      passed: true,
      detail: 'Instruction documentation structure is valid',
    });

    const emptyMarkdownContext = createVerificationContext({
      changed_files: ['docs/instructions/stack/empty.md'],
      documentation_files_changed: true,
    });
    writeFile(emptyMarkdownContext.project_root, 'docs/instructions/stack/empty.md', '');
    await expect(gate.check(emptyMarkdownContext)).resolves.toMatchObject({
      passed: false,
      detail: 'Instruction markdown file docs/instructions/stack/empty.md is empty',
    });

    const cssContext = createVerificationContext({
      changed_files: [
        'docs/instructions/design-system/empty.css',
        'docs/instructions/design-system/theme.css',
      ],
      documentation_files_changed: true,
    });
    writeFile(cssContext.project_root, 'docs/instructions/design-system/empty.css', '');
    writeFile(cssContext.project_root, 'docs/instructions/design-system/theme.css', ':root {}\n');
    await expect(gate.check(cssContext)).resolves.toMatchObject({
      passed: false,
      detail: 'Instruction CSS file docs/instructions/design-system/empty.css is empty',
    });

    const validCssContext = createVerificationContext({
      changed_files: ['docs/instructions/design-system/theme.css'],
      documentation_files_changed: true,
    });
    writeFile(
      validCssContext.project_root,
      'docs/instructions/design-system/theme.css',
      ':root {}\n',
    );
    await expect(gate.check(validCssContext)).resolves.toMatchObject({
      passed: true,
      detail: 'Instruction documentation structure is valid',
    });

    const moduleMapCases: Array<[string, string]> = [
      [
        'not-a-map',
        'Instruction module map docs/instructions/rules/module-map.yml must contain a top-level modules array',
      ],
      [
        YAML.stringify({ version: '1', last_updated_at: '', domain_glossary: {}, modules: [] }),
        'Instruction module map docs/instructions/rules/module-map.yml field version must be a number',
      ],
      [
        YAML.stringify({ version: 1, last_updated_at: '', domain_glossary: {}, modules: [] }),
        'Instruction module map docs/instructions/rules/module-map.yml field last_updated_at must be a non-empty string',
      ],
      [
        YAML.stringify({ version: 1, last_updated_at: 'now', domain_glossary: {}, modules: [] }),
        'Instruction module map docs/instructions/rules/module-map.yml field domain_glossary must include preferred_terms, synonyms, and notes',
      ],
      [
        YAML.stringify({
          version: 1,
          last_updated_at: 'now',
          domain_glossary: { preferred_terms: [], synonyms: {}, notes: '' },
          modules: {},
        }),
        'Instruction module map docs/instructions/rules/module-map.yml must contain a top-level modules array',
      ],
      [
        moduleMapYaml({ modules: ['bad'] }),
        'Instruction module map docs/instructions/rules/module-map.yml modules[0] must be a mapping',
      ],
      [
        moduleMapYaml({
          modules: [{ name: '', slug: '', auto_update_module_name: true }],
        }),
        'Instruction module map docs/instructions/rules/module-map.yml modules[0] is missing required field derivation',
      ],
      [
        moduleMapYaml({
          modules: [
            {
              name: '',
              slug: 'billing',
              auto_update_module_name: true,
              derivation: 'inferred',
              confidence: 'medium',
              source_paths: [],
              evidence: {},
              features: [],
            },
          ],
        }),
        'Instruction module map docs/instructions/rules/module-map.yml modules[0].name must be a non-empty string',
      ],
      [
        moduleMapYaml({
          modules: [
            {
              name: 'Billing',
              slug: '',
              auto_update_module_name: true,
              derivation: 'inferred',
              confidence: 'medium',
              source_paths: [],
              evidence: {},
              features: [],
            },
          ],
        }),
        'Instruction module map docs/instructions/rules/module-map.yml modules[0].slug must be a non-empty string',
      ],
      [
        moduleMapYaml({
          modules: [
            {
              name: 'Billing',
              slug: 'billing',
              auto_update_module_name: 'yes',
              derivation: 'inferred',
              confidence: 'medium',
              source_paths: [],
              evidence: {},
              features: [],
            },
          ],
        }),
        'Instruction module map docs/instructions/rules/module-map.yml modules[0].auto_update_module_name must be a boolean',
      ],
      [
        moduleMapYaml({
          modules: [
            {
              name: 'Billing',
              slug: 'billing',
              auto_update_module_name: true,
              derivation: 'unknown',
              confidence: 'medium',
              source_paths: [],
              evidence: {},
              features: [],
            },
          ],
        }),
        'Instruction module map docs/instructions/rules/module-map.yml modules[0].derivation must be a valid derivation value',
      ],
      [
        moduleMapYaml({
          modules: [
            {
              name: 'Billing',
              slug: 'billing',
              auto_update_module_name: true,
              derivation: 'inferred',
              confidence: 'certain',
              source_paths: [],
              evidence: {},
              features: [],
            },
          ],
        }),
        'Instruction module map docs/instructions/rules/module-map.yml modules[0].confidence must be high, medium, or low',
      ],
      [
        moduleMapYaml({
          modules: [
            {
              name: 'Billing',
              slug: 'billing',
              auto_update_module_name: true,
              derivation: 'inferred',
              confidence: 'medium',
              source_paths: [1],
              evidence: {},
              features: [],
            },
          ],
        }),
        'Instruction module map docs/instructions/rules/module-map.yml modules[0].source_paths must be an array of strings',
      ],
      [
        moduleMapYaml({
          modules: [
            {
              name: 'Billing',
              slug: 'billing',
              auto_update_module_name: true,
              derivation: 'inferred',
              confidence: 'medium',
              source_paths: [],
              evidence: [],
              features: [],
            },
          ],
        }),
        'Instruction module map docs/instructions/rules/module-map.yml modules[0].evidence must be a mapping with routes, tables, and/or symbols arrays',
      ],
      [
        moduleMapYaml({
          modules: [
            {
              name: 'Billing',
              slug: 'billing',
              auto_update_module_name: true,
              derivation: 'inferred',
              confidence: 'medium',
              source_paths: [],
              evidence: { routes: [1] },
              features: [],
            },
          ],
        }),
        'Instruction module map docs/instructions/rules/module-map.yml modules[0].evidence must be a mapping with routes, tables, and/or symbols arrays',
      ],
      [
        moduleMapYaml({
          modules: [
            {
              name: 'Billing',
              slug: 'billing',
              auto_update_module_name: true,
              derivation: 'inferred',
              confidence: 'medium',
              source_paths: [],
              evidence: {},
              features: {},
            },
          ],
        }),
        'Instruction module map docs/instructions/rules/module-map.yml modules[0].features must be an array',
      ],
      [
        moduleMapYaml({
          modules: [
            {
              name: 'Billing',
              slug: 'billing',
              auto_update_module_name: true,
              derivation: 'inferred',
              confidence: 'medium',
              source_paths: [],
              evidence: {},
              features: ['bad'],
            },
          ],
        }),
        'Instruction module map docs/instructions/rules/module-map.yml modules[0].features[0] must be a mapping',
      ],
      [
        moduleMapYaml({
          modules: [
            {
              name: 'Billing',
              slug: 'billing',
              auto_update_module_name: true,
              derivation: 'inferred',
              confidence: 'medium',
              source_paths: [],
              evidence: {},
              features: [{ name: 'Invoices' }],
            },
          ],
        }),
        'Instruction module map docs/instructions/rules/module-map.yml modules[0].features[0] is missing required field slug',
      ],
    ];

    for (const [yaml, expectedDetail] of moduleMapCases) {
      const context = createVerificationContext({
        changed_files: ['docs/instructions/rules/module-map.yml'],
        documentation_files_changed: true,
      });
      writeFile(context.project_root, 'docs/instructions/rules/module-map.yml', yaml);

      await expect(gate.check(context)).resolves.toMatchObject({
        passed: false,
        detail: expectedDetail,
      });
    }

    const validWorkflowContext = createVerificationContext({
      changed_files: ['docs/instructions/workflows/quick-fix.yaml'],
      documentation_files_changed: true,
    });
    writeFile(
      validWorkflowContext.project_root,
      'docs/instructions/workflows/quick-fix.yaml',
      YAML.stringify({
        name: 'quick-fix',
        description: 'Quick fix workflow',
        steps: [
          { skill: 'scope-check', on_failure: 'abort' },
          {
            parallel: [
              { skill: 'test-per-ac-planner', on_failure: 'retry' },
              { skill: 'adversarial-review', on_failure: 'skip' },
            ],
          },
        ],
      }),
    );

    await expect(gate.check(validWorkflowContext)).resolves.toMatchObject({
      passed: true,
      detail: 'Instruction documentation structure is valid',
    });

    const throwingWorkflowContext = createVerificationContext({
      changed_files: ['docs/instructions/workflows/throwing.yaml'],
      documentation_files_changed: true,
    });
    writeFile(
      throwingWorkflowContext.project_root,
      'docs/instructions/workflows/throwing.yaml',
      YAML.stringify({
        name: 'throwing',
        description: 'Invalid shape that makes validator throw',
        steps: [null],
      }),
    );
    await expect(gate.check(throwingWorkflowContext)).resolves.toMatchObject({
      passed: false,
      detail: 'Instruction workflow template docs/instructions/workflows/throwing.yaml is invalid',
    });
  });
});
