import {
  buildAgentConfigContext,
  buildApiDocContext,
  buildDesignSystemContext,
  buildErrorCatalogContext,
  buildIntegrationDocContext,
  buildModuleScaffoldContext,
  buildRegistryContext,
  buildRunnerScriptContext,
} from '@/templates';

describe('template context builders', () => {
  it('builds the agent config context', () => {
    expect(
      buildAgentConfigContext({
        adapter: 'codex-cli',
        frameworkPath: '.paqad/framework-path.txt',
        rulesPath: 'docs/rules',
      }),
    ).toEqual({
      adapter: 'codex-cli',
      frameworkPath: '.paqad/framework-path.txt',
      rulesPath: 'docs/rules',
    });
  });

  it('builds module and documentation contexts', () => {
    expect(buildModuleScaffoldContext('user-profile')).toEqual({
      moduleName: 'user-profile',
      title: 'user profile',
    });
    expect(buildApiDocContext('users')).toEqual({ moduleName: 'users' });
    expect(buildIntegrationDocContext('users')).toEqual({ moduleName: 'users' });
    expect(buildErrorCatalogContext('users')).toEqual({ moduleName: 'users' });
  });

  it('builds project-wide contexts', () => {
    expect(buildDesignSystemContext('Demo')).toEqual({ projectName: 'Demo' });
    expect(
      buildRunnerScriptContext({
        projectName: 'Demo',
        commands: {
          test: 'pnpm test',
          lint: 'pnpm lint',
          format: 'pnpm format',
        },
        routing: {
          stack: 'laravel',
        },
      }),
    ).toEqual({
      projectName: 'Demo',
      commands: {
        test: 'pnpm test',
        lint: 'pnpm lint',
        format: 'pnpm format',
      },
      routing: {
        stack: 'laravel',
      },
    });
    expect(buildRegistryContext('module-registry')).toEqual({
      name: 'module-registry',
    });
  });
});
