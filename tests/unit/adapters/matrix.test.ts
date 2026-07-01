import { AdapterFactory } from '@/adapters/index.js';
import { fixtureArtifact, fixtureProfile, fixtureSkillBundleArtifacts } from './shared.fixture.js';

const adapters = [
  'claude-code',
  'codex-cli',
  'antigravity',
  'gemini-cli',
  'junie',
  'cursor',
  'github-copilot',
  'windsurf',
  'continue',
  'aider',
  'aiassistant',
] as const;
const stacks = ['laravel', 'flutter'] as const;

describe('adapter stack matrix', () => {
  for (const adapterType of adapters) {
    for (const stack of stacks) {
      it(`renders ${adapterType} outputs for ${stack}`, async () => {
        const adapter = AdapterFactory.create(adapterType);
        const profile = fixtureProfile(stack);
        const files = [
          ...(await adapter.generateConfig({
            frameworkPath: '.paqad/framework-path.txt',
            rulesPath: 'docs/instructions/rules',
            projectRoot: '/tmp/project',
          })),
        ];
        const skillArtifacts = fixtureSkillBundleArtifacts();

        if (adapter.capabilities.skills) {
          files.push(...(await adapter.generateSkills(skillArtifacts)));
        }

        if (adapter.capabilities.agents) {
          files.push(...(await adapter.generateAgents([fixtureArtifact('sample-agent.md')])));
        }

        if (adapter.capabilities.hooks) {
          files.push(...(await adapter.installHooks([fixtureArtifact('sample-agent.md')])));
        }

        if (adapter.capabilities.mcp) {
          files.push(...(await adapter.installMcp([], profile)));
        }

        if (adapter.capabilities.caching) {
          files.push(...(await adapter.configureCaching(profile)));
        }

        if (adapter.capabilities.memory) {
          files.push(...(await adapter.configureMemory(profile)));
        }

        // Some adapters emit extra files from generateConfig alongside their entry
        // file: Claude Code writes .claude/settings.json (agent-entry gate); Codex
        // and Gemini write their native completion-hook file (.codex/hooks.json /
        // .gemini/settings.json) so the evidence ledger fires on every host. Each of
        // these three ALSO emits a nested .gitignore marking that per-machine hook
        // config git-ignored (issue #240) — so two extra files, not one.
        const adaptersWithExtraConfigFile = ['claude-code', 'codex-cli', 'gemini-cli'];
        const extraConfigFiles = adaptersWithExtraConfigFile.includes(adapterType) ? 2 : 0;
        const expectedLength =
          1 +
          extraConfigFiles +
          (adapter.capabilities.skills ? skillArtifacts.length : 0) +
          Number(adapter.capabilities.agents) +
          Number(adapter.capabilities.hooks) +
          Number(adapter.capabilities.mcp) +
          Number(adapter.capabilities.caching) +
          Number(adapter.capabilities.memory);

        expect(files).toHaveLength(expectedLength);

        const hasJsonCapability =
          adapter.capabilities.mcp ||
          adapter.capabilities.caching ||
          adapter.capabilities.memory ||
          adapter.capabilities.hooks;
        if (hasJsonCapability) {
          expect(files.map((file) => file.path).some((path) => path.includes('.json'))).toBe(true);
        }

        // The config file is always files[0] regardless of its extension or path.
        // Entry files are now lean bootstrap stubs: a one-line pointer to the
        // framework bootstrap and the Adapter footer, with no load steps,
        // workflow prose, or embedded contracts.
        const configFile = files[0];
        expect(configFile?.content).toContain('.paqad/framework-path.txt');
        expect(configFile?.content).toContain('AGENT-BOOTSTRAP.md');
        expect(configFile?.content).toContain('Adapter:');
        expect(configFile?.content).not.toContain('docs/instructions');
        expect(configFile?.content).not.toContain('create documentation');
      });
    }
  }
});
