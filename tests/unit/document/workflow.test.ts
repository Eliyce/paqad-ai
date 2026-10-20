import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { posix } from 'node:path';

const { join } = posix;

import { execa } from 'execa';
import YAML from 'yaml';

import { PATHS } from '@/core/constants/paths.js';
import { DesignTokenService } from '@/design-tokens';
import { DocumentationWorkflow, DocumentProgressTracker } from '@/document';
import { loadModuleMap, serializeModuleMap } from '@/onboarding/registry-generator.js';

describe('DocumentationWorkflow', () => {
  let root: string;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'paqad-document-workflow-'));
    mkdirSync(join(root, 'app/Http/Controllers'), { recursive: true });
    mkdirSync(join(root, 'routes'), { recursive: true });
    mkdirSync(join(root, '.paqad'), { recursive: true });
    writeFileSync(
      join(root, 'app/Http/Controllers/UserController.php'),
      '<?php class UserController {}',
    );
    writeFileSync(join(root, 'routes/web.php'), "<?php Route::get('/users', fn () => 'ok');");
    writeFileSync(join(root, 'artisan'), '');
    writeFileSync(
      join(root, 'composer.json'),
      JSON.stringify({ require: { 'laravel/framework': '^12.0' } }),
    );
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'demo-app', private: true, dependencies: { vite: '^5.0.0' } }),
    );
    writeFileSync(
      join(root, PATHS.PROJECT_PROFILE),
      YAML.stringify({
        project: { name: 'Demo', id: 'demo', description: 'Demo' },
        routing: { domain: 'coding', stack: 'flutter', capabilities: [] },
        commands: {
          install: 'pnpm install',
          dev: 'pnpm dev',
          test: 'pnpm test',
          test_single: 'pnpm test -- one',
          lint: 'pnpm lint',
          format: 'pnpm format',
          migrate: 'php artisan migrate',
          build: 'pnpm build',
        },
        strictness: {
          full_lane_default: false,
          require_adversarial_review: true,
          block_on_stale_docs: true,
          require_db_review_for_migrations: true,
        },
        compliance_packs: [],
        features: {
          spec_only_mode: false,
          market_research: false,
          design_research: false,
          team_agents: true,
        },
        mcp: { servers: [] },
        model_routing: {
          default_model: 'gpt-5',
          reasoning_model: 'gpt-5',
          fast_model: 'gpt-5-mini',
        },
        research: { depth: 'standard' },
        efficiency: {
          context_hit_rate_target: 0.7,
          skill_caching: true,
          differential_refresh: true,
          mcp_first: true,
        },
        escalation: {
          destructive_operations: 'block',
          risky_migrations: 'warn',
          security_findings: 'block',
          db_row_threshold: 10000,
        },
        custom: { classification_dimensions: [], verification_plugins: [], escalation_rules: [] },
      }),
    );
    writeFileSync(
      join(root, PATHS.ONBOARDING_MANIFEST),
      JSON.stringify(
        {
          framework_version: '0.0.5',
          adapter: 'claude-code',
          project_root: root,
          profile: { routing: { domain: 'coding', stack: 'flutter', capabilities: [] } },
          detected: null,
          generated_at: new Date().toISOString(),
          generated_artifacts: [],
        },
        null,
        2,
      ),
    );
    await new DesignTokenService().seed(root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('foundation mode writes module-map.yml and skips docs/modules/**', async () => {
    const result = await new DocumentationWorkflow().run({ projectRoot: root, mode: 'foundation' });

    expect(result.effective_routing.stack).toBe('laravel');
    expect(result.profile_updated).toBe(true);
    expect(result.module_docs_pending_map_review).toBe(true);
    expect(result.module_map_path).toBe(PATHS.MODULE_MAP);
    expect(result.generated).toContain(PATHS.MODULE_MAP);
    expect(result.steps.map((s) => s.id)).toContain('module-map');

    expect(result.generated.some((p) => p.startsWith('docs/modules/'))).toBe(false);
    expect(existsSync(join(root, 'docs/modules'))).toBe(false);

    expect(result.generated.some((p) => p.startsWith('docs/instructions/stack/'))).toBe(true);
    expect(result.generated.some((p) => p.startsWith('docs/instructions/architecture/'))).toBe(
      true,
    );

    expect(existsSync(join(root, PATHS.MODULE_MAP))).toBe(true);

    const progress = readFileSync(join(root, PATHS.DOC_PROGRESS), 'utf8');
    expect(progress).toContain('pending_map_review');
  });

  it('default run mode is foundation (does not generate docs/modules/**)', async () => {
    const result = await new DocumentationWorkflow().run({ projectRoot: root });

    expect(result.module_docs_pending_map_review).toBe(true);
    expect(result.generated.some((p) => p.startsWith('docs/modules/'))).toBe(false);
  });

  it('foundation mode writes a valid module-map.yml with business-language names', async () => {
    mkdirSync(join(root, 'app/Modules/Billing'), { recursive: true });
    writeFileSync(
      join(root, 'app/Modules/Billing/BillingController.php'),
      '<?php class Billing {}',
    );

    await new DocumentationWorkflow().run({ projectRoot: root, mode: 'foundation' });

    const map = await loadModuleMap(root);
    expect(map).not.toBeNull();
    expect(map!.version).toBe(1);
    expect(map!.modules.some((m) => m.name === 'Billing')).toBe(true);
    const billing = map!.modules.find((m) => m.slug === 'billing');
    expect(billing).toBeDefined();
    expect(billing!.auto_update_module_name).toBe(true);
  });

  it('foundation mode rejects technical-layer names from discovered modules', async () => {
    mkdirSync(join(root, 'app/controllers'), { recursive: true });
    mkdirSync(join(root, 'app/middleware'), { recursive: true });
    mkdirSync(join(root, 'app/services'), { recursive: true });

    await new DocumentationWorkflow().run({ projectRoot: root, mode: 'foundation' });

    const map = await loadModuleMap(root);
    const names = map!.modules.map((m) => m.name.toLowerCase());
    expect(names).not.toContain('controllers');
    expect(names).not.toContain('middleware');
    expect(names).not.toContain('services');
  });

  it('foundation mode preserves locked module names on re-run', async () => {
    mkdirSync(join(root, 'app/Modules/Billing'), { recursive: true });
    await new DocumentationWorkflow().run({ projectRoot: root, mode: 'foundation' });

    const map = await loadModuleMap(root);
    const billing = map!.modules.find((m) => m.slug === 'billing');
    if (billing) {
      billing.name = 'Revenue';
      billing.auto_update_module_name = false;
    }
    writeFileSync(join(root, PATHS.MODULE_MAP), serializeModuleMap(map!));

    await new DocumentationWorkflow().run({ projectRoot: root, mode: 'foundation' });

    const updatedMap = await loadModuleMap(root);
    const locked = updatedMap!.modules.find((m) => m.slug === 'billing');
    expect(locked?.name).toBe('Revenue');
    expect(locked?.auto_update_module_name).toBe(false);
  });

  it('module-docs mode refuses with required message when module-map.yml is absent', async () => {
    await expect(
      new DocumentationWorkflow().run({ projectRoot: root, mode: 'module-docs' }),
    ).rejects.toThrow(
      'I cannot find docs/instructions/rules/module-map.yml. Prompt me with create documentation first',
    );
  });

  it('module-docs mode generates docs/modules/** from the reviewed map', async () => {
    await new DocumentationWorkflow().run({ projectRoot: root, mode: 'foundation' });

    const map = await loadModuleMap(root);
    map!.modules = [
      {
        name: 'Users',
        slug: 'users',
        auto_update_module_name: true,
        derivation: 'inferred',
        confidence: 'high',
        source_paths: ['app/Http/Controllers/UserController.php'],
        evidence: {},
        features: [],
      },
    ];
    writeFileSync(join(root, PATHS.MODULE_MAP), serializeModuleMap(map!));

    const result = await new DocumentationWorkflow().run({
      projectRoot: root,
      mode: 'module-docs',
    });

    expect(result.module_docs_pending_map_review).toBe(false);
    expect(result.generated.some((p) => p.startsWith('docs/modules/users/'))).toBe(true);
    expect(result.generated).toContain('docs/modules/users/index/summary.md');
    expect(existsSync(join(root, 'docs/modules/users/index/summary.md'))).toBe(true);
  });

  it('module-docs mode generates the per-event analytics tree when the flag is on', async () => {
    writeFileSync(join(root, '.paqad', '.config'), 'analytics_instrumentation=true\n');
    mkdirSync(join(root, 'app/Analytics'), { recursive: true });
    writeFileSync(
      join(root, 'app/Analytics/Track.php'),
      "<?php posthog.capture('checkout_started');",
    );

    await new DocumentationWorkflow().run({ projectRoot: root, mode: 'foundation' });

    const map = await loadModuleMap(root);
    map!.modules = [
      {
        name: 'Checkout',
        slug: 'checkout',
        auto_update_module_name: false,
        derivation: 'user',
        confidence: 'high',
        source_paths: ['app/Analytics/Track.php'],
        evidence: {},
        features: [
          {
            name: 'Cart',
            slug: 'cart',
            auto_update_feature_name: false,
            source_paths: ['app/Analytics/Track.php'],
            evidence: {},
          },
          {
            name: 'Browse',
            slug: 'browse',
            auto_update_feature_name: false,
            source_paths: ['app/Http/Controllers/UserController.php'],
            evidence: {},
          },
        ],
      },
    ];
    writeFileSync(join(root, PATHS.MODULE_MAP), serializeModuleMap(map!));

    const result = await new DocumentationWorkflow().run({
      projectRoot: root,
      mode: 'module-docs',
    });

    const eventDoc = 'docs/modules/checkout/analytics/cart/checkout-started.md';
    expect(result.generated).toContain(eventDoc);
    expect(result.generated).toContain('docs/modules/checkout/analytics/index.md');
    expect(readFileSync(join(root, eventDoc), 'utf8')).toContain('checkout_started');
  });

  it('module-docs mode reads only from the map and does not re-run discovery', async () => {
    await new DocumentationWorkflow().run({ projectRoot: root, mode: 'foundation' });

    const map = await loadModuleMap(root);
    map!.modules = [
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
    ];
    writeFileSync(join(root, PATHS.MODULE_MAP), serializeModuleMap(map!));

    const result = await new DocumentationWorkflow().run({
      projectRoot: root,
      mode: 'module-docs',
    });

    expect(result.generated.some((p) => p.startsWith('docs/modules/billing/'))).toBe(true);
    expect(result.generated.some((p) => p.startsWith('docs/modules/Http/'))).toBe(false);
  });

  it('module-docs mode lists orphaned module dirs and does not delete them', async () => {
    mkdirSync(join(root, 'docs/modules/legacy-module'), { recursive: true });
    writeFileSync(join(root, 'docs/modules/legacy-module/README.md'), '# Legacy');

    await new DocumentationWorkflow().run({ projectRoot: root, mode: 'foundation' });

    const map = await loadModuleMap(root);
    map!.modules = [
      {
        name: 'Users',
        slug: 'users',
        auto_update_module_name: true,
        derivation: 'inferred',
        confidence: 'high',
        source_paths: [],
        evidence: {},
        features: [],
      },
    ];
    writeFileSync(join(root, PATHS.MODULE_MAP), serializeModuleMap(map!));

    const result = await new DocumentationWorkflow().run({
      projectRoot: root,
      mode: 'module-docs',
    });

    expect(result.orphaned_module_dirs).toContain('docs/modules/legacy-module');
    expect(existsSync(join(root, 'docs/modules/legacy-module/README.md'))).toBe(true);
  });

  it('module-docs mode updates registries using map slugs after generation', async () => {
    await new DocumentationWorkflow().run({ projectRoot: root, mode: 'foundation' });

    const map = await loadModuleMap(root);
    map!.modules = [
      {
        name: 'Orders',
        slug: 'orders',
        auto_update_module_name: true,
        derivation: 'inferred',
        confidence: 'high',
        source_paths: [],
        evidence: {},
        features: [],
      },
    ];
    writeFileSync(join(root, PATHS.MODULE_MAP), serializeModuleMap(map!));

    const result = await new DocumentationWorkflow().run({
      projectRoot: root,
      mode: 'module-docs',
    });

    const registryContent = readFileSync(
      join(root, 'docs/instructions/registries/module-registry.md'),
      'utf8',
    );
    expect(registryContent).toContain('orders');
    expect(result.generated.some((p) => p.includes('registries'))).toBe(true);
  });

  it('skips unchanged foundation docs on re-run', async () => {
    mkdirSync(join(root, PATHS.DESIGN_SYSTEM_DIR), { recursive: true });
    writeFileSync(
      join(root, PATHS.DESIGN_TOKENS_FILE),
      JSON.stringify(
        { color: { primary: { $value: '#123456', $type: 'color', $description: 'Brand.' } } },
        null,
        2,
      ),
    );

    const workflow = new DocumentationWorkflow();
    await workflow.run({ projectRoot: root, mode: 'foundation' });
    const result2 = await workflow.run({ projectRoot: root, mode: 'foundation' });

    expect(result2.skipped.some((p) => p.startsWith('docs/instructions/design-system/'))).toBe(
      true,
    );
  });

  it('resets stale generating entries through the canonical recovery hook', async () => {
    const workflow = new DocumentationWorkflow();
    await workflow.run({ projectRoot: root, mode: 'foundation' });

    const map = await loadModuleMap(root);
    map!.modules = [
      {
        name: 'Http',
        slug: 'http',
        auto_update_module_name: true,
        derivation: 'inferred',
        confidence: 'high',
        source_paths: ['app/Http/Controllers/UserController.php'],
        evidence: {},
        features: [],
      },
    ];
    writeFileSync(join(root, PATHS.MODULE_MAP), serializeModuleMap(map!));
    await workflow.run({ projectRoot: root, mode: 'module-docs' });

    const tracker = new DocumentProgressTracker();
    const progress = await tracker.load(root);
    if (progress.modules['http']?.['feature:controllers:business']) {
      progress.modules['http']['feature:controllers:business'].state = 'generating';
      progress.modules['http']['feature:controllers:business'].started_at =
        new Date().toISOString();
      await tracker.save(root, progress);
    }

    const result = await execa(join(process.cwd(), 'runtime/hooks/reset-doc-progress.sh'), {
      reject: false,
      input: JSON.stringify({
        project_root: root,
        doc_progress_path: join(root, PATHS.DOC_PROGRESS),
      }),
    });

    expect(result.exitCode).toBe(0);
  });

  it('requires onboarding before running', async () => {
    const bareRoot = mkdtempSync(join(tmpdir(), 'paqad-document-workflow-bare-'));

    try {
      await expect(new DocumentationWorkflow().run({ projectRoot: bareRoot })).rejects.toThrow(
        'Documentation workflow requires onboarding to complete first',
      );
    } finally {
      rmSync(bareRoot, { recursive: true, force: true });
    }
  });

  it('fails loudly when the progress file is corrupted instead of silently resetting it', async () => {
    mkdirSync(join(root, '.paqad'), { recursive: true });
    writeFileSync(join(root, PATHS.DOC_PROGRESS), '{broken json');

    await expect(new DocumentationWorkflow().run({ projectRoot: root })).rejects.toThrow(
      `Invalid JSON in ${PATHS.DOC_PROGRESS}`,
    );
  });

  it('writes flutter-specific technical guidance in module-docs mode', async () => {
    const flutterRoot = mkdtempSync(join(tmpdir(), 'paqad-document-workflow-flutter-'));

    try {
      mkdirSync(join(flutterRoot, 'lib/Payments/Checkout'), { recursive: true });
      mkdirSync(join(flutterRoot, '.paqad'), { recursive: true });
      writeFileSync(
        join(flutterRoot, 'lib/Payments/Checkout/screen.dart'),
        'class CheckoutScreen {}',
      );
      writeFileSync(
        join(flutterRoot, 'pubspec.yaml'),
        'name: demo_flutter\ndependencies:\n  flutter:\n    sdk: flutter\n  dio: ^5.0.0\ndev_dependencies:\n  flutter_test:\n    sdk: flutter\n',
      );
      writeFileSync(
        join(flutterRoot, 'pubspec.lock'),
        'packages:\n  dio:\n    version: "5.8.0"\n  flutter_test:\n    version: "0.0.0"\n',
      );
      await writeProfile(flutterRoot, { domain: 'coding', stack: 'flutter', capabilities: [] });
      await new DesignTokenService().seed(flutterRoot);

      const foundationResult = await new DocumentationWorkflow().run({
        projectRoot: flutterRoot,
        mode: 'foundation',
      });
      expect(foundationResult.effective_routing.stack).toBe('flutter');

      const map = await loadModuleMap(flutterRoot);
      map!.modules = [
        {
          name: 'Payments',
          slug: 'payments',
          auto_update_module_name: true,
          derivation: 'inferred',
          confidence: 'high',
          source_paths: ['lib/Payments/Checkout/screen.dart'],
          evidence: {},
          features: [
            {
              name: 'Checkout',
              slug: 'checkout',
              auto_update_feature_name: true,
              derivation: 'inferred',
              confidence: 'high',
              source_paths: ['lib/Payments/Checkout/screen.dart'],
            },
          ],
        },
      ];
      writeFileSync(join(flutterRoot, PATHS.MODULE_MAP), serializeModuleMap(map!));

      await new DocumentationWorkflow().run({
        projectRoot: flutterRoot,
        mode: 'module-docs',
      });

      expect(
        readFileSync(
          join(flutterRoot, 'docs/modules/payments/features/checkout/technical.md'),
          'utf8',
        ),
      ).toContain(
        'Document widget state, navigation state, and asynchronous view-model transitions.',
      );
    } finally {
      rmSync(flutterRoot, { recursive: true, force: true });
    }
  });

  it('writes short-video-specific technical guidance in module-docs mode', async () => {
    const shortVideoRoot = mkdtempSync(join(tmpdir(), 'paqad-document-workflow-short-video-'));

    try {
      mkdirSync(join(shortVideoRoot, 'src/Publishing/Review'), { recursive: true });
      mkdirSync(join(shortVideoRoot, 'docs/instructions/rules'), { recursive: true });
      mkdirSync(join(shortVideoRoot, '.paqad'), { recursive: true });
      writeFileSync(
        join(shortVideoRoot, 'src/Publishing/Review/pipeline.ts'),
        'export const review = true;',
      );
      writeFileSync(
        join(shortVideoRoot, 'package.json'),
        JSON.stringify({ name: 'short-video-app', private: true }, null, 2),
      );
      writeFileSync(
        join(shortVideoRoot, 'docs/instructions/rules/writing-style.md'),
        '# Writing Style\n\n- Use a direct editorial tone.\n',
      );
      await writeProfile(shortVideoRoot, {
        domain: 'content',
        stack: 'short-video',
        capabilities: [],
      });
      await new DesignTokenService().seed(shortVideoRoot);

      await new DocumentationWorkflow().run({
        projectRoot: shortVideoRoot,
        mode: 'foundation',
        request: {
          domain: 'content',
          stack: 'short-video',
          request_text: 'Launch review script',
        },
      });

      const map = await loadModuleMap(shortVideoRoot);
      map!.modules = [
        {
          name: 'Publishing',
          slug: 'publishing',
          auto_update_module_name: true,
          derivation: 'inferred',
          confidence: 'high',
          source_paths: ['src/Publishing/Review/pipeline.ts'],
          evidence: {},
          features: [
            {
              name: 'Review',
              slug: 'review',
              auto_update_feature_name: true,
              derivation: 'inferred',
              confidence: 'high',
              source_paths: ['src/Publishing/Review/pipeline.ts'],
            },
          ],
        },
      ];
      writeFileSync(join(shortVideoRoot, PATHS.MODULE_MAP), serializeModuleMap(map!));

      const result = await new DocumentationWorkflow().run({
        projectRoot: shortVideoRoot,
        mode: 'module-docs',
        request: {
          domain: 'content',
          stack: 'short-video',
          request_text: 'Launch review script',
        },
      });

      expect(result.effective_routing.stack).toBe('short-video');
      expect(result.effective_routing.domain).toBe('content');
      expect(
        readFileSync(
          join(shortVideoRoot, 'docs/modules/publishing/features/review/technical.md'),
          'utf8',
        ),
      ).toContain(
        'Document editorial states, publishing stages, and content workflow transitions.',
      );

      expect(
        readFileSync(join(shortVideoRoot, 'content/launch-review-script.md'), 'utf8'),
      ).toContain('Use a direct editorial tone.');
    } finally {
      rmSync(shortVideoRoot, { recursive: true, force: true });
    }
  });

  it('keeps a newly shipped detected pack as the effective documentation stack', async () => {
    const djangoRoot = mkdtempSync(join(tmpdir(), 'paqad-document-workflow-django-'));

    try {
      mkdirSync(join(djangoRoot, 'src/Payments'), { recursive: true });
      mkdirSync(join(djangoRoot, '.paqad'), { recursive: true });
      writeFileSync(join(djangoRoot, 'requirements.txt'), 'django==5.1.0\n');
      writeFileSync(join(djangoRoot, 'src/Payments/service.py'), 'def run():\n    return True\n');
      await writeProfile(djangoRoot, { domain: 'coding', stack: 'django', capabilities: [] });
      await new DesignTokenService().seed(djangoRoot);

      const result = await new DocumentationWorkflow().run({
        projectRoot: djangoRoot,
        mode: 'foundation',
      });

      expect(result.effective_routing.stack).toBe('django');
      expect(readFileSync(join(djangoRoot, PATHS.STACK_SNAPSHOT), 'utf8')).toContain('"django"');
    } finally {
      rmSync(djangoRoot, { recursive: true, force: true });
    }
  });

  it('writes content deliverables with coding context when coding capabilities are active', async () => {
    const codingContentRoot = mkdtempSync(
      join(tmpdir(), 'paqad-document-workflow-content-coding-'),
    );

    try {
      mkdirSync(join(codingContentRoot, 'app/Http/Controllers'), { recursive: true });
      mkdirSync(join(codingContentRoot, '.paqad'), { recursive: true });
      writeFileSync(
        join(codingContentRoot, 'app/Http/Controllers/BillingController.php'),
        '<?php class BillingController {}',
      );
      writeFileSync(
        join(codingContentRoot, 'composer.json'),
        JSON.stringify({ require: { 'laravel/framework': '^12.0' } }, null, 2),
      );
      await writeProfile(codingContentRoot, {
        domain: 'coding',
        stack: 'laravel',
        capabilities: ['boost'],
      });
      await new DesignTokenService().seed(codingContentRoot);

      await new DocumentationWorkflow().run({
        projectRoot: codingContentRoot,
        mode: 'foundation',
        request: {
          domain: 'content',
          stack: 'laravel',
          request_text: 'Billing launch brief',
        },
      });

      expect(
        readFileSync(join(codingContentRoot, 'content/billing-launch-brief.md'), 'utf8'),
      ).toContain('## Technical Context');
      expect(
        readFileSync(join(codingContentRoot, 'content/billing-launch-brief.md'), 'utf8'),
      ).toContain('`laravel`');
    } finally {
      rmSync(codingContentRoot, { recursive: true, force: true });
    }
  });
});

describe('discoverBusinessModules', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-module-discovery-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('discovers codebase-native modules from app/Modules/**', async () => {
    const { discoverBusinessModules } = await import('@/onboarding/registry-generator.js');
    mkdirSync(join(root, 'app/Modules/Billing'), { recursive: true });
    mkdirSync(join(root, 'app/Modules/Authentication'), { recursive: true });

    const modules = await discoverBusinessModules(root);

    const names = modules.map((m) => m.name);
    expect(names).toContain('Billing');
    expect(names).toContain('Authentication');
    expect(modules.find((m) => m.name === 'Billing')?.derivation).toBe('codebase_native');
    expect(modules.find((m) => m.name === 'Billing')?.confidence).toBe('high');
  });

  it('rejects technical-layer folder names from inference', async () => {
    const { discoverBusinessModules } = await import('@/onboarding/registry-generator.js');
    mkdirSync(join(root, 'app/controllers'), { recursive: true });
    mkdirSync(join(root, 'app/services'), { recursive: true });
    mkdirSync(join(root, 'app/middleware'), { recursive: true });

    const modules = await discoverBusinessModules(root);

    const names = modules.map((m) => m.name.toLowerCase());
    expect(names).not.toContain('controllers');
    expect(names).not.toContain('services');
    expect(names).not.toContain('middleware');
  });

  it('infers business modules from app/** subdirectories', async () => {
    const { discoverBusinessModules } = await import('@/onboarding/registry-generator.js');
    mkdirSync(join(root, 'app/Inventory'), { recursive: true });

    const modules = await discoverBusinessModules(root);

    expect(modules.some((m) => m.name === 'Inventory')).toBe(true);
    expect(modules.find((m) => m.name === 'Inventory')?.derivation).toBe('inferred');
  });

  it('preserves locked module names from an existing map', async () => {
    const { discoverBusinessModules, serializeModuleMap } =
      await import('@/onboarding/registry-generator.js');
    mkdirSync(join(root, 'app/Modules/Billing'), { recursive: true });
    mkdirSync(join(root, PATHS.RULES_DIR), { recursive: true });

    const existingMap = {
      version: 1,
      last_updated_at: new Date().toISOString(),
      domain_glossary: { preferred_terms: [], synonyms: {}, notes: '' },
      modules: [
        {
          name: 'Revenue',
          slug: 'billing',
          auto_update_module_name: false,
          derivation: 'user' as const,
          confidence: 'high' as const,
          source_paths: ['app/Modules/Billing'],
          evidence: {},
          features: [],
        },
      ],
    };
    writeFileSync(join(root, PATHS.MODULE_MAP), serializeModuleMap(existingMap));

    const modules = await discoverBusinessModules(root);

    const billing = modules.find((m) => m.slug === 'billing');
    expect(billing?.name).toBe('Revenue');
    expect(billing?.auto_update_module_name).toBe(false);
  });
});

describe('module-docs mode: directory source_paths resolve to contained files', () => {
  let root: string;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'paqad-dir-paths-'));
    mkdirSync(join(root, 'app/Modules/Billing'), { recursive: true });
    mkdirSync(join(root, '.paqad'), { recursive: true });
    writeFileSync(
      join(root, 'app/Modules/Billing/BillingController.php'),
      '<?php class BillingController {}',
    );
    await writeProfile(root, { domain: 'coding', stack: 'laravel', capabilities: ['coding'] });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('expands a directory source_path to all source files under that tree', async () => {
    await new DocumentationWorkflow().run({ projectRoot: root, mode: 'foundation' });

    const map = await loadModuleMap(root);
    map!.modules = [
      {
        name: 'Billing',
        slug: 'billing',
        auto_update_module_name: false,
        derivation: 'user',
        confidence: 'high',
        source_paths: ['app/Modules/Billing'],
        evidence: {},
        features: [],
      },
    ];
    writeFileSync(join(root, PATHS.MODULE_MAP), serializeModuleMap(map!));

    const result = await new DocumentationWorkflow().run({
      projectRoot: root,
      mode: 'module-docs',
    });

    expect(result.generated.some((p) => p.startsWith('docs/modules/billing/'))).toBe(true);
    expect(existsSync(join(root, 'docs/modules/billing/index/summary.md'))).toBe(true);
    const summaryContent = readFileSync(
      join(root, 'docs/modules/billing/index/summary.md'),
      'utf8',
    );
    expect(summaryContent).toContain('Billing');
  });
});

describe('generateModuleMapYaml: user-owned content survives re-runs', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-map-preservation-'));
    mkdirSync(join(root, 'app/Modules/Billing'), { recursive: true });
    mkdirSync(join(root, PATHS.RULES_DIR), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('preserves user-edited glossary synonyms and preferred_terms on re-run', async () => {
    const { generateModuleMapYaml, loadModuleMap, writeModuleMap } =
      await import('@/onboarding/registry-generator.js');

    const firstYaml = await generateModuleMapYaml(root);
    await writeModuleMap(root, firstYaml);

    const map = await loadModuleMap(root);
    map!.domain_glossary = {
      preferred_terms: ['revenue', 'invoice'],
      synonyms: { billing: 'revenue', payments: 'billing' },
      notes: 'Use revenue instead of billing in all docs.',
    };
    await writeModuleMap(root, YAML.stringify(map, { indent: 2, lineWidth: 0 }));

    const secondYaml = await generateModuleMapYaml(root);
    await writeModuleMap(root, secondYaml);

    const reloaded = await loadModuleMap(root);
    expect(reloaded!.domain_glossary.preferred_terms).toEqual(['revenue', 'invoice']);
    expect(reloaded!.domain_glossary.synonyms).toEqual({
      billing: 'revenue',
      payments: 'billing',
    });
    expect(reloaded!.domain_glossary.notes).toBe('Use revenue instead of billing in all docs.');
  });

  it('preserves module evidence (routes, tables, symbols) on round-trip', async () => {
    const { serializeModuleMap, loadModuleMap, writeModuleMap } =
      await import('@/onboarding/registry-generator.js');

    const mapWithEvidence = {
      version: 1 as const,
      last_updated_at: new Date().toISOString(),
      domain_glossary: { preferred_terms: [], synonyms: {}, notes: '' },
      modules: [
        {
          name: 'Billing',
          slug: 'billing',
          auto_update_module_name: false,
          derivation: 'user' as const,
          confidence: 'high' as const,
          source_paths: ['app/Modules/Billing'],
          evidence: {
            routes: ['/billing', '/invoices'],
            tables: ['invoices', 'payments'],
            symbols: ['BillingService', 'InvoiceRepository'],
          },
          features: [],
        },
      ],
    };

    await writeModuleMap(root, serializeModuleMap(mapWithEvidence));

    const reloaded = await loadModuleMap(root);
    expect(reloaded!.modules[0].evidence.routes).toEqual(['/billing', '/invoices']);
    expect(reloaded!.modules[0].evidence.tables).toEqual(['invoices', 'payments']);
    expect(reloaded!.modules[0].evidence.symbols).toEqual(['BillingService', 'InvoiceRepository']);
  });
});

describe('discoverBusinessModules: signal-based discovery', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-signal-discovery-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('extracts business names from PHP controllers when no container dir exists', async () => {
    const { discoverBusinessModules } = await import('@/onboarding/registry-generator.js');

    mkdirSync(join(root, 'app/Http/Controllers'), { recursive: true });
    mkdirSync(join(root, 'app/Models'), { recursive: true });
    writeFileSync(
      join(root, 'app/Http/Controllers/BillingController.php'),
      '<?php class BillingController {}',
    );
    writeFileSync(
      join(root, 'app/Http/Controllers/InvoiceController.php'),
      '<?php class InvoiceController {}',
    );
    writeFileSync(join(root, 'app/Models/Invoice.php'), '<?php class Invoice {}');

    const modules = await discoverBusinessModules(root);

    const slugs = modules.map((m) => m.slug);
    expect(slugs).toContain('billing');
    expect(slugs).toContain('invoice');
    expect(slugs).not.toEqual(['core']);
  });

  it('does not produce Core when controllers are present', async () => {
    const { discoverBusinessModules } = await import('@/onboarding/registry-generator.js');

    mkdirSync(join(root, 'app/Http/Controllers'), { recursive: true });
    writeFileSync(
      join(root, 'app/Http/Controllers/OrderController.php'),
      '<?php class OrderController {}',
    );

    const modules = await discoverBusinessModules(root);

    const names = modules.map((m) => m.name);
    expect(names).not.toEqual(['Core']);
    expect(names.some((n) => n.toLowerCase().includes('order'))).toBe(true);
  });

  it('filters framework boilerplate controller names', async () => {
    const { discoverBusinessModules } = await import('@/onboarding/registry-generator.js');

    mkdirSync(join(root, 'app/Http/Controllers'), { recursive: true });
    writeFileSync(join(root, 'app/Http/Controllers/AuthController.php'), '');
    writeFileSync(join(root, 'app/Http/Controllers/BaseController.php'), '');
    writeFileSync(join(root, 'app/Http/Controllers/BillingController.php'), '');

    const modules = await discoverBusinessModules(root);

    const slugs = modules.map((m) => m.slug);
    expect(slugs).not.toContain('auth');
    expect(slugs).not.toContain('base');
    expect(slugs).toContain('billing');
  });
});

describe('foundation mode: registries reflect the proposed module map', () => {
  let root: string;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'paqad-registry-ordering-'));
    mkdirSync(join(root, 'app/Http/Controllers'), { recursive: true });
    mkdirSync(join(root, 'routes'), { recursive: true });
    mkdirSync(join(root, '.paqad'), { recursive: true });
    writeFileSync(
      join(root, 'app/Http/Controllers/BillingController.php'),
      '<?php class BillingController {}',
    );
    writeFileSync(join(root, 'routes/web.php'), "<?php Route::get('/billing', fn () => 'ok');");
    writeFileSync(join(root, 'artisan'), '');
    writeFileSync(
      join(root, 'composer.json'),
      JSON.stringify({ require: { 'laravel/framework': '^12.0' } }),
    );
    await writeProfile(root, { domain: 'coding', stack: 'laravel', capabilities: ['coding'] });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('writes registries with the proposed business-language module names, not legacy folder names', async () => {
    const result = await new DocumentationWorkflow().run({ projectRoot: root, mode: 'foundation' });

    expect(result.generated).toContain(PATHS.MODULE_MAP);

    const moduleRegistryPath = join(root, 'docs/instructions/registries/module-registry.md');
    expect(existsSync(moduleRegistryPath)).toBe(true);
    const registryContent = readFileSync(moduleRegistryPath, 'utf8');
    expect(registryContent).toContain('billing');
    expect(registryContent).not.toContain('- Http');
  });
});

describe('discoverBusinessModules: locked modules survive when not rediscovered', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-locked-modules-'));
    mkdirSync(join(root, PATHS.RULES_DIR), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('preserves a locked module even when its source directory no longer exists', async () => {
    const { discoverBusinessModules, serializeModuleMap, writeModuleMap } =
      await import('@/onboarding/registry-generator.js');

    const existingMap = {
      version: 1 as const,
      last_updated_at: new Date().toISOString(),
      domain_glossary: { preferred_terms: [], synonyms: {}, notes: '' },
      modules: [
        {
          name: 'Revenue',
          slug: 'revenue',
          auto_update_module_name: false,
          derivation: 'user' as const,
          confidence: 'high' as const,
          source_paths: ['app/Modules/Revenue'],
          evidence: {},
          features: [],
        },
      ],
    };
    await writeModuleMap(root, serializeModuleMap(existingMap));

    const modules = await discoverBusinessModules(root);

    const slugs = modules.map((m) => m.slug);
    expect(slugs).toContain('revenue');
    const locked = modules.find((m) => m.slug === 'revenue');
    expect(locked?.auto_update_module_name).toBe(false);
    expect(locked?.name).toBe('Revenue');
  });

  it('preserves a manually-added locked entry alongside newly discovered entries', async () => {
    const { discoverBusinessModules, serializeModuleMap, writeModuleMap } =
      await import('@/onboarding/registry-generator.js');

    mkdirSync(join(root, 'app/Modules/Billing'), { recursive: true });

    const existingMap = {
      version: 1 as const,
      last_updated_at: new Date().toISOString(),
      domain_glossary: { preferred_terms: [], synonyms: {}, notes: '' },
      modules: [
        {
          name: 'Payments Platform',
          slug: 'payments-platform',
          auto_update_module_name: false,
          derivation: 'user' as const,
          confidence: 'high' as const,
          source_paths: [],
          evidence: {},
          features: [],
        },
      ],
    };
    await writeModuleMap(root, serializeModuleMap(existingMap));

    const modules = await discoverBusinessModules(root);

    const slugs = modules.map((m) => m.slug);
    expect(slugs).toContain('payments-platform');
    expect(slugs).toContain('billing');
  });
});

describe('foundation mode: request-text module name hints', () => {
  let root: string;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'paqad-request-hints-'));
    mkdirSync(join(root, '.paqad'), { recursive: true });
    writeFileSync(join(root, 'artisan'), '');
    writeFileSync(
      join(root, 'composer.json'),
      JSON.stringify({ require: { 'laravel/framework': '^12.0' } }),
    );
    await writeProfile(root, { domain: 'coding', stack: 'laravel', capabilities: ['coding'] });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('includes explicitly named modules from the request text in the generated map', async () => {
    const result = await new DocumentationWorkflow().run({
      projectRoot: root,
      mode: 'foundation',
      request: {
        workflow: 'documentation-update',
        request_text: 'create documentation; modules are Billing and Orders',
        complexity: 'low',
        risk: 'low',
        lane: 'fast',
        domain: 'coding',
        stack: 'laravel',
        scope: 'cross-module',
        affected_modules: [],
        affected_module_count: 0,
        api_impact: null,
        ui_impact: null,
      },
    });

    expect(result.module_docs_pending_map_review).toBe(true);
    const map = await loadModuleMap(root);
    expect(map).not.toBeNull();
    const slugs = map!.modules.map((m) => m.slug);
    expect(slugs).toContain('billing');
    expect(slugs).toContain('orders');
  });

  it('supports the "module: Name" syntax in addition to "modules are"', async () => {
    const { generateModuleMapYaml } = await import('@/onboarding/registry-generator.js');

    const yaml = await generateModuleMapYaml(root, ['Inventory', 'Shipping']);
    const parsed = YAML.parse(yaml) as { modules: Array<{ slug: string; confidence: string }> };

    const slugs = parsed.modules.map((m) => m.slug);
    expect(slugs).toContain('inventory');
    expect(slugs).toContain('shipping');
    const inventory = parsed.modules.find((m) => m.slug === 'inventory');
    expect(inventory?.confidence).toBe('high');
  });
});

describe('foundation mode: processEntry regenerates when content changes without source changes', () => {
  let root: string;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'paqad-processentry-regen-'));
    mkdirSync(join(root, 'app/Http/Controllers'), { recursive: true });
    mkdirSync(join(root, 'routes'), { recursive: true });
    mkdirSync(join(root, '.paqad'), { recursive: true });
    writeFileSync(
      join(root, 'app/Http/Controllers/BillingController.php'),
      '<?php class BillingController {}',
    );
    writeFileSync(join(root, 'routes/web.php'), "<?php Route::get('/billing', fn () => 'ok');");
    writeFileSync(join(root, 'artisan'), '');
    writeFileSync(
      join(root, 'composer.json'),
      JSON.stringify({ require: { 'laravel/framework': '^12.0' } }),
    );
    await writeProfile(root, { domain: 'coding', stack: 'laravel', capabilities: ['coding'] });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('regenerates registries when a rerun adds modules via request hints without changing source files', async () => {
    await new DocumentationWorkflow().run({ projectRoot: root, mode: 'foundation' });

    const registryPath = join(root, 'docs/instructions/registries/module-registry.md');
    const afterFirstRun = readFileSync(registryPath, 'utf8');
    expect(afterFirstRun).toContain('billing');
    expect(afterFirstRun).not.toContain('orders');

    await new DocumentationWorkflow().run({
      projectRoot: root,
      mode: 'foundation',
      request: {
        workflow: 'documentation-update',
        request_text: 'create documentation; modules are Billing and Orders',
        complexity: 'low',
        risk: 'low',
        lane: 'fast',
        domain: 'coding',
        stack: 'laravel',
        scope: 'cross-module',
        affected_modules: [],
        affected_module_count: 0,
        api_impact: null,
        ui_impact: null,
      },
    });

    const afterSecondRun = readFileSync(registryPath, 'utf8');
    expect(afterSecondRun).toContain('orders');
  });
});

describe('generateModuleMapYaml: per-module unknown keys and comments are preserved', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-module-keys-'));
    mkdirSync(join(root, PATHS.RULES_DIR), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('preserves unknown module-level keys (e.g. team_owner) across reruns', async () => {
    const { generateModuleMapYaml, writeModuleMap } =
      await import('@/onboarding/registry-generator.js');

    const initialYaml =
      [
        'version: 1',
        `last_updated_at: ${new Date().toISOString()}`,
        'domain_glossary:',
        '  preferred_terms: []',
        '  synonyms: {}',
        '  notes: ""',
        'modules:',
        '  - name: Billing',
        '    slug: billing',
        '    auto_update_module_name: true',
        '    derivation: inferred',
        '    confidence: high',
        '    source_paths: []',
        '    team_owner: billing-squad',
        '    evidence: {}',
        '    features: []',
      ].join('\n') + '\n';

    await writeModuleMap(root, initialYaml);
    mkdirSync(join(root, 'app/Modules/Billing'), { recursive: true });

    const rerunYaml = await generateModuleMapYaml(root);
    await writeModuleMap(root, rerunYaml);

    expect(rerunYaml).toContain('team_owner: billing-squad');
    expect(rerunYaml).toContain('billing');
  });

  it('preserves inline comments on module entries across reruns', async () => {
    const { generateModuleMapYaml, writeModuleMap } =
      await import('@/onboarding/registry-generator.js');

    const initialYaml =
      [
        'version: 1',
        `last_updated_at: ${new Date().toISOString()}`,
        'domain_glossary:',
        '  preferred_terms: []',
        '  synonyms: {}',
        '  notes: ""',
        'modules:',
        '  - name: Billing',
        '    slug: billing',
        '    # reviewed by: haider 2026-04-30',
        '    auto_update_module_name: true',
        '    derivation: inferred',
        '    confidence: high',
        '    source_paths: []',
        '    evidence: {}',
        '    features: []',
      ].join('\n') + '\n';

    await writeModuleMap(root, initialYaml);
    mkdirSync(join(root, 'app/Modules/Billing'), { recursive: true });

    const rerunYaml = await generateModuleMapYaml(root);

    expect(rerunYaml).toContain('# reviewed by: haider 2026-04-30');
  });

  it('leaves locked module fields untouched while updating auto-update fields', async () => {
    const { generateModuleMapYaml, writeModuleMap, loadModuleMap } =
      await import('@/onboarding/registry-generator.js');

    const initialYaml =
      [
        'version: 1',
        `last_updated_at: ${new Date().toISOString()}`,
        'domain_glossary:',
        '  preferred_terms: []',
        '  synonyms: {}',
        '  notes: ""',
        'modules:',
        '  - name: Revenue',
        '    slug: billing',
        '    auto_update_module_name: false',
        '    derivation: user',
        '    confidence: high',
        '    source_paths: []',
        '    evidence: {}',
        '    features: []',
      ].join('\n') + '\n';

    await writeModuleMap(root, initialYaml);
    mkdirSync(join(root, 'app/Modules/Billing'), { recursive: true });

    const rerunYaml = await generateModuleMapYaml(root);
    const reloadedMap = await loadModuleMap(root);
    await writeModuleMap(root, rerunYaml);
    const afterRerun = await loadModuleMap(root);

    expect(afterRerun!.modules.find((m) => m.slug === 'billing')?.name).toBe('Revenue');
    expect(reloadedMap!.modules.find((m) => m.slug === 'billing')?.name).toBe('Revenue');
  });
});

describe('onboarding next-steps guidance', () => {
  it('contains two-stage prompt instructions and does not claim create documentation generates docs/modules/**', () => {
    const bannerSource = readFileSync(join(process.cwd(), 'src/cli/ui/banner.ts'), 'utf8');

    expect(bannerSource).toContain('create documentation');
    expect(bannerSource).toContain('create module documentation');
    expect(bannerSource).toContain('module map');
    expect(bannerSource).not.toContain('docs/modules');
  });
});

async function writeProfile(
  root: string,
  routing: {
    domain: 'coding' | 'content';
    stack: import('@/core/types/domain').Stack;
    capabilities: string[];
  },
): Promise<void> {
  writeFileSync(
    join(root, PATHS.PROJECT_PROFILE),
    YAML.stringify({
      project: { name: 'Demo', id: 'demo', description: 'Demo' },
      routing,
      commands: {
        install: 'pnpm install',
        dev: 'pnpm dev',
        test: 'pnpm test',
        test_single: 'pnpm test -- one',
        lint: 'pnpm lint',
        format: 'pnpm format',
        migrate: 'php artisan migrate',
        build: 'pnpm build',
      },
      strictness: {
        full_lane_default: false,
        require_adversarial_review: true,
        block_on_stale_docs: true,
        require_db_review_for_migrations: true,
      },
      compliance_packs: [],
      features: {
        spec_only_mode: false,
        market_research: false,
        design_research: false,
        team_agents: true,
      },
      mcp: { servers: [] },
      model_routing: {
        default_model: 'gpt-5',
        reasoning_model: 'gpt-5',
        fast_model: 'gpt-5-mini',
      },
      research: { depth: 'standard' },
      efficiency: {
        context_hit_rate_target: 0.7,
        skill_caching: true,
        differential_refresh: true,
        mcp_first: true,
      },
      escalation: {
        destructive_operations: 'block',
        risky_migrations: 'warn',
        security_findings: 'block',
        db_row_threshold: 10000,
      },
      custom: { classification_dimensions: [], verification_plugins: [], escalation_rules: [] },
    }),
  );
  writeFileSync(
    join(root, PATHS.ONBOARDING_MANIFEST),
    JSON.stringify(
      {
        framework_version: '0.0.5',
        adapter: 'claude-code',
        project_root: root,
        profile: { routing },
        detected: null,
        generated_at: new Date().toISOString(),
        generated_artifacts: [],
      },
      null,
      2,
    ),
  );
}
