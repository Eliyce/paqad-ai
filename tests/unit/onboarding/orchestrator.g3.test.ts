import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { posix } from 'node:path';

const { join } = posix;

import { PATHS } from '@/core/constants/paths.js';
import { getRuntimeRoot } from '@/core/runtime-paths';
import { OnboardingOrchestrator } from '@/onboarding';

import { useOrchestratorSandbox } from './orchestrator-harness.js';

describe('OnboardingOrchestrator', () => {
  let projectRoot: string;
  let frameworkHome: string;

  useOrchestratorSandbox((sandbox) => {
    ({ projectRoot, frameworkHome } = sandbox);
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

  describe('MCP files', () => {
    const userOwned = (name: string): string =>
      `${JSON.stringify({ mcpServers: { [name]: { command: 'npx', args: [name] } } }, null, 2)}\n`;

    function put(path: string, content: string): void {
      mkdirSync(join(projectRoot, posix.dirname(path)), { recursive: true });
      writeFileSync(join(projectRoot, path), content);
    }

    it('leaves user-owned MCP files byte-identical and deletes paqad-written ones (AC-5, AC-6)', async () => {
      const fixtures = new Map([
        ['.cursor/mcp.json', userOwned('cursor-server')],
        ['.vscode/mcp.json', userOwned('vscode-server')],
        ['.junie/mcp/mcp.json', userOwned('junie-server')],
      ]);
      for (const [path, content] of fixtures) {
        put(path, content);
      }
      put(
        '.windsurf/mcp.json',
        JSON.stringify({ mcpServers: { figma: { enabled: true } }, resolved_artifacts: [] }),
      );

      await new OnboardingOrchestrator().run({
        projectRoot,
        selections: {
          domain: 'coding',
          stack: 'laravel',
          capabilities: ['boost'],
          providers: ['cursor', 'github-copilot', 'junie'],
        },
      });

      for (const [path, content] of fixtures) {
        expect(readFileSync(join(projectRoot, path), 'utf8')).toBe(content);
      }
      expect(existsSync(join(projectRoot, '.windsurf/mcp.json'))).toBe(false);
      expect(existsSync(join(projectRoot, PATHS.MCP_CLEANUP_LOG))).toBe(false);
    });

    it('writes one recommendations file with only suggestion fields (AC-9)', async () => {
      const output = await new OnboardingOrchestrator().run({
        projectRoot,
        selections: {
          domain: 'coding',
          stack: 'laravel',
          capabilities: ['boost'],
          providers: ['claude-code', 'cursor'],
        },
      });

      expect(
        output.generated_files.filter((path) => path === PATHS.MCP_RECOMMENDATIONS),
      ).toHaveLength(1);
      const parsed = JSON.parse(
        readFileSync(join(projectRoot, PATHS.MCP_RECOMMENDATIONS), 'utf8'),
      ) as { servers: Array<Record<string, unknown>> };
      expect(parsed.servers.map((server) => server.name)).toContain('laravel-boost');
      for (const server of parsed.servers) {
        expect(Object.keys(server).sort()).toEqual(['name', 'provides', 'replaces', 'why']);
      }
      expect(existsSync(join(projectRoot, '.claude/settings.mcp.json'))).toBe(false);
      expect(existsSync(join(projectRoot, '.cursor/mcp.json'))).toBe(false);
    });

    it('writes no recommendations file when no selected host speaks MCP', async () => {
      await new OnboardingOrchestrator().run({
        projectRoot,
        selections: { domain: 'coding', stack: 'laravel', capabilities: [], providers: ['aider'] },
      });

      expect(existsSync(join(projectRoot, PATHS.MCP_RECOMMENDATIONS))).toBe(false);
    });
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
    expect(existsSync(join(projectRoot, '.antigravity/mcp.json'))).toBe(false);
    expect(existsSync(join(projectRoot, '.paqad/mcp-recommendations.json'))).toBe(true);
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
});
