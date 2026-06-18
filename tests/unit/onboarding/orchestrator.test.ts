import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { posix } from 'node:path';

const { join } = posix;

import { PATHS } from '@/core/constants/paths.js';
import { FrameworkError } from '@/core/errors/index.js';
import { ADAPTER_TYPES } from '@/core/types/adapter.js';
import { getRuntimeRoot } from '@/core/runtime-paths';
import { OnboardingOrchestrator } from '@/onboarding';
import { readOnboardingCheckpoint, writeOnboardingCheckpoint } from '@/onboarding/checkpoint.js';
import { RagService } from '@/rag/service.js';

const PROJECT_SKILL_DIRS = [
  '.claude/skills',
  '.codex/skills',
  '.antigravity/skills',
  '.gemini/skills',
  '.junie/skills',
  '.cursor/skills',
  '.windsurf/skills',
  '.continue/prompts',
  '.github/skills',
  '.aider/skills',
];

const PROJECT_AGENT_DIRS = [
  '.claude/agents',
  '.codex/agents',
  '.antigravity/agents',
  '.gemini/agents',
  '.junie/agents',
  '.cursor/agents',
  '.windsurf/agents',
  '.continue/agents',
  '.github/agents',
  '.aider/agents',
];

describe('OnboardingOrchestrator', () => {
  let projectRoot: string;
  let frameworkHome: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-ai-onboard-'));
    frameworkHome = join(tmpdir(), `paqad-ai-home-${Date.now()}`);
    originalEnv = process.env.PAQAD_FRAMEWORK_HOME;
    process.env.PAQAD_FRAMEWORK_HOME = frameworkHome;
  });

  afterEach(() => {
    setInteractive(false);
    vi.restoreAllMocks();
    rmSync(projectRoot, { recursive: true, force: true });
    if (existsSync(frameworkHome)) rmSync(frameworkHome, { recursive: true, force: true });
    if (originalEnv === undefined) {
      delete process.env.PAQAD_FRAMEWORK_HOME;
    } else {
      process.env.PAQAD_FRAMEWORK_HOME = originalEnv;
    }
  });

  it('generates framework scaffold files', async () => {
    const orchestrator = new OnboardingOrchestrator();

    const output = await orchestrator.run({
      projectRoot,
      selections: {
        domain: 'coding',
        stack: 'laravel',
        capabilities: [],
      },
    });

    expect(output.generated_files).toContain('CLAUDE.md');
    expect(output.decision_pause_supported_adapters).toEqual(['claude-code']);
    expect(existsSync(join(projectRoot, '.paqad/project-profile.yaml'))).toBe(true);
    expect(existsSync(join(projectRoot, 'docs/instructions/rules/_shared/constitution.md'))).toBe(
      true,
    );
    expect(existsSync(join(projectRoot, '.paqad/hooks/silent-update.sh'))).toBe(true);
    expect(existsSync(join(projectRoot, '.claude/settings.hooks.json'))).toBe(true);
    expect(existsSync(join(projectRoot, '.claude/cache.json'))).toBe(true);
    expect(existsSync(join(projectRoot, '.claude/memory.json'))).toBe(true);
    expect(readFileSync(join(projectRoot, 'CLAUDE.md'), 'utf8')).not.toContain('silent-update.sh');
    expect(existsSync(join(projectRoot, 'docs/modules/core/api/endpoints.md'))).toBe(false);
    expect(
      existsSync(join(projectRoot, 'docs/instructions/workflows/feature-development.yaml')),
    ).toBe(true);
    expect(existsSync(join(projectRoot, '.paqad/compiled-rules.json'))).toBe(true);
    expect(existsSync(join(projectRoot, '.paqad/module-health/core.json'))).toBe(true);
    const onboardingManifest = JSON.parse(
      readFileSync(join(projectRoot, '.paqad/onboarding-manifest.json'), 'utf8'),
    );
    expect(onboardingManifest.project_root).toBe('.');
    expect(onboardingManifest.planning_artifacts).toEqual(
      expect.objectContaining({
        compiled_rules_path: expect.stringContaining('.paqad/compiled-rules.json'),
        module_health_initialized: expect.arrayContaining(['core']),
      }),
    );
  });

  it('emits the enterprise block (all-off) in the generated profile', async () => {
    // Issue #187 — onboarding must surface the opt-in evidence-ledger / AI-BOM /
    // compliance-citation switches so they are visible and toggleable, even
    // though they all default off (a normal user pays zero tokens).
    await new OnboardingOrchestrator().run({
      projectRoot,
      selections: { domain: 'coding', stack: 'laravel', capabilities: [] },
    });

    const profile = readFileSync(join(projectRoot, '.paqad/project-profile.yaml'), 'utf8');
    expect(profile).toContain('enterprise:');
    expect(profile).toContain('  enabled: false');
    expect(profile).toContain('  evidence_ledger: false');
    expect(profile).toContain('  ai_bom: false');
    expect(profile).toContain('  compliance_citations: false');
  });

  it('reports decision pause support for every generated adapter', async () => {
    const orchestrator = new OnboardingOrchestrator();

    const output = await orchestrator.run({
      projectRoot,
      adapters: [...ADAPTER_TYPES],
      selections: {
        domain: 'coding',
        stack: 'laravel',
        capabilities: [],
      },
    });

    expect(output.decision_pause_supported_adapters).toEqual([...ADAPTER_TYPES]);
  });

  it('defaults to claude-code adapter only when no providers are specified', async () => {
    await new OnboardingOrchestrator().run({
      projectRoot,
      selections: { domain: 'coding', stack: 'laravel', capabilities: [] },
    });

    expect(existsSync(join(projectRoot, 'CLAUDE.md'))).toBe(true);
    expect(existsSync(join(projectRoot, 'AGENTS.md'))).toBe(false);
    expect(existsSync(join(projectRoot, 'GEMINI.md'))).toBe(false);
    expect(existsSync(join(projectRoot, '.junie/AGENTS.md'))).toBe(false);
  });

  it('creates only the selected provider files and no others', async () => {
    await new OnboardingOrchestrator().run({
      projectRoot,
      selections: {
        domain: 'coding',
        stack: 'laravel',
        capabilities: [],
        providers: ['codex-cli'],
      },
    });

    expect(existsSync(join(projectRoot, 'AGENTS.md'))).toBe(true);
    expect(existsSync(join(projectRoot, '.codex/hooks.json'))).toBe(true);
    expect(existsSync(join(projectRoot, '.codex/cache.json'))).toBe(true);
    expect(existsSync(join(projectRoot, '.codex/memory.json'))).toBe(true);
    expect(existsSync(join(projectRoot, 'CLAUDE.md'))).toBe(false);
    expect(existsSync(join(projectRoot, 'GEMINI.md'))).toBe(false);
    expect(existsSync(join(projectRoot, '.junie/AGENTS.md'))).toBe(false);
    expect(existsSync(join(projectRoot, '.claude'))).toBe(false);
    expect(existsSync(join(projectRoot, '.junie'))).toBe(false);
    expect(existsSync(join(projectRoot, '.gemini'))).toBe(false);
    assertNoProjectLocalSkillsOrAgents(projectRoot);
  });

  it('writes .gitignore with paqad volatile paths during onboarding', async () => {
    await new OnboardingOrchestrator().run({
      projectRoot,
      selections: { domain: 'coding', stack: 'laravel', capabilities: [] },
    });

    const gitignore = readFileSync(join(projectRoot, '.gitignore'), 'utf8');
    expect(gitignore).toContain('# >>> paqad-ai managed');
    expect(gitignore).toContain('.paqad/cache/');
    expect(gitignore).toContain('.paqad/session/');
    expect(gitignore).toContain('.paqad/pentest/');
    // Issue #187 — the evidence ledger is opt-in, so a fresh onboard (no
    // `enterprise` block) must not ignore `.paqad/ledger/`.
    expect(gitignore).not.toContain('.paqad/ledger/');
  });

  it('enables RAG during onboarding when explicit RAG selections are provided', async () => {
    const configure = vi.spyOn(RagService.prototype, 'configureAndBuild').mockResolvedValue({
      enabled: true,
      configured_provider: 'local',
      configured_model: 'Xenova/all-MiniLM-L6-v2',
      index_present: true,
      valid: true,
      chunk_count: 1,
      size_bytes: 123,
    });

    await new OnboardingOrchestrator().run({
      projectRoot,
      selections: {
        domain: 'coding',
        stack: 'laravel',
        capabilities: [],
        rag: {
          enabled: true,
          provider: 'local',
        },
      },
    });

    expect(configure).toHaveBeenCalledWith(
      expect.objectContaining({
        rag_enabled: true,
        embedding_provider: 'local',
        embedding_model: 'Xenova/all-MiniLM-L6-v2',
      }),
      expect.any(Function),
    );
    expect(readFileSync(join(projectRoot, '.paqad/project-profile.yaml'), 'utf8')).toContain(
      'rag_enabled: true',
    );
  });

  it('falls back cleanly when onboarding-time RAG setup fails', async () => {
    vi.spyOn(RagService.prototype, 'configureAndBuild').mockRejectedValue(
      new Error('model download failed'),
    );

    const output = await new OnboardingOrchestrator().run({
      projectRoot,
      selections: {
        domain: 'coding',
        stack: 'laravel',
        capabilities: [],
        rag: {
          enabled: true,
          provider: 'local',
        },
      },
    });

    const profile = readFileSync(join(projectRoot, '.paqad/project-profile.yaml'), 'utf8');
    expect(profile).toContain('rag_enabled: false');
    expect(profile).not.toContain('embedding_provider: local');
    expect(existsSync(join(projectRoot, '.paqad/detection-report.json'))).toBe(true);
    expect(existsSync(join(projectRoot, '.paqad/framework-version.txt'))).toBe(true);
    expect(existsSync(join(projectRoot, '.paqad/onboarding-manifest.json'))).toBe(true);
    expect(output.warnings).toContain(
      'RAG setup failed during onboarding: model download failed. Onboarding completed with RAG disabled.',
    );
  });

  it('does not create empty architecture or design-system folders during onboarding', async () => {
    await new OnboardingOrchestrator().run({
      projectRoot,
      selections: { domain: 'coding', stack: 'laravel', capabilities: [] },
    });

    expect(existsSync(join(projectRoot, 'docs/instructions/architecture'))).toBe(false);
    expect(existsSync(join(projectRoot, 'docs/instructions/design-system'))).toBe(false);
  });

  it('does not leave empty directories behind during onboarding', async () => {
    await new OnboardingOrchestrator().run({
      projectRoot,
      adapters: [...ADAPTER_TYPES],
      selections: { domain: 'coding', stack: 'laravel', capabilities: [] },
    });

    expect(existsSync(join(projectRoot, 'docs/rules'))).toBe(false);
    expect(existsSync(join(projectRoot, 'docs/modules'))).toBe(false);
    expect(findEmptyDirectories(projectRoot)).toEqual([]);
  });

  it('keeps content-only onboarding limited to the content capability', async () => {
    const orchestrator = new OnboardingOrchestrator();

    await orchestrator.run({
      projectRoot,
      selections: {
        domain: 'content',
        stack: 'short-video',
        capabilities: [],
      },
    });

    const profile = readFileSync(join(projectRoot, '.paqad/project-profile.yaml'), 'utf8');
    expect(profile).toContain('active_capabilities:');
    expect(profile).toContain('  - content');
    expect(profile).not.toContain('  - coding');
    expect(profile).not.toContain('  - security');
    expect(profile).not.toContain('stack_profile:');
    expect(
      existsSync(join(projectRoot, 'docs/instructions/workflows/feature-development.yaml')),
    ).toBe(false);
  });

  it('does not overwrite an existing feature development policy file', async () => {
    mkdirSync(join(projectRoot, 'docs/instructions/workflows'), { recursive: true });
    writeFileSync(
      join(projectRoot, 'docs/instructions/workflows/feature-development.yaml'),
      'schema_version: "1"\n# project-owned customization\n',
    );

    await new OnboardingOrchestrator().run({
      projectRoot,
      selections: { domain: 'coding', stack: 'laravel', capabilities: [] },
    });

    expect(
      readFileSync(
        join(projectRoot, 'docs/instructions/workflows/feature-development.yaml'),
        'utf8',
      ),
    ).toContain('# project-owned customization');
  });

  it('writes laravel phpunit test commands when phpunit is detected', async () => {
    writeFileSync(
      join(projectRoot, 'composer.json'),
      JSON.stringify(
        {
          require: { 'laravel/framework': '^12.0' },
          'require-dev': { 'phpunit/phpunit': '^11.0' },
        },
        null,
        2,
      ),
    );
    writeFileSync(
      join(projectRoot, 'composer.lock'),
      JSON.stringify(
        {
          packages: [{ name: 'laravel/framework', version: 'v12.1.0' }],
          'packages-dev': [{ name: 'phpunit/phpunit', version: '11.5.3' }],
        },
        null,
        2,
      ),
    );
    writeFileSync(join(projectRoot, 'artisan'), '');

    await new OnboardingOrchestrator().run({ projectRoot, adapters: ['claude-code'] });

    const profile = readFileSync(join(projectRoot, '.paqad/project-profile.yaml'), 'utf8');
    expect(profile).toContain('test: mkdir -p .paqad/test-results && ./vendor/bin/phpunit');
    expect(profile).toContain('--log-junit .paqad/test-results/phpunit.xml');
    expect(profile).toContain('test_single: mkdir -p .paqad/test-results && ./vendor/bin/phpunit');
    expect(profile).toContain('--filter="<pattern>" --log-junit');
  });

  it('persists repository discovery metadata into onboarding outputs', async () => {
    mkdirSync(join(projectRoot, 'backend'), { recursive: true });
    mkdirSync(join(projectRoot, 'mobile'), { recursive: true });
    writeFileSync(
      join(projectRoot, 'backend/composer.json'),
      JSON.stringify({ require: { 'laravel/framework': '^12.0' } }, null, 2),
    );
    writeFileSync(join(projectRoot, 'backend/artisan'), '');
    writeFileSync(
      join(projectRoot, 'mobile/pubspec.yaml'),
      'dependencies:\n  flutter:\n    sdk: flutter\n',
    );

    await new OnboardingOrchestrator().run({ projectRoot, adapters: ['claude-code'] });

    const manifest = JSON.parse(
      readFileSync(join(projectRoot, '.paqad/onboarding-manifest.json'), 'utf8'),
    ) as {
      project_root?: string;
      repository?: { projects?: Array<{ root: string; role: string }> };
    };
    const report = JSON.parse(
      readFileSync(join(projectRoot, '.paqad/detection-report.json'), 'utf8'),
    ) as { repository?: { primary_project_root?: string | null } };

    expect(manifest.project_root).toBe('.');
    expect(manifest.repository?.projects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ root: 'backend', role: 'standalone' }),
        expect.objectContaining({ root: 'mobile', role: 'standalone' }),
      ]),
    );
    expect(report.repository?.primary_project_root).toBe('backend');
  });

  it('writes laravel sail-aware commands when sail is detected', async () => {
    writeFileSync(
      join(projectRoot, 'composer.json'),
      JSON.stringify(
        {
          require: { 'laravel/framework': '^12.0', 'laravel/sail': '^1.0' },
        },
        null,
        2,
      ),
    );
    writeFileSync(
      join(projectRoot, 'composer.lock'),
      JSON.stringify(
        {
          packages: [
            { name: 'laravel/framework', version: 'v12.1.0' },
            { name: 'laravel/sail', version: 'v1.34.0' },
          ],
          'packages-dev': [],
        },
        null,
        2,
      ),
    );
    writeFileSync(
      join(projectRoot, 'compose.yaml'),
      'services:\n  laravel.test:\n    image: sail\n',
    );
    writeFileSync(join(projectRoot, 'artisan'), '');

    await new OnboardingOrchestrator().run({ projectRoot, adapters: ['claude-code'] });

    const profile = readFileSync(join(projectRoot, '.paqad/project-profile.yaml'), 'utf8');
    expect(profile).toContain('test: mkdir -p .paqad/test-results && vendor/bin/sail artisan test');
    expect(profile).toContain('--log-junit .paqad/test-results/pest.xml');
    expect(profile).toContain('dev: vendor/bin/sail up -d');
    expect(profile).toContain('migrate: vendor/bin/sail artisan migrate');
    expect(profile).toContain('- sail');
    expect(profile).toContain('- compose');
  });

  it('does not write sail commands for plain laravel compose projects', async () => {
    writeFileSync(
      join(projectRoot, 'composer.json'),
      JSON.stringify(
        {
          require: { 'laravel/framework': '^12.0' },
        },
        null,
        2,
      ),
    );
    writeFileSync(join(projectRoot, 'compose.yaml'), 'services:\n  app:\n    image: php:8.3\n');
    writeFileSync(join(projectRoot, 'artisan'), '');

    await new OnboardingOrchestrator().run({ projectRoot, adapters: ['claude-code'] });

    const profile = readFileSync(join(projectRoot, '.paqad/project-profile.yaml'), 'utf8');
    expect(profile).toContain(
      'test: mkdir -p .paqad/test-results && docker compose exec <php-service> php',
    );
    expect(profile).toContain('artisan test --log-junit .paqad/test-results/pest.xml');
    expect(profile).toContain('migrate: docker compose exec <php-service> php artisan migrate');
    expect(profile).not.toContain('vendor/bin/sail');
    expect(profile).toContain('- compose');
  });

  it('writes compose-aware commands for standalone react projects when compose is detected', async () => {
    writeFileSync(
      join(projectRoot, 'package.json'),
      JSON.stringify(
        {
          dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0' },
        },
        null,
        2,
      ),
    );
    writeFileSync(join(projectRoot, 'compose.yaml'), 'services:\n  web:\n    image: node:20\n');
    mkdirSync(join(projectRoot, 'src'), { recursive: true });
    writeFileSync(
      join(projectRoot, 'src/App.tsx'),
      'export default function App() { return null; }',
    );

    await new OnboardingOrchestrator().run({ projectRoot, adapters: ['claude-code'] });

    const profile = readFileSync(join(projectRoot, '.paqad/project-profile.yaml'), 'utf8');
    expect(profile).toContain(
      'test: docker compose exec <node-service> pnpm test -- --reporter=tap',
    );
    expect(profile).toContain('install: docker compose exec <node-service> pnpm install');
  });

  it('writes composer and pint commands for bare laravel projects', async () => {
    const orchestrator = new OnboardingOrchestrator();

    await orchestrator.run({
      projectRoot,
      adapters: ['claude-code'],
      selections: { domain: 'coding', stack: 'laravel', capabilities: [] },
    });

    const profile = readFileSync(join(projectRoot, '.paqad/project-profile.yaml'), 'utf8');
    expect(profile).toContain('install: composer install');
    expect(profile).toContain('lint: ./vendor/bin/pint');
    expect(profile).toContain('format: ./vendor/bin/pint');
    expect(profile).not.toContain('install: pnpm install');
  });

  it('writes flutter-native commands for bare flutter projects', async () => {
    const orchestrator = new OnboardingOrchestrator();

    await orchestrator.run({
      projectRoot,
      adapters: ['claude-code'],
      selections: { domain: 'coding', stack: 'flutter', capabilities: [] },
    });

    const profile = readFileSync(join(projectRoot, '.paqad/project-profile.yaml'), 'utf8');
    expect(profile).toContain('install: flutter pub get');
    expect(profile).toContain('dev: flutter run');
    expect(profile).toContain('test: flutter test');
    expect(profile).toContain('test_single: flutter test test/<path_or_file>.dart');
    expect(profile).toContain('lint: flutter analyze');
    expect(profile).toContain('format: dart format --set-exit-if-changed .');
    expect(profile).toContain('build: flutter build <target>');
    expect(profile).not.toContain('pnpm ');
  });

  it.each([
    [
      'django',
      [
        'install: pip install -r requirements.txt',
        'dev: python manage.py runserver',
        'test: mkdir -p .paqad/test-results && pytest --json-report',
        '--json-report-file=.paqad/test-results/pytest.json',
        'test_single: mkdir -p .paqad/test-results && pytest -k "<pattern>" --json-report',
        'lint: ruff check .',
        'format: ruff format .',
        'migrate: python manage.py migrate',
        'build: python -m compileall .',
      ],
    ],
    [
      'fastapi',
      [
        'install: pip install -r requirements.txt',
        'dev: uvicorn app.main:app --reload',
        'test: mkdir -p .paqad/test-results && pytest --json-report',
        '--json-report-file=.paqad/test-results/pytest.json',
        'lint: ruff check .',
        'format: ruff format .',
        'build: python -m compileall .',
      ],
    ],
    [
      'rails',
      [
        'install: bundle install',
        'dev: bin/dev',
        'test: bundle exec rspec --format json',
        'test_single: bundle exec rspec <path_or_file> --format json',
        'lint: bundle exec rubocop',
        'format: bundle exec rubocop -A',
        'migrate: bin/rails db:migrate',
        'build: bin/rails assets:precompile',
      ],
    ],
    [
      'spring-boot',
      [
        'install: ./gradlew dependencies',
        'dev: ./gradlew bootRun',
        'test: ./gradlew test',
        'test_single: ./gradlew test --tests "*<pattern>*"',
        'lint: ./gradlew check',
        'format: ./gradlew spotlessApply',
        'build: ./gradlew build',
      ],
    ],
    [
      'go-web',
      [
        'install: go mod download',
        'dev: go run ./...',
        'test: go test ./... -json',
        'test_single: go test ./... -run "<pattern>" -json',
        'lint: go vet ./...',
        'format: gofmt -w .',
        'build: go build ./...',
      ],
    ],
    [
      'rust-web',
      [
        'install: cargo fetch',
        'dev: cargo run',
        'test: cargo test',
        'test_single: cargo test "<pattern>"',
        'lint: cargo clippy --all-targets --all-features -- -D warnings',
        'format: cargo fmt --check',
        'build: cargo build',
      ],
    ],
  ] as const)('writes stack-specific bare commands for %s', async (stack, expectedCommands) => {
    await new OnboardingOrchestrator().run({
      projectRoot,
      adapters: ['claude-code'],
      selections: { domain: 'coding', stack, capabilities: [] },
    });

    const profile = readFileSync(join(projectRoot, '.paqad/project-profile.yaml'), 'utf8');

    for (const command of expectedCommands) {
      expect(profile).toContain(command);
    }

    expect(profile).not.toContain('pnpm install');
    expect(profile).not.toContain('pnpm test');
  });

  it('writes maven-aware commands for detected spring boot projects', async () => {
    await new OnboardingOrchestrator().run({
      projectRoot,
      adapters: ['claude-code'],
      selections: {
        domain: 'coding',
        stack_profile: {
          frameworks: ['spring-boot'],
          traits: [],
          toolchains: [
            {
              ecosystem: 'jvm',
              package_manager: 'maven',
              lockfile: 'pom.xml',
            },
          ],
          version_bands: [],
          sources: [
            {
              file: 'pom.xml',
              kind: 'manifest',
              detail: 'Maven manifest',
            },
          ],
        },
      },
    });

    const profile = readFileSync(join(projectRoot, '.paqad/project-profile.yaml'), 'utf8');
    expect(profile).toContain('install: ./mvnw dependency:resolve');
    expect(profile).toContain('dev: ./mvnw spring-boot:run');
    expect(profile).toContain('test: ./mvnw test');
    expect(profile).toContain('test_single: ./mvnw -Dtest=<pattern> test');
    expect(profile).toContain('format: ./mvnw spotless:apply');
    expect(profile).toContain('build: ./mvnw package');
  });

  it('writes laravel pest test commands when pest is detected', async () => {
    writeFileSync(
      join(projectRoot, 'composer.json'),
      JSON.stringify(
        {
          require: { 'laravel/framework': '^12.0' },
          'require-dev': { 'pestphp/pest': '^3.0' },
        },
        null,
        2,
      ),
    );
    writeFileSync(
      join(projectRoot, 'composer.lock'),
      JSON.stringify(
        {
          packages: [{ name: 'laravel/framework', version: 'v12.1.0' }],
          'packages-dev': [{ name: 'pestphp/pest', version: 'v3.7.4' }],
        },
        null,
        2,
      ),
    );
    writeFileSync(join(projectRoot, 'artisan'), '');

    await new OnboardingOrchestrator().run({ projectRoot, adapters: ['claude-code'] });

    const profile = readFileSync(join(projectRoot, '.paqad/project-profile.yaml'), 'utf8');
    expect(profile).toContain('test: mkdir -p .paqad/test-results && ./vendor/bin/pest');
    expect(profile).toContain('--log-junit .paqad/test-results/pest.xml');
    expect(profile).toContain('test_single: mkdir -p .paqad/test-results && ./vendor/bin/pest');
    expect(profile).toContain('--filter="<pattern>" --log-junit');
  });

  it('is idempotent for auto-update files', async () => {
    const orchestrator = new OnboardingOrchestrator();

    await orchestrator.run({
      projectRoot,
      selections: {
        domain: 'coding',
        stack: 'laravel',
        capabilities: [],
      },
    });

    const firstProfile = readFileSync(join(projectRoot, '.paqad/project-profile.yaml'), 'utf8');

    await orchestrator.run({
      projectRoot,
      selections: {
        domain: 'coding',
        stack: 'laravel',
        capabilities: [],
      },
    });

    const secondProfile = readFileSync(join(projectRoot, '.paqad/project-profile.yaml'), 'utf8');

    expect(secondProfile).toBe(firstProfile);
  });

  describe('PQD-424 — generate baseline docs and configs', () => {
    const selections = { domain: 'coding', stack: 'laravel', capabilities: [] } as const;

    it('writes the .paqad/version schema marker on the first run', async () => {
      await new OnboardingOrchestrator().run({ projectRoot, selections });

      expect(readFileSync(join(projectRoot, PATHS.SCHEMA_VERSION_FILE), 'utf8')).toBe(
        'schema_version=1\n',
      );
    });

    it('writes a project.onboarded audit line with project_id, wizard_version and steps_completed', async () => {
      await new OnboardingOrchestrator().run({ projectRoot, selections });

      const auditLog = readFileSync(join(projectRoot, PATHS.AUDIT_LOG), 'utf8');
      expect(auditLog).toContain('project.onboarded');
      expect(auditLog).toMatch(/project_id="[^"]+"/);
      expect(auditLog).toMatch(/wizard_version="[^"]+"/);
      expect(auditLog).toMatch(/steps_completed="\d+"/);
    });

    it('emits the project.onboarded audit line only once, not on a refresh re-run', async () => {
      const orchestrator = new OnboardingOrchestrator();
      await orchestrator.run({ projectRoot, selections });
      await orchestrator.run({ projectRoot, selections });

      const occurrences = readFileSync(join(projectRoot, PATHS.AUDIT_LOG), 'utf8')
        .split('\n')
        .filter((line) => line.includes('project.onboarded')).length;
      expect(occurrences).toBe(1);
    });

    it('refuses cleanly without touching disk when project creation is disabled', async () => {
      await expect(
        new OnboardingOrchestrator().run({
          projectRoot,
          selections,
          workspacePolicy: { project_creation_disabled: true },
        }),
      ).rejects.toMatchObject({ code: 'PROJECT_CREATION_DISABLED' });

      // No artifacts written — the project root stays empty.
      expect(existsSync(join(projectRoot, 'CLAUDE.md'))).toBe(false);
      expect(existsSync(join(projectRoot, '.paqad/project-profile.yaml'))).toBe(false);
    });

    it('blocks with REGISTRY_CORRUPTED when the existing manifest is corrupt', async () => {
      mkdirSync(join(projectRoot, '.paqad'), { recursive: true });
      writeFileSync(join(projectRoot, PATHS.ONBOARDING_MANIFEST), '{ not valid json');

      await expect(
        new OnboardingOrchestrator().run({ projectRoot, selections }),
      ).rejects.toBeInstanceOf(FrameworkError);
      await expect(
        new OnboardingOrchestrator().run({ projectRoot, selections }),
      ).rejects.toMatchObject({ code: 'REGISTRY_CORRUPTED' });
    });

    it('does not overwrite an existing CLAUDE.md on a re-run, but does with forceOverwrite', async () => {
      await new OnboardingOrchestrator().run({ projectRoot, selections });

      const claudePath = join(projectRoot, 'CLAUDE.md');
      writeFileSync(claudePath, '# user-customised entry\n');

      // Default re-run leaves the project-owned entry file untouched.
      await new OnboardingOrchestrator().run({ projectRoot, selections });
      expect(readFileSync(claudePath, 'utf8')).toBe('# user-customised entry\n');

      // forceOverwrite regenerates it.
      await new OnboardingOrchestrator().run({ projectRoot, selections, forceOverwrite: true });
      expect(readFileSync(claudePath, 'utf8')).not.toBe('# user-customised entry\n');
      expect(readFileSync(claudePath, 'utf8')).toContain('create documentation');
    });

    it('resumes from a checkpoint, skipping already-written files and producing the remainder', async () => {
      // Simulate an interrupted run: cache.json was written, then the process died
      // before the rest. The checkpoint records it as done.
      mkdirSync(join(projectRoot, '.claude'), { recursive: true });
      const cachePath = join(projectRoot, '.claude/cache.json');
      writeFileSync(cachePath, '{"sentinel":true}');
      writeOnboardingCheckpoint(projectRoot, ['.claude/cache.json']);

      const output = await new OnboardingOrchestrator().run({ projectRoot, selections });

      // The checkpointed file is skipped (not regenerated) and not reported as written.
      expect(readFileSync(cachePath, 'utf8')).toBe('{"sentinel":true}');
      expect(output.generated_files).not.toContain('.claude/cache.json');
      // The remainder is produced.
      expect(existsSync(join(projectRoot, 'CLAUDE.md'))).toBe(true);
      // A clean finish clears the checkpoint.
      expect(readOnboardingCheckpoint(projectRoot)).toBeNull();
    });

    it('translates an ENOSPC disk-full error into a clean DISK_FULL FrameworkError', async () => {
      // Simulate the disk filling up mid-write: the core file batch throws ENOSPC.
      // (node:fs itself cannot be spied under ESM, so we fail the orchestrator's
      // own write entry point, which is exactly what the disk-full guard wraps.)
      const fileWriter = await import('@/onboarding/file-writer.js');
      const spy = vi.spyOn(fileWriter, 'writeGeneratedFiles').mockImplementation(() => {
        const error = new Error('ENOSPC: no space left on device') as NodeJS.ErrnoException;
        error.code = 'ENOSPC';
        throw error;
      });

      try {
        await expect(
          new OnboardingOrchestrator().run({ projectRoot, selections }),
        ).rejects.toMatchObject({ code: 'DISK_FULL', retryable: true });
      } finally {
        spy.mockRestore();
      }
    });
  });

  it('throws when profile overrides make the profile invalid', async () => {
    const orchestrator = new OnboardingOrchestrator();

    await expect(
      orchestrator.run({
        projectRoot,
        selections: {
          domain: 'coding',
          stack: 'laravel',
          capabilities: [],
        },
        profileOverrides: {
          escalation: {
            destructive_operations: 'block',
            risky_migrations: 'warn',
            security_findings: 'block',
            db_row_threshold: 'bad-threshold' as never,
          },
        },
      }),
    ).rejects.toThrow();
  });

  it('generates only junie files when junie is the sole provider', async () => {
    const orchestrator = new OnboardingOrchestrator();

    const output = await orchestrator.run({
      projectRoot,
      adapters: ['junie'],
      selections: { domain: 'coding', stack: 'laravel', capabilities: [] },
    });

    expect(output.generated_files).toContain('.junie/AGENTS.md');
    expect(output.generated_files).not.toContain('CLAUDE.md');
    expect(output.generated_files).not.toContain('CODEX.md');
    expect(output.generated_files).not.toContain('ANTIGRAVITY.md');
    expect(output.generated_files).not.toContain('GEMINI.md');
  });

  it('generates only antigravity, codex, and gemini files when those providers are selected', async () => {
    const orchestrator = new OnboardingOrchestrator();

    const output = await orchestrator.run({
      projectRoot,
      adapters: ['antigravity', 'codex-cli', 'gemini-cli'],
      selections: { domain: 'coding', stack: 'laravel', capabilities: [] },
    });

    // codex-cli generates AGENTS.md, antigravity generates ANTIGRAVITY.md, gemini-cli generates GEMINI.md
    expect(output.generated_files).toContain('AGENTS.md');
    expect(output.generated_files).toContain('ANTIGRAVITY.md');
    expect(output.generated_files).toContain('GEMINI.md');
    expect(output.generated_files).not.toContain('CLAUDE.md');
    expect(output.generated_files).not.toContain('.junie/AGENTS.md');
  });

  it('generates flutter files and no laravel detail files for flutter stack', async () => {
    const orchestrator = new OnboardingOrchestrator();

    const output = await orchestrator.run({
      projectRoot,
      adapters: ['claude-code'],
      selections: { domain: 'coding', stack: 'flutter', capabilities: [] },
    });

    expect(output.generated_files.length).toBeGreaterThan(0);
    const ruleFiles = output.generated_files.filter((f) =>
      f.startsWith('docs/instructions/rules/'),
    );
    expect(ruleFiles.some((f) => f.includes('react'))).toBe(false);
    expect(ruleFiles.some((f) => f.includes('vue'))).toBe(false);
    expect(ruleFiles.some((f) => f.includes('inertia'))).toBe(false);
    expect(ruleFiles.some((f) => f.includes('tailwind'))).toBe(false);
    expect(ruleFiles.some((f) => f.includes('boost'))).toBe(false);
  });

  it('generates standalone react stack files and tool references', async () => {
    const orchestrator = new OnboardingOrchestrator();

    const output = await orchestrator.run({
      projectRoot,
      adapters: ['claude-code'],
      selections: { domain: 'coding', stack: 'react', capabilities: ['next', 'tailwind'] },
    });

    expect(
      output.generated_files.some((file) =>
        file.includes('docs/instructions/tools/react/README.md'),
      ),
    ).toBe(true);
    expect(
      output.generated_files.some((file) =>
        file.includes('docs/instructions/tools/react/testing.md'),
      ),
    ).toBe(true);
    const ruleFiles = output.generated_files.filter((f) =>
      f.startsWith('docs/instructions/rules/'),
    );
    expect(ruleFiles.some((f) => f.includes('react'))).toBe(true);
    expect(ruleFiles).toContain(
      'docs/instructions/rules/coding/stacks/react/capabilities/next/next.md',
    );
    expect(ruleFiles.some((f) => f.includes('laravel'))).toBe(false);
  });

  it('generates standalone vue stack files and tool references', async () => {
    const orchestrator = new OnboardingOrchestrator();

    const output = await orchestrator.run({
      projectRoot,
      adapters: ['claude-code'],
      selections: { domain: 'coding', stack: 'vue', capabilities: ['nuxt'] },
    });

    expect(
      output.generated_files.some((file) => file.includes('docs/instructions/tools/vue/README.md')),
    ).toBe(true);
    expect(
      output.generated_files.some((file) =>
        file.includes('docs/instructions/tools/vue/testing.md'),
      ),
    ).toBe(true);
    const ruleFiles = output.generated_files.filter((f) =>
      f.startsWith('docs/instructions/rules/'),
    );
    expect(ruleFiles.some((f) => f.includes('vue'))).toBe(true);
    expect(ruleFiles).toContain(
      'docs/instructions/rules/coding/stacks/vue/capabilities/nuxt/nuxt.md',
    );
    expect(ruleFiles.some((f) => f.includes('laravel'))).toBe(false);
  });

  it('copies selected React sub-stack rules only for the selected capability', async () => {
    const orchestrator = new OnboardingOrchestrator();

    const output = await orchestrator.run({
      projectRoot,
      adapters: ['claude-code'],
      selections: { domain: 'coding', stack: 'react', capabilities: ['remix'] },
    });

    const ruleFiles = output.generated_files.filter((f) =>
      f.startsWith('docs/instructions/rules/'),
    );
    expect(ruleFiles).toContain(
      'docs/instructions/rules/coding/stacks/react/capabilities/remix/remix.md',
    );
    expect(ruleFiles).not.toContain(
      'docs/instructions/rules/coding/stacks/react/capabilities/next/next.md',
    );
    expect(ruleFiles).not.toContain(
      'docs/instructions/rules/coding/stacks/react/capabilities/gatsby/gatsby.md',
    );
    expect(ruleFiles).not.toContain(
      'docs/instructions/rules/coding/stacks/react/capabilities/vite-spa/vite-spa.md',
    );
  });

  it('copies selected Vue sub-stack rules only for the selected capability', async () => {
    const orchestrator = new OnboardingOrchestrator();

    const output = await orchestrator.run({
      projectRoot,
      adapters: ['claude-code'],
      selections: { domain: 'coding', stack: 'vue', capabilities: ['quasar'] },
    });

    const ruleFiles = output.generated_files.filter((f) =>
      f.startsWith('docs/instructions/rules/'),
    );
    expect(ruleFiles).toContain(
      'docs/instructions/rules/coding/stacks/vue/capabilities/quasar/quasar.md',
    );
    expect(ruleFiles).not.toContain(
      'docs/instructions/rules/coding/stacks/vue/capabilities/nuxt/nuxt.md',
    );
    expect(ruleFiles).not.toContain(
      'docs/instructions/rules/coding/stacks/vue/capabilities/vite-spa/vite-spa.md',
    );
  });

  it('generates react rules for laravel with react capability', async () => {
    const orchestrator = new OnboardingOrchestrator();

    const output = await orchestrator.run({
      projectRoot,
      adapters: ['claude-code'],
      selections: { domain: 'coding', stack: 'laravel', capabilities: ['react'] },
    });

    const ruleFiles = output.generated_files.filter((f) =>
      f.startsWith('docs/instructions/rules/'),
    );
    expect(ruleFiles.some((f) => f.includes('react'))).toBe(true);
    expect(ruleFiles.some((f) => f.includes('vue'))).toBe(false);
  });

  it('generates vue rules for laravel with vue capability and not react rules', async () => {
    const orchestrator = new OnboardingOrchestrator();

    const output = await orchestrator.run({
      projectRoot,
      adapters: ['claude-code'],
      selections: { domain: 'coding', stack: 'laravel', capabilities: ['vue'] },
    });

    const ruleFiles = output.generated_files.filter((f) =>
      f.startsWith('docs/instructions/rules/'),
    );
    expect(ruleFiles.some((f) => f.includes('vue'))).toBe(true);
    expect(ruleFiles.some((f) => f.includes('react'))).toBe(false);
  });

  it('generates tailwind rules only when tailwind capability is selected', async () => {
    const orchestrator = new OnboardingOrchestrator();

    const withTailwind = await orchestrator.run({
      projectRoot,
      adapters: ['claude-code'],
      selections: { domain: 'coding', stack: 'laravel', capabilities: ['tailwind'] },
    });

    const withoutProjectRoot = mkdtempSync(join(tmpdir(), 'paqad-ai-notailwind-'));
    const withoutTailwind = await new OnboardingOrchestrator().run({
      projectRoot: withoutProjectRoot,
      adapters: ['claude-code'],
      selections: { domain: 'coding', stack: 'laravel', capabilities: [] },
    });

    const withRules = withTailwind.generated_files.filter((f) =>
      f.startsWith('docs/instructions/rules/'),
    );
    const withoutRules = withoutTailwind.generated_files.filter((f) =>
      f.startsWith('docs/instructions/rules/'),
    );

    expect(withRules.some((f) => f.includes('tailwind'))).toBe(true);
    expect(withoutRules.some((f) => f.includes('tailwind'))).toBe(false);

    rmSync(withoutProjectRoot, { recursive: true, force: true });
  });

  it('generates boost rules when boost capability is selected', async () => {
    const orchestrator = new OnboardingOrchestrator();

    const output = await orchestrator.run({
      projectRoot,
      adapters: ['claude-code'],
      selections: { domain: 'coding', stack: 'laravel', capabilities: ['boost'] },
    });

    const ruleFiles = output.generated_files.filter((f) =>
      f.startsWith('docs/instructions/rules/'),
    );
    expect(ruleFiles.some((f) => f.includes('boost'))).toBe(true);
  });

  it('generates only base laravel files for plain laravel with all details off', async () => {
    const orchestrator = new OnboardingOrchestrator();

    const output = await orchestrator.run({
      projectRoot,
      adapters: ['claude-code'],
      selections: { domain: 'coding', stack: 'laravel', capabilities: [] },
    });

    const ruleFiles = output.generated_files.filter((f) =>
      f.startsWith('docs/instructions/rules/'),
    );
    expect(ruleFiles.some((f) => f.includes('react'))).toBe(false);
    expect(ruleFiles.some((f) => f.includes('vue'))).toBe(false);
    expect(ruleFiles.some((f) => f.includes('tailwind'))).toBe(false);
    expect(ruleFiles.some((f) => f.includes('boost'))).toBe(false);
    expect(ruleFiles.some((f) => f.includes('inertia'))).toBe(false);
  });

  it('uses providers from selections when adapters option is not given', async () => {
    const orchestrator = new OnboardingOrchestrator();

    const output = await orchestrator.run({
      projectRoot,
      selections: {
        domain: 'coding',
        stack: 'laravel',
        capabilities: [],
        providers: ['claude-code'],
      },
    });

    expect(output.adapter).toBe('claude-code');
    expect(output.generated_files).toContain('CLAUDE.md');
    expect(output.generated_files).not.toContain('CODEX.md');
  });

  it('creates a symlink at PAQAD_FRAMEWORK_HOME pointing to the package runtime', async () => {
    await new OnboardingOrchestrator().run({
      projectRoot,
      selections: { domain: 'coding', stack: 'laravel', capabilities: [] },
    });

    expect(existsSync(frameworkHome)).toBe(true);
    expect(lstatSync(frameworkHome).isSymbolicLink()).toBe(true);

    const { realpathSync } = await import('node:fs');
    expect(realpathSync(frameworkHome)).toBe(getRuntimeRoot());
  });

  it('writes framework-path.txt using a machine-safe reference', async () => {
    await new OnboardingOrchestrator().run({
      projectRoot,
      selections: { domain: 'coding', stack: 'laravel', capabilities: [] },
    });

    const content = readFileSync(join(projectRoot, '.paqad/framework-path.txt'), 'utf8').trim();
    expect(content).toBe('$PAQAD_FRAMEWORK_HOME');
  });

  it('creates only cursor provider files when cursor is selected', async () => {
    await new OnboardingOrchestrator().run({
      projectRoot,
      selections: { domain: 'coding', stack: 'laravel', capabilities: [], providers: ['cursor'] },
    });

    expect(existsSync(join(projectRoot, '.cursor/rules/paqad.mdc'))).toBe(true);
    expect(existsSync(join(projectRoot, 'CLAUDE.md'))).toBe(false);
    expect(existsSync(join(projectRoot, 'AGENTS.md'))).toBe(false);
    expect(existsSync(join(projectRoot, 'ANTIGRAVITY.md'))).toBe(false);
    expect(existsSync(join(projectRoot, '.github/copilot-instructions.md'))).toBe(false);
  });

  it('creates only antigravity provider files when antigravity is selected', async () => {
    await new OnboardingOrchestrator().run({
      projectRoot,
      selections: {
        domain: 'coding',
        stack: 'laravel',
        capabilities: [],
        providers: ['antigravity'],
      },
    });

    expect(existsSync(join(projectRoot, 'ANTIGRAVITY.md'))).toBe(true);
    expect(existsSync(join(projectRoot, '.antigravity/mcp.json'))).toBe(true);
    expect(existsSync(join(projectRoot, 'CLAUDE.md'))).toBe(false);
    expect(existsSync(join(projectRoot, 'AGENTS.md'))).toBe(false);
    expect(existsSync(join(projectRoot, 'GEMINI.md'))).toBe(false);
  });

  it('creates only github-copilot provider files when github-copilot is selected', async () => {
    await new OnboardingOrchestrator().run({
      projectRoot,
      selections: {
        domain: 'coding',
        stack: 'laravel',
        capabilities: [],
        providers: ['github-copilot'],
      },
    });

    expect(existsSync(join(projectRoot, '.github/copilot-instructions.md'))).toBe(true);
    expect(existsSync(join(projectRoot, 'CLAUDE.md'))).toBe(false);
    expect(existsSync(join(projectRoot, 'AGENTS.md'))).toBe(false);
    expect(existsSync(join(projectRoot, 'ANTIGRAVITY.md'))).toBe(false);
    expect(existsSync(join(projectRoot, '.cursor/rules/paqad.mdc'))).toBe(false);
  });

  it('creates only windsurf provider files when windsurf is selected', async () => {
    await new OnboardingOrchestrator().run({
      projectRoot,
      selections: {
        domain: 'coding',
        stack: 'laravel',
        capabilities: [],
        providers: ['windsurf'],
      },
    });

    expect(existsSync(join(projectRoot, '.windsurfrules'))).toBe(true);
    expect(existsSync(join(projectRoot, 'CLAUDE.md'))).toBe(false);
    expect(existsSync(join(projectRoot, 'AGENTS.md'))).toBe(false);
    expect(existsSync(join(projectRoot, 'ANTIGRAVITY.md'))).toBe(false);
    expect(existsSync(join(projectRoot, '.github/copilot-instructions.md'))).toBe(false);
  });

  it('creates only continue provider files when continue is selected', async () => {
    await new OnboardingOrchestrator().run({
      projectRoot,
      selections: {
        domain: 'coding',
        stack: 'laravel',
        capabilities: [],
        providers: ['continue'],
      },
    });

    expect(existsSync(join(projectRoot, '.continue/rules/paqad.md'))).toBe(true);
    expect(existsSync(join(projectRoot, 'CLAUDE.md'))).toBe(false);
    expect(existsSync(join(projectRoot, 'AGENTS.md'))).toBe(false);
    expect(existsSync(join(projectRoot, 'ANTIGRAVITY.md'))).toBe(false);
    expect(existsSync(join(projectRoot, '.windsurfrules'))).toBe(false);
  });

  it('creates only aider CONVENTIONS.md when aider is selected', async () => {
    await new OnboardingOrchestrator().run({
      projectRoot,
      selections: {
        domain: 'coding',
        stack: 'laravel',
        capabilities: [],
        providers: ['aider'],
      },
    });

    expect(existsSync(join(projectRoot, 'CONVENTIONS.md'))).toBe(true);
    expect(existsSync(join(projectRoot, 'CLAUDE.md'))).toBe(false);
    expect(existsSync(join(projectRoot, 'AGENTS.md'))).toBe(false);
    expect(existsSync(join(projectRoot, 'ANTIGRAVITY.md'))).toBe(false);
    expect(existsSync(join(projectRoot, '.continue/rules/paqad.md'))).toBe(false);
  });

  // Regression guard for #62: the RAG opt-in must never gate core onboarding writes.
  // Phase 1 (every .paqad/** core artifact) must be on disk before any RAG-related code runs,
  // and must remain intact even if RAG fails. Earlier the orchestrator interleaved the RAG
  // prompt with file writes, so a parked inquirer handle on "No, skip" silently truncated
  // onboarding. The invariants below pin the architecture so that class of bug cannot return.
  describe('phase 1 / phase 2 invariants (regression guard for #62)', () => {
    const CORE_PHASE1_ARTIFACTS = [
      '.paqad/project-profile.yaml',
      '.paqad/detection-report.json',
      '.paqad/framework-version.txt',
      '.paqad/framework-path.txt',
      '.paqad/onboarding-manifest.json',
      '.paqad/classifier-config.json',
      '.paqad/compiled-rules.json',
      '.paqad/decision-pause-contract.md',
      '.paqad/next-steps.md',
      'CLAUDE.md',
    ];

    it('writes every core artifact before onPhase1Complete fires', async () => {
      const presentAtCallback: Record<string, boolean> = {};

      await new OnboardingOrchestrator().run({
        projectRoot,
        selections: { domain: 'coding', stack: 'laravel', capabilities: [] },
        onPhase1Complete: () => {
          for (const artifact of CORE_PHASE1_ARTIFACTS) {
            presentAtCallback[artifact] = existsSync(join(projectRoot, artifact));
          }
        },
      });

      for (const artifact of CORE_PHASE1_ARTIFACTS) {
        expect(presentAtCallback[artifact]).toBe(true);
      }
    });

    it('keeps every core artifact on disk even when the RAG phase throws', async () => {
      vi.spyOn(RagService.prototype, 'configureAndBuild').mockRejectedValue(
        new Error('synthetic RAG failure'),
      );
      vi.spyOn(RagService.prototype, 'hasApiKey').mockReturnValue(true);

      const output = await new OnboardingOrchestrator().run({
        projectRoot,
        selections: {
          domain: 'coding',
          stack: 'laravel',
          capabilities: [],
          rag: { enabled: true, provider: 'local' },
        },
      });

      for (const artifact of CORE_PHASE1_ARTIFACTS) {
        expect(existsSync(join(projectRoot, artifact))).toBe(true);
      }
      expect(output.warnings.some((w) => w.includes('synthetic RAG failure'))).toBe(true);
    });

    it('finishes phase 1 even when the RAG resolver itself rejects', async () => {
      const ragModule = await import('@/onboarding/rag-onboarding.js');
      vi.spyOn(ragModule, 'resolveRagSelection').mockRejectedValue(
        new Error('synthetic RAG prompt failure'),
      );

      let phase1Reached = false;
      let phase1Output: { generated_files: string[] } | undefined;

      await new OnboardingOrchestrator()
        .run({
          projectRoot,
          selections: { domain: 'coding', stack: 'laravel', capabilities: [] },
          onPhase1Complete: (output) => {
            phase1Reached = true;
            phase1Output = output;
          },
        })
        .catch(() => undefined);

      expect(phase1Reached).toBe(true);
      expect(phase1Output?.generated_files).toContain('CLAUDE.md');
      for (const artifact of CORE_PHASE1_ARTIFACTS) {
        expect(existsSync(join(projectRoot, artifact))).toBe(true);
      }
    });
  });
});

function assertNoProjectLocalSkillsOrAgents(projectRoot: string): void {
  for (const relativePath of [...PROJECT_SKILL_DIRS, ...PROJECT_AGENT_DIRS]) {
    expect(existsSync(join(projectRoot, relativePath))).toBe(false);
  }
}

function findEmptyDirectories(root: string, current = root): string[] {
  const entries = readdirSync(current, { withFileTypes: true });
  const emptyDirectories: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const absolute = join(current, entry.name);
    const childEntries = readdirSync(absolute, { withFileTypes: true });

    if (childEntries.length === 0) {
      emptyDirectories.push(absolute.replace(`${root}/`, ''));
      continue;
    }

    emptyDirectories.push(...findEmptyDirectories(root, absolute));
  }

  return emptyDirectories.sort();
}

function setInteractive(value: boolean): void {
  Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value });
  Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value });
}
