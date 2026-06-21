import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import YAML from 'yaml';

import { runCli } from '@/cli/index.js';
import { PATHS, REGISTRIES } from '@/core/constants/paths.js';
import { toPosixPath } from '@/core/path-utils.js';
import { ADAPTER_TYPES } from '@/core/types/adapter.js';
import type { Stack } from '@/core/types/domain.js';
import { DocumentationWorkflow } from '@/document/workflow.js';
import {
  validateApiDoc,
  validateErrorCatalogMarkdown,
  SchemaValidator,
} from '@/validators/index.js';

import { seedDetectionFixtures } from '../shared/detection-fixtures.js';

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

describe('framework end-to-end onboarding', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-e2e-'));
    seedDetectionFixtures(root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('validates fresh Laravel onboarding with all output groups and MCP defaults', async () => {
    const projectRoot = join(root, 'new-laravel');

    await runOnboard(projectRoot, {
      stack: 'laravel',
      capabilities: ['boost'],
      providers: [...ADAPTER_TYPES],
    });

    assertFiveOutputGroups(projectRoot);
    expect(readFileSync(join(projectRoot, '.claude/settings.mcp.json'), 'utf8')).toContain(
      'laravel-boost',
    );
    expect(readFileSync(join(projectRoot, '.claude/settings.mcp.json'), 'utf8')).toContain(
      'database-inspector',
    );
    expect(existsSync(join(projectRoot, 'CLAUDE.md'))).toBe(true);
    expect(existsSync(join(projectRoot, 'AGENTS.md'))).toBe(true);
    expect(existsSync(join(projectRoot, 'ANTIGRAVITY.md'))).toBe(true);
    expect(existsSync(join(projectRoot, 'GEMINI.md'))).toBe(true);
    expect(existsSync(join(projectRoot, '.junie/AGENTS.md'))).toBe(true);
    expect(existsSync(join(projectRoot, '.cursor/rules/paqad.mdc'))).toBe(true);
    expect(existsSync(join(projectRoot, '.github/copilot-instructions.md'))).toBe(true);
    expect(existsSync(join(projectRoot, '.windsurfrules'))).toBe(true);
    expect(existsSync(join(projectRoot, '.continue/rules/paqad.md'))).toBe(true);
    expect(existsSync(join(projectRoot, 'CONVENTIONS.md'))).toBe(true);
    expect(existsSync(join(projectRoot, '.junie/mcp/mcp.json'))).toBe(true);
    expect(existsSync(join(projectRoot, '.antigravity/mcp.json'))).toBe(true);
    expect(existsSync(join(projectRoot, '.cursor/mcp.json'))).toBe(true);
    expect(existsSync(join(projectRoot, '.vscode/mcp.json'))).toBe(true);
    expect(existsSync(join(projectRoot, '.windsurf/mcp.json'))).toBe(true);
    expect(existsSync(join(projectRoot, '.continue/mcp.json'))).toBe(true);
    expect(existsSync(join(projectRoot, '.claude/settings.hooks.json'))).toBe(true);
    // Codex executes .codex/hooks.json; Gemini executes .gemini/settings.json —
    // each now carries paqad's native completion hook so the ledger fires there too.
    expect(existsSync(join(projectRoot, '.codex/hooks.json'))).toBe(true);
    expect(existsSync(join(projectRoot, '.antigravity/hooks.json'))).toBe(true);
    expect(existsSync(join(projectRoot, '.gemini/settings.json'))).toBe(true);
    expect(existsSync(join(projectRoot, '.claude/cache.json'))).toBe(true);
    expect(existsSync(join(projectRoot, '.claude/memory.json'))).toBe(true);
    expect(existsSync(join(projectRoot, '.codex/cache.json'))).toBe(true);
    expect(existsSync(join(projectRoot, '.codex/memory.json'))).toBe(true);
    expect(existsSync(join(projectRoot, '.antigravity/cache.json'))).toBe(true);
    expect(existsSync(join(projectRoot, '.antigravity/memory.json'))).toBe(true);
    expect(existsSync(join(projectRoot, '.gemini/cache.json'))).toBe(true);
    expect(existsSync(join(projectRoot, '.gemini/memory.json'))).toBe(true);
    expect(existsSync(join(projectRoot, '.cursor/cache.json'))).toBe(true);
    expect(existsSync(join(projectRoot, '.cursor/memory.json'))).toBe(true);
    expect(existsSync(join(projectRoot, '.windsurf/cache.json'))).toBe(true);
    expect(existsSync(join(projectRoot, '.windsurf/memory.json'))).toBe(true);
    expect(existsSync(join(projectRoot, '.junie/hooks.json'))).toBe(false);
    expect(existsSync(join(projectRoot, '.junie/cache.json'))).toBe(false);
    expect(existsSync(join(projectRoot, '.junie/memory.json'))).toBe(false);
    expect(readFileSync(join(projectRoot, 'AGENTS.md'), 'utf8')).toContain(
      'docs/instructions/stack',
    );
    expect(readFileSync(join(projectRoot, 'CLAUDE.md'), 'utf8')).toContain(
      'docs/instructions/stack',
    );
    expect(readFileSync(join(projectRoot, 'CLAUDE.md'), 'utf8')).toContain('create documentation');
    expect(readFileSync(join(projectRoot, 'GEMINI.md'), 'utf8')).toContain(
      'docs/instructions/stack',
    );
    expect(readFileSync(join(projectRoot, 'ANTIGRAVITY.md'), 'utf8')).toContain(
      'docs/instructions/stack',
    );
    expect(readFileSync(join(projectRoot, '.junie/AGENTS.md'), 'utf8')).toContain(
      'docs/instructions/stack',
    );
    expect(readFileSync(join(projectRoot, 'AGENTS.md'), 'utf8')).not.toContain('silent-update.sh');
    expect(readFileSync(join(projectRoot, 'CLAUDE.md'), 'utf8')).not.toContain('silent-update.sh');
    expect(readFileSync(join(projectRoot, 'ANTIGRAVITY.md'), 'utf8')).not.toContain(
      'silent-update.sh',
    );
    expect(readFileSync(join(projectRoot, 'GEMINI.md'), 'utf8')).not.toContain('silent-update.sh');
    expect(readFileSync(join(projectRoot, '.junie/AGENTS.md'), 'utf8')).not.toContain(
      'silent-update.sh',
    );
    expect(existsSync(join(projectRoot, '.paqad/hooks/silent-update.sh'))).toBe(true);
    expect(existsSync(join(projectRoot, 'docs/instructions/tools/laravel/README.md'))).toBe(true);
    expect(existsSync(join(projectRoot, 'docs/instructions/tools/laravel/boost.md'))).toBe(true);
    expect(existsSync(join(projectRoot, 'docs/instructions/tools/laravel/testing.md'))).toBe(true);
    assertNoProjectLocalSkillsOrAgents(projectRoot);
    expect(existsSync(join(projectRoot, 'scripts/health-check.sh'))).toBe(false);
    expect(readFileSync(join(projectRoot, '.paqad/next-steps.md'), 'utf8')).toContain(
      'create documentation',
    );
  });

  it('validates Laravel Sail onboarding and writes Sail-aware stack artifacts', async () => {
    const projectRoot = join(root, 'new-laravel-sail');

    await runOnboard(projectRoot, {
      stack: 'laravel',
      capabilities: ['sail', 'compose'],
    });

    assertFiveOutputGroups(projectRoot);
    expect(readFileSync(join(projectRoot, '.paqad/project-profile.yaml'), 'utf8')).toContain(
      'vendor/bin/sail artisan test',
    );
    await new DocumentationWorkflow().run({ projectRoot });
    expect(readFileSync(join(projectRoot, 'docs/instructions/stack/tooling.md'), 'utf8')).toContain(
      '`sail`',
    );
    expect(readFileSync(join(projectRoot, 'docs/instructions/stack/tooling.md'), 'utf8')).toContain(
      '`compose`',
    );
    expect(readFileSync(join(projectRoot, '.paqad/stack-snapshot.json'), 'utf8')).toContain(
      '"sail"',
    );
  });

  it('validates fresh Flutter onboarding with stack-appropriate MCP config', async () => {
    const projectRoot = join(root, 'new-flutter');

    await runOnboard(projectRoot, {
      stack: 'flutter',
    });

    assertFiveOutputGroups(projectRoot);
    expect(readFileSync(join(projectRoot, '.claude/settings.mcp.json'), 'utf8')).toContain(
      'dart-mcp',
    );
    expect(readFileSync(join(projectRoot, '.claude/settings.mcp.json'), 'utf8')).toContain(
      'database-inspector',
    );
    expect(existsSync(join(projectRoot, 'docs/instructions/tools/flutter/README.md'))).toBe(true);
    expect(
      existsSync(join(projectRoot, 'docs/instructions/tools/flutter/environment-loading.md')),
    ).toBe(true);
    expect(
      existsSync(join(projectRoot, 'docs/instructions/tools/flutter/flutter-quality-gate.md')),
    ).toBe(true);
  });

  it('validates fresh React onboarding with standalone stack references and MCP defaults', async () => {
    const projectRoot = join(root, 'new-react');

    await runOnboard(projectRoot, {
      stack: 'react',
      capabilities: ['next', 'tailwind'],
    });

    assertFiveOutputGroups(projectRoot);
    expect(readFileSync(join(projectRoot, '.claude/settings.mcp.json'), 'utf8')).toContain(
      'vite-inspector',
    );
    expect(readFileSync(join(projectRoot, '.claude/settings.mcp.json'), 'utf8')).toContain(
      'react-router-mcp',
    );
    expect(existsSync(join(projectRoot, 'docs/instructions/tools/react/README.md'))).toBe(true);
    expect(existsSync(join(projectRoot, 'docs/instructions/tools/react/testing.md'))).toBe(true);
    expect(existsSync(join(projectRoot, 'docs/instructions/tools/react/playwright.md'))).toBe(true);
    expect(
      existsSync(
        join(projectRoot, 'docs/instructions/rules/coding/stacks/react/capabilities/next/next.md'),
      ),
    ).toBe(true);
    expect(
      existsSync(
        join(
          projectRoot,
          'docs/instructions/rules/coding/stacks/react/capabilities/remix/remix.md',
        ),
      ),
    ).toBe(false);
  });

  it('validates fresh Vue onboarding with standalone stack references and MCP defaults', async () => {
    const projectRoot = join(root, 'new-vue');

    await runOnboard(projectRoot, {
      stack: 'vue',
      capabilities: ['nuxt'],
    });

    assertFiveOutputGroups(projectRoot);
    expect(readFileSync(join(projectRoot, '.claude/settings.mcp.json'), 'utf8')).toContain(
      'vite-inspector',
    );
    expect(readFileSync(join(projectRoot, '.claude/settings.mcp.json'), 'utf8')).toContain(
      'vue-router-mcp',
    );
    expect(existsSync(join(projectRoot, 'docs/instructions/tools/vue/README.md'))).toBe(true);
    expect(existsSync(join(projectRoot, 'docs/instructions/tools/vue/testing.md'))).toBe(true);
    expect(existsSync(join(projectRoot, 'docs/instructions/tools/vue/playwright.md'))).toBe(true);
    expect(
      existsSync(
        join(projectRoot, 'docs/instructions/rules/coding/stacks/vue/capabilities/nuxt/nuxt.md'),
      ),
    ).toBe(true);
    expect(
      existsSync(
        join(
          projectRoot,
          'docs/instructions/rules/coding/stacks/vue/capabilities/vite-spa/vite-spa.md',
        ),
      ),
    ).toBe(false);
  });

  it('writes stack-aware onboarding outputs for the expanded stack set', async () => {
    const cases: Array<{
      projectRoot: string;
      stack: Stack;
      capabilities: string[];
      expectedToolDir: string;
      expectedMcp?: string;
    }> = [
      {
        projectRoot: join(root, 'new-nextjs'),
        stack: 'nextjs',
        capabilities: ['app-router', 'tailwind', 'prisma'],
        expectedToolDir: 'nextjs',
        expectedMcp: 'database-inspector',
      },
      {
        projectRoot: join(root, 'new-flask'),
        stack: 'flask',
        capabilities: ['sqlalchemy', 'gunicorn'],
        expectedToolDir: 'flask',
      },
      {
        projectRoot: join(root, 'new-nestjs'),
        stack: 'nestjs',
        capabilities: ['prisma', 'swagger'],
        expectedToolDir: 'nestjs',
        expectedMcp: 'database-inspector',
      },
      {
        projectRoot: join(root, 'new-dotnet'),
        stack: 'dotnet',
        capabilities: ['ef-core', 'mvc'],
        expectedToolDir: 'dotnet',
        expectedMcp: 'database-inspector',
      },
      {
        projectRoot: join(root, 'new-kotlin-android'),
        stack: 'kotlin-android',
        capabilities: ['room', 'jetpack-compose'],
        expectedToolDir: 'kotlin-android',
        expectedMcp: 'database-inspector',
      },
    ];

    for (const testCase of cases) {
      await runOnboard(testCase.projectRoot, {
        stack: testCase.stack,
        capabilities: testCase.capabilities,
      });

      assertFiveOutputGroups(testCase.projectRoot);
      expect(
        existsSync(
          join(
            testCase.projectRoot,
            `docs/instructions/tools/${testCase.expectedToolDir}/README.md`,
          ),
        ),
      ).toBe(true);
      expect(
        readFileSync(join(testCase.projectRoot, '.paqad/project-profile.yaml'), 'utf8'),
      ).toContain(testCase.stack);
      if (testCase.expectedMcp) {
        expect(
          readFileSync(join(testCase.projectRoot, '.claude/settings.mcp.json'), 'utf8'),
        ).toContain(testCase.expectedMcp);
      }
    }
  });

  it('preserves existing docs and does not overwrite module docs during onboarding', async () => {
    const projectRoot = join(root, 'existing-with-docs');
    const summaryPath = join(projectRoot, 'docs/modules/users/index/summary.md');
    const before = readFileSync(summaryPath, 'utf8');

    await runOnboard(projectRoot, {
      stack: 'laravel',
    });

    expect(readFileSync(summaryPath, 'utf8')).toBe(before);
    expect(existsSync(join(projectRoot, 'docs/instructions/registries/module-registry.md'))).toBe(
      false,
    );
  });

  it('is idempotent across repeated onboarding runs', async () => {
    const projectRoot = join(root, 'new-laravel');

    await runOnboard(projectRoot, {
      stack: 'laravel',
      capabilities: ['boost'],
    });
    const firstSnapshot = await snapshot(projectRoot);

    await runOnboard(projectRoot, {
      stack: 'laravel',
      capabilities: ['boost'],
    });
    const secondSnapshot = await snapshot(projectRoot);

    expect(secondSnapshot).toEqual(firstSnapshot);
  });

  it('passes a schema and markdown validation sweep across generated artifacts', async () => {
    const projectRoot = join(root, 'new-laravel');

    await runOnboard(projectRoot, {
      stack: 'laravel',
      capabilities: ['boost'],
    });

    const validator = new SchemaValidator();
    const manifest = JSON.parse(
      readFileSync(join(projectRoot, PATHS.ONBOARDING_MANIFEST), 'utf8'),
    ) as {
      profile: unknown;
      detected: unknown;
      generated_artifacts: Array<{ path: string }>;
    };

    expect(validator.validate('onboarding-manifest', manifest).valid).toBe(true);
    expect(
      validator.validate(
        'project-profile',
        YAML.parse(readFileSync(join(projectRoot, PATHS.PROJECT_PROFILE), 'utf8')),
      ).valid,
    ).toBe(true);
    expect(
      validator.validate(
        'detection-report',
        JSON.parse(readFileSync(join(projectRoot, PATHS.DETECTION_REPORT), 'utf8')),
      ).valid,
    ).toBe(true);

    for (const artifact of manifest.generated_artifacts) {
      const path = join(projectRoot, artifact.path);

      if (artifact.path.endsWith('api/endpoints.md')) {
        expect(validateApiDoc(readFileSync(path, 'utf8')).valid).toBe(true);
      }

      if (artifact.path.endsWith('error-catalog.md')) {
        expect(validateErrorCatalogMarkdown(readFileSync(path, 'utf8')).valid).toBe(true);
      }
    }
  });

  it('does not generate module api docs during onboarding', async () => {
    const projectRoot = join(root, 'existing-with-docs');

    await runOnboard(projectRoot, {
      stack: 'laravel',
    });

    expect(existsSync(join(projectRoot, 'docs/modules/core/api/endpoints.md'))).toBe(false);
  });

  it('generates registries during the documentation workflow, not onboarding', async () => {
    const projectRoot = join(root, 'new-laravel');

    await runOnboard(projectRoot, {
      stack: 'laravel',
    });

    expect(
      existsSync(join(projectRoot, 'docs/instructions/registries/error-code-registry.md')),
    ).toBe(false);
    await new DocumentationWorkflow().run({ projectRoot });
    expect(
      existsSync(join(projectRoot, 'docs/instructions/registries/error-code-registry.md')),
    ).toBe(true);
    expect(
      existsSync(join(projectRoot, 'docs/instructions/registries/integration-registry.md')),
    ).toBe(true);
  });

  it('generates all registry files through documentation workflow', async () => {
    const projectRoot = join(root, 'new-laravel');

    await runOnboard(projectRoot, {
      stack: 'laravel',
    });

    await new DocumentationWorkflow().run({ projectRoot });
    const registries = await readdir(join(projectRoot, 'docs/instructions/registries'));
    expect(registries.length).toBe(REGISTRIES.length);
    expect(registries).toContain('error-code-registry.md');
    expect(registries).toContain('integration-registry.md');
  });

  it('creates only selected provider files and no unselected provider folders', async () => {
    const projectRoot = join(root, 'new-laravel-codex-only');

    await runOnboard(projectRoot, {
      stack: 'laravel',
      providers: ['codex-cli'],
    });

    expect(existsSync(join(projectRoot, 'AGENTS.md'))).toBe(true);
    expect(existsSync(join(projectRoot, 'CLAUDE.md'))).toBe(false);
    expect(existsSync(join(projectRoot, 'GEMINI.md'))).toBe(false);
    expect(existsSync(join(projectRoot, '.junie'))).toBe(false);
    expect(existsSync(join(projectRoot, '.claude'))).toBe(false);
    expect(existsSync(join(projectRoot, '.gemini'))).toBe(false);
    assertNoProjectLocalSkillsOrAgents(projectRoot);
  });

  it('writes paqad volatile paths into the nested .paqad/.gitignore during onboarding', async () => {
    const projectRoot = join(root, 'new-laravel-gitignore');

    await runOnboard(projectRoot, { stack: 'laravel' });

    // paqad manages its policy inside `.paqad/`, never in the project root.
    const gitignore = readFileSync(join(projectRoot, '.paqad', '.gitignore'), 'utf8');
    expect(gitignore).toContain('# >>> paqad-ai managed');
    expect(gitignore).toContain('cache/');
    expect(gitignore).toContain('session/');
    expect(gitignore).toContain('pentest/');
    // The per-machine version file is ignored; the committed boot pointer is not.
    expect(gitignore).toContain('framework-version.txt');
    expect(gitignore).not.toContain('framework-path.txt');
    // The ledger is always ignored so enabling it can never leak into git.
    expect(gitignore).toContain('ledger/');
  });

  it('does not create empty architecture or design-system folders during onboarding', async () => {
    const projectRoot = join(root, 'new-laravel-no-stubs');

    await runOnboard(projectRoot, { stack: 'laravel' });

    expect(existsSync(join(projectRoot, 'docs/instructions/architecture'))).toBe(false);
    expect(existsSync(join(projectRoot, 'docs/instructions/design-system'))).toBe(false);
  });

  it('installs the pentest workflow rule so AI knows the 5-step process', async () => {
    const projectRoot = join(root, 'new-laravel-pentest-rule');

    await runOnboard(projectRoot, {
      stack: 'laravel',
      capabilities: [],
    });

    const pentestRulePath = join(projectRoot, 'docs/instructions/rules/security/pentest.md');
    expect(existsSync(pentestRulePath)).toBe(true);
    const content = readFileSync(pentestRulePath, 'utf8');
    expect(content).toContain('collect-context');
    expect(content).toContain('run-project-scripts');
    expect(content).toContain('synthesize-findings');
    expect(content).toContain('write-report');
  });

  it('installs pentest rule with 6 security skills including STRIDE first', async () => {
    const projectRoot = join(root, 'new-laravel-pentest-skills');

    await runOnboard(projectRoot, { stack: 'laravel' });

    const content = readFileSync(
      join(projectRoot, 'docs/instructions/rules/security/pentest.md'),
      'utf8',
    );
    expect(content).toContain('stride-threat-model');
    expect(content).toContain('input-validation-review');
    expect(content).toContain('auth-mechanism-review');
    expect(content).toContain('cryptographic-review');
    expect(content).toContain('logging-monitoring-review');
    expect(content).toContain('rate-limiting-review');
    // STRIDE must appear before other skills (runs first in Step 1)
    expect(content.indexOf('stride-threat-model')).toBeLessThan(
      content.indexOf('input-validation-review'),
    );
  });

  it('installs pentest rule with local attack playbook step', async () => {
    const projectRoot = join(root, 'new-laravel-pentest-playbook');

    await runOnboard(projectRoot, { stack: 'laravel' });

    const content = readFileSync(
      join(projectRoot, 'docs/instructions/rules/security/pentest.md'),
      'utf8',
    );
    expect(content).toContain('generate-local-attack-playbook');
    expect(content).toContain('local-playbook.md');
  });
});

async function runOnboard(
  projectRoot: string,
  selections?: {
    stack?: Stack;
    capabilities?: string[];
    providers?: string[];
  },
): Promise<void> {
  const args = ['node', 'paqad-ai', 'onboard', '--project-root', projectRoot];

  if (selections?.stack) {
    args.push('--stack', selections.stack);
  }

  for (const capability of selections?.capabilities ?? []) {
    args.push('--capability', capability);
  }

  for (const provider of selections?.providers ?? []) {
    args.push('--providers', provider);
  }

  await runCli(args);
}

function assertFiveOutputGroups(projectRoot: string): void {
  expect(existsSync(join(projectRoot, 'CLAUDE.md'))).toBe(true);
  expect(existsSync(join(projectRoot, '.paqad/project-profile.yaml'))).toBe(true);
  expect(existsSync(join(projectRoot, 'docs/instructions/rules/_shared/constitution.md'))).toBe(
    true,
  );
  expect(existsSync(join(projectRoot, 'docs/instructions/architecture/overview.md'))).toBe(false);
  expect(existsSync(join(projectRoot, 'docs/instructions/design-system/tokens.md'))).toBe(false);
  expect(existsSync(join(projectRoot, 'docs/instructions/registries/module-registry.md'))).toBe(
    false,
  );
  expect(existsSync(join(projectRoot, 'scripts/health-check.sh'))).toBe(false);
}

function assertNoProjectLocalSkillsOrAgents(projectRoot: string): void {
  for (const relativePath of [...PROJECT_SKILL_DIRS, ...PROJECT_AGENT_DIRS]) {
    expect(existsSync(join(projectRoot, relativePath))).toBe(false);
  }
}

async function snapshot(root: string): Promise<Record<string, string>> {
  const files = await walk(root);
  const entries = await Promise.all(
    files.map(
      async (file) =>
        [file, normalizeSnapshotValue(file, await readFile(join(root, file), 'utf8'))] as const,
    ),
  );

  return Object.fromEntries(entries);
}

function normalizeSnapshotValue(file: string, content: string): string {
  if (file === '.paqad/framework-version.txt') {
    // updated_at changes every run — normalize it for idempotency comparison
    return content.replace(/^updated_at=.+$/m, 'updated_at=<normalized>');
  }

  if (!file.endsWith('.json')) {
    return content;
  }

  const parsed = JSON.parse(content) as Record<string, unknown>;

  if (file === '.paqad/detection-report.json') {
    delete parsed.timestamp;
  }

  if (file === '.paqad/onboarding-manifest.json') {
    delete parsed.generated_at;
    if (parsed.detected && typeof parsed.detected === 'object') {
      delete (parsed.detected as Record<string, unknown>).timestamp;
    }
  }

  if (file === '.paqad/indexes/registry-status.json') {
    delete parsed.generated_at;
  }

  return JSON.stringify(parsed, null, 2);
}

async function walk(root: string, current = root): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const absolute = join(current, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(root, absolute)));
      continue;
    }

    // relative() emits backslashes on Windows; snapshot keys must stay posix so
    // normalizeSnapshotValue's file-name matches keep stripping volatile fields.
    files.push(toPosixPath(relative(root, absolute)));
  }

  return files.sort();
}
