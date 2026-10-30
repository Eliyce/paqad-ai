import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { posix } from 'node:path';

const { join } = posix;

import { OnboardingOrchestrator } from '@/onboarding';

import { useOrchestratorSandbox } from './orchestrator-harness.js';

describe('OnboardingOrchestrator', () => {
  let projectRoot: string;

  useOrchestratorSandbox((sandbox) => {
    ({ projectRoot } = sandbox);
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
    expect(profile).toContain('test: mkdir -p .paqad/test-results && php artisan test');
    expect(profile).toContain('--log-junit .paqad/test-results/phpunit.xml');
    expect(profile).toContain('test_single: mkdir -p .paqad/test-results && php artisan test');
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
    expect(profile).toContain('test: mkdir -p .paqad/test-results && vendor/bin/sail test');
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
          scripts: { test: 'vitest run' },
          dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0' },
        },
        null,
        2,
      ),
    );
    writeFileSync(join(projectRoot, 'compose.yaml'), 'services:\n  web:\n    image: node:20\n');
    writeFileSync(join(projectRoot, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n');
    mkdirSync(join(projectRoot, 'src'), { recursive: true });
    writeFileSync(
      join(projectRoot, 'src/App.tsx'),
      'export default function App() { return null; }',
    );

    await new OnboardingOrchestrator().run({ projectRoot, adapters: ['claude-code'] });

    const profile = readFileSync(join(projectRoot, '.paqad/project-profile.yaml'), 'utf8');
    expect(profile).toContain('test: docker compose exec <node-service> pnpm test --reporter=tap');
    expect(profile).toContain(
      'test_single: docker compose exec <node-service> pnpm test <pattern> --reporter=tap',
    );
    expect(profile).not.toContain('pnpm test -- ');
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
    expect(profile).toContain('test: mkdir -p .paqad/test-results && php artisan test');
    expect(profile).toContain('--log-junit .paqad/test-results/pest.xml');
    expect(profile).toContain('test_single: mkdir -p .paqad/test-results && php artisan test');
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
});
