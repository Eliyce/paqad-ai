import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { AdapterFactory } from '@/adapters/index.js';
import { ADAPTER_TYPES } from '@/core/types/adapter.js';
import { OnboardingOrchestrator } from '@/onboarding/index.js';

import { seedDetectionFixtures } from '../../shared/detection-fixtures.js';

// The onboarding adapter matrix, shared by matrix.g1.test.ts to matrix.g5.test.ts (issue #654).
// It ran as one file of 25 fixtures times every adapter, which took 440s on Windows and set a
// floor no shard count could get under, because Vitest shards by file. Each group file now
// registers five fixtures, and matrix-partition.test.ts proves the groups still cover all 25.
// This file is not collected on its own because it does not end in `.test.ts`.

export const MATRIX_FIXTURES = [
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

export type MatrixFixture = (typeof MATRIX_FIXTURES)[number];

/** The fixtures in five groups of five, in list order. One group per test file. */
export const MATRIX_GROUPS: readonly (readonly MatrixFixture[])[] = [0, 1, 2, 3, 4].map((group) =>
  MATRIX_FIXTURES.slice(group * 5, group * 5 + 5),
);

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
  '.aiassistant',
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
  const projectRootForwardSlash = projectRoot.replace(/\\/g, '/');
  for (const dir of PORTABILITY_SCAN_DIRS) {
    const root = join(projectRoot, dir);
    if (!existsSync(root)) continue;
    walkFiles(root, (filePath) => {
      if (!/\.(json|ya?ml|md|txt)$/.test(filePath)) return;
      // Files paqad itself marks git-ignored (e.g. the per-machine
      // `.claude/settings.json` whose hook command carries an absolute install
      // path, issue #240) are never committed, so an absolute path there is
      // intentional, not a portability leak. Exempt anything listed in a sibling
      // `.gitignore` paqad wrote.
      if (isGitignoredInDir(filePath)) return;
      const content = readFileSync(filePath, 'utf8');
      const relPath = filePath.slice(projectRoot.length + 1);

      // Generic check: the test's own tmp projectRoot must never be embedded in
      // committed config. Catches anything the hard-coded patterns miss
      // (e.g. /var/folders/... on macOS tmp, /tmp/... on Linux tmp).
      if (content.includes(projectRoot) || content.includes(projectRootForwardSlash)) {
        violations.push(`${relPath}: contains absolute projectRoot`);
        return;
      }

      for (const pattern of ABSOLUTE_PATH_PATTERNS) {
        const match = content.match(pattern);
        if (match) {
          violations.push(`${relPath}: matches ${pattern} → ${match[0]}`);
          break;
        }
      }
    });
  }
  return violations;
}

/** True when a sibling `.gitignore` lists this file's basename (paqad's per-machine
 *  exemption — the file is never committed, so an absolute path in it is fine). */
function isGitignoredInDir(filePath: string): boolean {
  try {
    const patterns = readFileSync(join(dirname(filePath), '.gitignore'), 'utf8')
      .split('\n')
      .map((line) => line.trim());
    return patterns.includes(basename(filePath));
  } catch {
    return false;
  }
}

function walkFiles(dir: string, visit: (path: string) => void): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walkFiles(full, visit);
    else if (stat.isFile()) visit(full);
  }
}

/** Registers the adapter matrix for one group of fixtures, with the same suite and test names
 *  the single matrix file used. */
export function defineMatrixSuite(fixtures: readonly MatrixFixture[]): void {
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
            expect(existsSync(join(projectRoot, '.junie/mcp/mcp.json'))).toBe(false);
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
            // The real Codex hook file carries the full pre-and-completion chain (issue #566):
            // the PreToolUse `^apply_patch$` gates and the blocking `Stop` completion hook, so
            // the same feature-development enforcement Claude gets fires on Codex out of the box.
            const codexHooks = readFileSync(join(projectRoot, '.codex/hooks.json'), 'utf8');
            expect(codexHooks).toContain('"Stop"');
            expect(codexHooks).toContain('"PreToolUse"');
            expect(codexHooks).toContain('^apply_patch$');
            expect(codexHooks).toContain('verification-completion.mjs');
            // Codex no longer uses the record-only hook — it renders the blocking chain.
            expect(codexHooks).not.toContain('verification-record.mjs');
            expect(existsSync(join(projectRoot, '.codex/cache.json'))).toBe(true);
            expect(existsSync(join(projectRoot, '.codex/memory.json'))).toBe(true);
          }
          if (adapter === 'antigravity') {
            expect(existsSync(join(projectRoot, 'ANTIGRAVITY.md'))).toBe(true);
            expect(existsSync(join(projectRoot, '.antigravity/mcp.json'))).toBe(false);
            expect(existsSync(join(projectRoot, '.antigravity/hooks.json'))).toBe(true);
            expect(existsSync(join(projectRoot, '.antigravity/cache.json'))).toBe(true);
            expect(existsSync(join(projectRoot, '.antigravity/memory.json'))).toBe(true);
          }
          if (adapter === 'gemini-cli') {
            // Gemini executes hooks from .gemini/settings.json; it must carry the
            // native `AfterAgent` completion hook so the ledger fires on Gemini too.
            const geminiSettings = readFileSync(join(projectRoot, '.gemini/settings.json'), 'utf8');
            expect(geminiSettings).toContain('"AfterAgent"');
            expect(geminiSettings).toContain('verification-record.mjs');
            expect(existsSync(join(projectRoot, '.gemini/cache.json'))).toBe(true);
            expect(existsSync(join(projectRoot, '.gemini/memory.json'))).toBe(true);
          }
          if (adapter === 'cursor') {
            expect(existsSync(join(projectRoot, '.cursor/rules/paqad.mdc'))).toBe(true);
            expect(existsSync(join(projectRoot, '.cursor/mcp.json'))).toBe(false);
            expect(existsSync(join(projectRoot, '.cursor/cache.json'))).toBe(true);
            expect(existsSync(join(projectRoot, '.cursor/memory.json'))).toBe(true);
          }
          if (adapter === 'github-copilot') {
            expect(existsSync(join(projectRoot, '.github/copilot-instructions.md'))).toBe(true);
            expect(existsSync(join(projectRoot, '.vscode/mcp.json'))).toBe(false);
          }
          if (adapter === 'windsurf') {
            expect(existsSync(join(projectRoot, '.windsurfrules'))).toBe(true);
            expect(existsSync(join(projectRoot, '.windsurf/mcp.json'))).toBe(false);
            expect(existsSync(join(projectRoot, '.windsurf/cache.json'))).toBe(true);
            expect(existsSync(join(projectRoot, '.windsurf/memory.json'))).toBe(true);
          }
          if (adapter === 'continue') {
            expect(existsSync(join(projectRoot, '.continue/rules/paqad.md'))).toBe(true);
            expect(existsSync(join(projectRoot, '.continue/mcp.json'))).toBe(false);
          }
          if (adapter === 'aider') {
            expect(existsSync(join(projectRoot, 'CONVENTIONS.md'))).toBe(true);
          }
          if (adapter === 'aiassistant') {
            // Soft, rules-only adapter (issue #219): a dedicated entry file under
            // .aiassistant/rules/, no MCP/hooks/cache/memory sidecars.
            expect(existsSync(join(projectRoot, '.aiassistant/rules/guidelines.md'))).toBe(true);
            expect(existsSync(join(projectRoot, '.aiassistant/mcp.json'))).toBe(false);
            expect(existsSync(join(projectRoot, '.aiassistant/hooks.json'))).toBe(false);
            expect(existsSync(join(projectRoot, '.aiassistant/cache.json'))).toBe(false);
            expect(existsSync(join(projectRoot, '.aiassistant/memory.json'))).toBe(false);
          }

          // Issue #622 — MCP suggestions live only in paqad's own file, written once when the
          // host speaks MCP; no host MCP path is ever written.
          expect(existsSync(join(projectRoot, '.paqad/mcp-recommendations.json'))).toBe(
            AdapterFactory.create(adapter).capabilities.mcp,
          );

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
}
