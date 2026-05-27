import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ADAPTER_TYPES } from '@/core/types/adapter.js';
import { OnboardingOrchestrator } from '@/onboarding/index.js';

import { seedDetectionFixtures } from '../../shared/detection-fixtures.js';

const fixtures = [
  'new-laravel',
  'new-laravel-sail',
  'existing-laravel',
  'new-react',
  'new-vue',
  'new-nextjs',
  'new-flutter',
  'new-flask',
  'new-nestjs',
  'new-dotnet',
  'new-kotlin-android',
  'new-short-video',
  'empty',
  'multi-stack',
  'existing-with-docs',
  'new-django',
  'new-fastapi',
  'new-rails',
  'new-spring-boot',
  'new-express',
  'new-angular',
  'new-svelte',
  'new-astro',
  'new-go-web',
  'new-rust-web',
] as const;
const adapters = ADAPTER_TYPES;
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

const PORTABILITY_SCAN_DIRS = [
  '.paqad',
  '.claude',
  '.codex',
  '.gemini',
  '.junie',
  '.cursor',
  '.windsurf',
  '.continue',
  '.aider',
  '.antigravity',
  '.github',
  '.vscode',
];

// Strings that, if committed into project config, would break Paqad for any
// other developer who clones the repo (different OS user, different package
// manager prefix, different npx cache). See issue #69.
const ABSOLUTE_PATH_PATTERNS = [
  /\/Users\//,
  /\/home\//,
  /\/opt\/homebrew\//,
  /_npx\//,
  /[A-Z]:\\\\/,
];

function collectAbsolutePathLeaks(projectRoot: string): string[] {
  const violations: string[] = [];
  for (const dir of PORTABILITY_SCAN_DIRS) {
    const root = join(projectRoot, dir);
    if (!existsSync(root)) continue;
    walkFiles(root, (filePath) => {
      if (!/\.(json|ya?ml|md|txt)$/.test(filePath)) return;
      const content = readFileSync(filePath, 'utf8');
      for (const pattern of ABSOLUTE_PATH_PATTERNS) {
        const match = content.match(pattern);
        if (match) {
          violations.push(
            `${filePath.slice(projectRoot.length + 1)}: matches ${pattern} → ${match[0]}`,
          );
          break;
        }
      }
    });
  }
  return violations;
}

function walkFiles(dir: string, visit: (path: string) => void): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walkFiles(full, visit);
    else if (stat.isFile()) visit(full);
  }
}

describe('onboarding adapter matrix', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-onboarding-matrix-'));
    seedDetectionFixtures(root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  for (const fixture of fixtures) {
    for (const adapter of adapters) {
      it(`onboards ${fixture} with ${adapter}`, async () => {
        const projectRoot = join(root, fixture);
        const existingSummary =
          fixture === 'existing-with-docs'
            ? readFileSync(join(projectRoot, 'docs/modules/users/index/summary.md'), 'utf8')
            : null;

        const output = await new OnboardingOrchestrator().run({
          projectRoot,
          adapters: [adapter],
        });

        expect(output.generated_files.length).toBeGreaterThanOrEqual(8);
        expect(existsSync(join(projectRoot, '.paqad/project-profile.yaml'))).toBe(true);
        expect(existsSync(join(projectRoot, '.paqad/onboarding-manifest.json'))).toBe(true);
        if (adapter === 'junie') {
          expect(existsSync(join(projectRoot, '.junie/AGENTS.md'))).toBe(true);
          expect(existsSync(join(projectRoot, '.junie/mcp/mcp.json'))).toBe(true);
          expect(existsSync(join(projectRoot, '.junie/hooks.json'))).toBe(false);
          expect(existsSync(join(projectRoot, '.junie/cache.json'))).toBe(false);
          expect(existsSync(join(projectRoot, '.junie/memory.json'))).toBe(false);
        }
        if (adapter === 'claude-code') {
          expect(existsSync(join(projectRoot, '.claude/settings.hooks.json'))).toBe(true);
          expect(existsSync(join(projectRoot, '.claude/cache.json'))).toBe(true);
          expect(existsSync(join(projectRoot, '.claude/memory.json'))).toBe(true);
        }
        if (adapter === 'codex-cli') {
          expect(existsSync(join(projectRoot, '.codex/hooks.json'))).toBe(true);
          expect(existsSync(join(projectRoot, '.codex/cache.json'))).toBe(true);
          expect(existsSync(join(projectRoot, '.codex/memory.json'))).toBe(true);
        }
        if (adapter === 'antigravity') {
          expect(existsSync(join(projectRoot, 'ANTIGRAVITY.md'))).toBe(true);
          expect(existsSync(join(projectRoot, '.antigravity/mcp.json'))).toBe(true);
          expect(existsSync(join(projectRoot, '.antigravity/hooks.json'))).toBe(true);
          expect(existsSync(join(projectRoot, '.antigravity/cache.json'))).toBe(true);
          expect(existsSync(join(projectRoot, '.antigravity/memory.json'))).toBe(true);
        }
        if (adapter === 'gemini-cli') {
          expect(existsSync(join(projectRoot, '.gemini/hooks.json'))).toBe(true);
          expect(existsSync(join(projectRoot, '.gemini/cache.json'))).toBe(true);
          expect(existsSync(join(projectRoot, '.gemini/memory.json'))).toBe(true);
        }
        if (adapter === 'cursor') {
          expect(existsSync(join(projectRoot, '.cursor/rules/paqad.mdc'))).toBe(true);
          expect(existsSync(join(projectRoot, '.cursor/mcp.json'))).toBe(true);
          expect(existsSync(join(projectRoot, '.cursor/cache.json'))).toBe(true);
          expect(existsSync(join(projectRoot, '.cursor/memory.json'))).toBe(true);
        }
        if (adapter === 'github-copilot') {
          expect(existsSync(join(projectRoot, '.github/copilot-instructions.md'))).toBe(true);
          expect(existsSync(join(projectRoot, '.vscode/mcp.json'))).toBe(true);
        }
        if (adapter === 'windsurf') {
          expect(existsSync(join(projectRoot, '.windsurfrules'))).toBe(true);
          expect(existsSync(join(projectRoot, '.windsurf/mcp.json'))).toBe(true);
          expect(existsSync(join(projectRoot, '.windsurf/cache.json'))).toBe(true);
          expect(existsSync(join(projectRoot, '.windsurf/memory.json'))).toBe(true);
        }
        if (adapter === 'continue') {
          expect(existsSync(join(projectRoot, '.continue/rules/paqad.md'))).toBe(true);
          expect(existsSync(join(projectRoot, '.continue/mcp.json'))).toBe(true);
        }
        if (adapter === 'aider') {
          expect(existsSync(join(projectRoot, 'CONVENTIONS.md'))).toBe(true);
        }

        for (const relativePath of [...PROJECT_SKILL_DIRS, ...PROJECT_AGENT_DIRS]) {
          expect(existsSync(join(projectRoot, relativePath))).toBe(false);
        }

        const portabilityViolations = collectAbsolutePathLeaks(projectRoot);
        expect(portabilityViolations, portabilityViolations.join('\n')).toEqual([]);

        if (fixture === 'existing-with-docs') {
          expect(
            readFileSync(join(projectRoot, 'docs/modules/users/index/summary.md'), 'utf8'),
          ).toBe(existingSummary);
        }
      });
    }
  }
});
