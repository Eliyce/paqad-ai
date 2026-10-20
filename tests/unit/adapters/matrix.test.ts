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

        const adaptersWithExtraConfigFile = ['claude-code', 'codex-cli', 'gemini-cli'];
        const attributionConfigFiles = adapterType === 'aider' ? 1 : 0;
        const extraConfigFiles =
          (adaptersWithExtraConfigFile.includes(adapterType) ? 2 : 0) + attributionConfigFiles;
        const expectedLength =
          1 +
          extraConfigFiles +
          (adapter.capabilities.skills ? skillArtifacts.length : 0) +
          Number(adapter.capabilities.agents) +
          Number(adapter.capabilities.hooks) +
          Number(adapter.capabilities.caching) +
          Number(adapter.capabilities.memory);

        expect(files).toHaveLength(expectedLength);

        expect(files.some((file) => file.path.includes('mcp'))).toBe(false);

        const hasJsonCapability =
          adapter.capabilities.caching || adapter.capabilities.memory || adapter.capabilities.hooks;
        if (hasJsonCapability) {
          expect(files.map((file) => file.path).some((path) => path.includes('.json'))).toBe(true);
        }

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
