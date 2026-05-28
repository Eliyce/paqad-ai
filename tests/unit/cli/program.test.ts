import { createProgram, normalizeCliArgv } from '@/cli/program';
import { VERSION } from '@/index';

describe('createProgram', () => {
  it('returns early when no command tokens need normalization', () => {
    const program = createProgram();

    expect(normalizeCliArgv(program, ['node', 'paqad-ai'])).toEqual({
      argv: ['node', 'paqad-ai'],
      notices: [],
    });
  });

  it('registers the expected commands', () => {
    const program = createProgram();
    expect(program.commands.map((command) => command.name())).toEqual([
      'install',
      'capabilities',
      'packs',
      'compliance',
      'dashboard',
      'doctor',
      'graph',
      'module-decisions',
      'module-health',
      'module-map',
      'onboard',
      'refresh',
      'rag',
      'update',
      'patterns',
      'plan',
      'status',
    ]);
  });

  it('exposes the package version', () => {
    expect(createProgram().version()).toBe(VERSION);
  });

  it('rewrites supported compatibility aliases before commander parses', () => {
    const program = createProgram();
    const result = normalizeCliArgv(program, [
      'node',
      'paqad-ai',
      'onboard',
      '--project-root',
      '/tmp/project',
      '--provider',
      'claude-code',
    ]);

    expect(result.argv).toEqual([
      'node',
      'paqad-ai',
      'onboard',
      '--project-root',
      '/tmp/project',
      '--providers',
      'claude-code',
    ]);
    expect(result.notices).toEqual([
      "warning: treating '--provider' as '--providers' for command 'onboard'",
    ]);
  });

  it('preserves inline option values when rewriting compatibility aliases', () => {
    const program = createProgram();
    const result = normalizeCliArgv(program, [
      'node',
      'paqad-ai',
      'onboard',
      '--project-root=/tmp/project',
      '--provider=claude-code',
    ]);

    expect(result.argv).toEqual([
      'node',
      'paqad-ai',
      'onboard',
      '--project-root=/tmp/project',
      '--providers=claude-code',
    ]);
    expect(result.notices).toEqual([
      "warning: treating '--provider' as '--providers' for command 'onboard'",
    ]);
  });

  it('drops unsupported options without changing valid positional arguments', () => {
    const program = createProgram();
    const listResult = normalizeCliArgv(program, [
      'node',
      'paqad-ai',
      'capabilities',
      'list',
      '--project-root',
      '/tmp/project',
      '--stack',
      'laravel',
    ]);
    const installResult = normalizeCliArgv(program, [
      'node',
      'paqad-ai',
      'packs',
      'install',
      '--dry-run',
      '/tmp/pack',
      '--scope',
      'project',
    ]);

    expect(listResult.argv).toEqual([
      'node',
      'paqad-ai',
      'capabilities',
      'list',
      '--project-root',
      '/tmp/project',
    ]);
    expect(listResult.notices).toEqual([
      "warning: ignoring unsupported option '--stack' for command 'capabilities list'",
    ]);

    expect(installResult.argv).toEqual([
      'node',
      'paqad-ai',
      'packs',
      'install',
      '/tmp/pack',
      '--scope',
      'project',
    ]);
    expect(installResult.notices).toEqual([
      "warning: ignoring unsupported option '--dry-run' for command 'packs install'",
    ]);
  });

  it('preserves built-in help, variadic values, and passthrough arguments', () => {
    const program = createProgram();

    expect(normalizeCliArgv(program, ['node', 'paqad-ai', '--help'])).toEqual({
      argv: ['node', 'paqad-ai', '--help'],
      notices: [],
    });

    expect(
      normalizeCliArgv(program, [
        'node',
        'paqad-ai',
        'onboard',
        '--providers',
        'codex-cli',
        'claude-code',
        '--',
        '--literal-provider',
      ]),
    ).toEqual({
      argv: [
        'node',
        'paqad-ai',
        'onboard',
        '--providers',
        'codex-cli',
        'claude-code',
        '--',
        '--literal-provider',
      ],
      notices: [],
    });

    expect(
      normalizeCliArgv(program, [
        'node',
        'paqad-ai',
        'onboard',
        '--providers=codex-cli',
        '--project-root=/tmp/project',
      ]),
    ).toEqual({
      argv: ['node', 'paqad-ai', 'onboard', '--providers=codex-cli', '--project-root=/tmp/project'],
      notices: [],
    });
  });

  it('keeps following options or trailing tokens when unsupported options should not consume them', () => {
    const program = createProgram();

    expect(
      normalizeCliArgv(program, [
        'node',
        'paqad-ai',
        'capabilities',
        'list',
        '--unknown',
        '--project-root',
        '/tmp/project',
      ]),
    ).toEqual({
      argv: ['node', 'paqad-ai', 'capabilities', 'list', '--project-root', '/tmp/project'],
      notices: ["warning: ignoring unsupported option '--unknown' for command 'capabilities list'"],
    });

    expect(
      normalizeCliArgv(program, ['node', 'paqad-ai', 'capabilities', 'list', '--unknown']),
    ).toEqual({
      argv: ['node', 'paqad-ai', 'capabilities', 'list'],
      notices: ["warning: ignoring unsupported option '--unknown' for command 'capabilities list'"],
    });
  });
});
