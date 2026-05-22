import { checkbox, select } from '@inquirer/prompts';

import {
  getStackPromptChoices,
  renderStackConfirmationSummary,
  resolveSelections,
} from '@/onboarding/prompts';

vi.mock('@inquirer/prompts', () => ({
  checkbox: vi.fn(),
  select: vi.fn(),
}));

const mockCheckbox = vi.mocked(checkbox);
const mockSelect = vi.mocked(select);

const emptyDetection = {
  detected_domain: null as null,
  detected_stack: null as null,
  detected_capabilities: [] as never[],
  confidence: 'low' as const,
  signals: [] as never[],
  timestamp: new Date().toISOString(),
};

const laravelDetection = {
  detected_domain: 'coding' as const,
  detected_stack: 'laravel' as const,
  detected_capabilities: [] as never[],
  confidence: 'high' as const,
  signals: [] as never[],
  timestamp: new Date().toISOString(),
};

describe('resolveSelections (non-interactive)', () => {
  beforeEach(() => {
    mockCheckbox.mockReset();
    mockSelect.mockReset();
    setInteractive(false);
  });

  it('defaults empty projects to content-only onboarding', async () => {
    const result = await resolveSelections(emptyDetection, {
      stack: 'short-video',
      capabilities: [],
      providers: [],
    });
    expect(result.domain).toBe('content');
  });

  it('defaults providers to claude-code when not specified', async () => {
    const result = await resolveSelections(emptyDetection, undefined);
    expect(result.providers).toEqual(['claude-code']);
    expect(result.domain).toBe('content');
    expect(result.stack).toBe('short-video');
  });

  it('uses detected coding stack when snapshot traits exist but frameworks are empty', async () => {
    const result = await resolveSelections(
      {
        ...emptyDetection,
        detected_domain: 'coding',
        detected_stack: 'node-cli',
        detected_capabilities: ['typescript', 'vitest'] as never[],
      },
      {
        toolchains: [{ ecosystem: 'node', package_manager: 'pnpm', lockfile: 'pnpm-lock.yaml' }],
        packages: [
          {
            name: 'commander',
            version_constraint: '^12.0.0',
            locked_version: '12.0.0',
            ecosystem: 'node',
            is_dev: false,
          },
        ],
        profile: {
          domain: 'coding',
          frameworks: [],
          traits: ['typescript', 'vitest'],
          toolchains: [{ ecosystem: 'node', package_manager: 'pnpm', lockfile: 'pnpm-lock.yaml' }],
          version_bands: [],
          sources: [{ file: 'package.json', kind: 'manifest', detail: 'Node manifest' }],
        },
      },
    );

    expect(result.domain).toBe('coding');
    expect(result.stack).toBe('node-cli');
    expect(result.stack_profile.frameworks).toContain('node-cli');
    expect(result.stack_profile.traits).toEqual(expect.arrayContaining(['typescript', 'vitest']));
    expect(result.stack_profile.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ file: 'package.json', kind: 'manifest' }),
        expect.objectContaining({ file: 'interactive-onboarding', kind: 'fallback' }),
      ]),
    );
  });

  it('does not duplicate the interactive fallback source when rebuilding a fallback profile', async () => {
    const result = await resolveSelections(
      {
        ...emptyDetection,
        detected_domain: 'coding',
        detected_stack: 'node-cli',
        detected_capabilities: ['typescript'] as never[],
      },
      {
        toolchains: [{ ecosystem: 'node', package_manager: 'pnpm', lockfile: 'pnpm-lock.yaml' }],
        packages: [],
        profile: {
          domain: 'coding',
          frameworks: [],
          traits: ['typescript'],
          toolchains: [{ ecosystem: 'node', package_manager: 'pnpm', lockfile: 'pnpm-lock.yaml' }],
          version_bands: [],
          sources: [
            { file: 'package.json', kind: 'manifest', detail: 'Node manifest' },
            {
              file: 'interactive-onboarding',
              kind: 'fallback',
              detail: 'User-selected fallback stack profile',
            },
          ],
        },
      },
    );

    expect(
      result.stack_profile.sources.filter(
        (source) =>
          source.file === 'interactive-onboarding' &&
          source.kind === 'fallback' &&
          source.detail === 'User-selected fallback stack profile',
      ),
    ).toHaveLength(1);
  });

  it('throws for environment-only coding repos without an explicit stack', async () => {
    await expect(
      resolveSelections(
        {
          ...emptyDetection,
          detected_capabilities: ['compose'] as never[],
          signals: [
            {
              signal: 'compose file exists',
              file: 'compose.yaml',
              implies: 'compose',
              confidence: 'high',
            },
          ] as never[],
        },
        {
          toolchains: [],
          packages: [],
          profile: {
            domain: 'coding',
            frameworks: [],
            traits: ['compose'],
            toolchains: [],
            version_bands: [],
            sources: [
              {
                file: 'compose.yaml',
                kind: 'config',
                detail: 'Detected docker compose environment from compose configuration',
              },
            ],
          },
        },
      ),
    ).rejects.toThrow('--capability docker and/or --capability compose');
  });

  it('throws for coding repos with traits but no resolved stack', async () => {
    await expect(
      resolveSelections(
        {
          ...emptyDetection,
          detected_domain: 'coding',
          detected_capabilities: ['typescript', 'vitest'] as never[],
        },
        {
          toolchains: [{ ecosystem: 'node', package_manager: 'pnpm', lockfile: 'pnpm-lock.yaml' }],
          packages: [],
          profile: {
            domain: 'coding',
            frameworks: [],
            traits: ['typescript', 'vitest'],
            toolchains: [
              { ecosystem: 'node', package_manager: 'pnpm', lockfile: 'pnpm-lock.yaml' },
            ],
            version_bands: [],
            sources: [],
          },
        },
      ),
    ).rejects.toThrow('Detected coding signals without a resolved stack');
  });

  it('uses exactly the specified providers', async () => {
    const result = await resolveSelections(laravelDetection, {
      providers: ['junie'],
      stack: 'laravel',
      capabilities: [],
    });
    expect(result.providers).toEqual(['junie']);
  });

  it('allows multiple providers', async () => {
    const result = await resolveSelections(laravelDetection, {
      providers: ['codex-cli', 'antigravity', 'gemini-cli'],
      stack: 'laravel',
      capabilities: [],
    });
    expect(result.providers).toEqual(['codex-cli', 'antigravity', 'gemini-cli']);
  });

  it('selects flutter stack with no capabilities', async () => {
    const result = await resolveSelections(emptyDetection, {
      providers: ['claude-code'],
      stack: 'flutter',
      capabilities: [],
    });
    expect(result.stack).toBe('flutter');
    expect(result.capabilities).toEqual([]);
  });

  it('selects react stack with sub-stack capability', async () => {
    const result = await resolveSelections(emptyDetection, {
      providers: ['claude-code'],
      stack: 'react',
      capabilities: ['next'],
    });
    expect(result.stack).toBe('react');
    expect(result.capabilities).toEqual(['next']);
  });

  it('selects vue stack with sub-stack and tailwind capabilities', async () => {
    const result = await resolveSelections(emptyDetection, {
      providers: ['claude-code'],
      stack: 'vue',
      capabilities: ['nuxt', 'tailwind'],
    });
    expect(result.stack).toBe('vue');
    expect(result.capabilities).toEqual(['nuxt', 'tailwind']);
  });

  it('allows newly shipped coding stacks through manual overrides', async () => {
    const result = await resolveSelections(emptyDetection, {
      providers: ['claude-code'],
      stack: 'django',
      capabilities: [],
    });
    expect(result.stack).toBe('django');
    expect(result.domain).toBe('coding');
    expect(result.capabilities).toEqual([]);
  });

  it('selects laravel with react capability', async () => {
    const result = await resolveSelections(laravelDetection, {
      providers: ['claude-code'],
      stack: 'laravel',
      capabilities: ['react'],
    });
    expect(result.stack).toBe('laravel');
    expect(result.capabilities).toContain('react');
    expect(result.capabilities).not.toContain('vue');
  });

  it('selects laravel with vue capability', async () => {
    const result = await resolveSelections(laravelDetection, {
      providers: ['claude-code'],
      stack: 'laravel',
      capabilities: ['vue'],
    });
    expect(result.capabilities).toContain('vue');
    expect(result.capabilities).not.toContain('react');
  });

  it('selects laravel with tailwind capability', async () => {
    const result = await resolveSelections(laravelDetection, {
      providers: ['claude-code'],
      stack: 'laravel',
      capabilities: ['tailwind'],
    });
    expect(result.capabilities).toContain('tailwind');
  });

  it('selects plain laravel with no capabilities', async () => {
    const result = await resolveSelections(laravelDetection, {
      providers: ['claude-code'],
      stack: 'laravel',
      capabilities: [],
    });
    expect(result.stack).toBe('laravel');
    expect(result.capabilities).toEqual([]);
  });

  it('allows inertia, vue, tailwind, and boost together', async () => {
    const result = await resolveSelections(laravelDetection, {
      providers: ['claude-code'],
      stack: 'laravel',
      capabilities: ['inertia', 'vue', 'tailwind', 'boost'],
    });
    expect(result.capabilities).toEqual(['inertia', 'vue', 'tailwind', 'boost']);
  });
});

describe('resolveSelections (interactive)', () => {
  beforeEach(() => {
    mockCheckbox.mockReset();
    mockSelect.mockReset();
    setInteractive(true);
  });

  afterEach(() => {
    setInteractive(false);
  });

  it('requires confirmation even for confident detected stacks', async () => {
    mockCheckbox.mockResolvedValueOnce(['codex-cli']);
    mockSelect.mockResolvedValueOnce('continue');

    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    const result = await resolveSelections(laravelDetection, {
      toolchains: [{ ecosystem: 'php', package_manager: 'composer', lockfile: 'composer.lock' }],
      packages: [
        {
          name: 'laravel/framework',
          version_constraint: '^12.0',
          locked_version: 'v12.1.0',
          ecosystem: 'php',
          is_dev: false,
        },
      ],
      profile: {
        domain: 'coding',
        frameworks: ['laravel'],
        traits: ['docker', 'tailwind'],
        toolchains: [{ ecosystem: 'php', package_manager: 'composer', lockfile: 'composer.lock' }],
        version_bands: [
          {
            name: 'laravel/framework:^12',
            package_name: 'laravel/framework',
            range: '^12',
            locked_version: 'v12.1.0',
            source: 'lockfile',
          },
        ],
        sources: [{ file: 'composer.json', kind: 'manifest', detail: 'Composer manifest' }],
      },
    });

    expect(result.stack).toBe('laravel');
    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining('Detected stack summary'));
    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining('Primary stack: laravel'));
    writeSpy.mockRestore();
  });

  it('uses the detected archetype stack during interactive confirmation when snapshot frameworks are empty', async () => {
    mockCheckbox.mockResolvedValueOnce(['codex-cli']);
    mockSelect.mockResolvedValueOnce('continue');

    const result = await resolveSelections(
      {
        ...emptyDetection,
        detected_domain: 'coding',
        detected_stack: 'node-cli',
        detected_capabilities: ['typescript', 'vitest'] as never[],
        confidence: 'high' as const,
      },
      {
        toolchains: [{ ecosystem: 'node', package_manager: 'pnpm', lockfile: 'pnpm-lock.yaml' }],
        packages: [
          {
            name: 'commander',
            version_constraint: '^12.0.0',
            locked_version: '12.0.0',
            ecosystem: 'node',
            is_dev: false,
          },
        ],
        profile: {
          domain: 'coding',
          frameworks: [],
          traits: ['typescript', 'vitest'],
          toolchains: [{ ecosystem: 'node', package_manager: 'pnpm', lockfile: 'pnpm-lock.yaml' }],
          version_bands: [],
          sources: [],
        },
      },
    );

    expect(result.stack).toBe('node-cli');
    expect(result.stack_profile.frameworks).toEqual(['node-cli']);
    expect(result.stack_profile.traits).toEqual(expect.arrayContaining(['typescript', 'vitest']));
    expect(result.capabilities).toEqual(expect.arrayContaining(['typescript', 'vitest']));
  });

  it('offers the full shipped coding stack set during manual interactive selection', () => {
    expect(getStackPromptChoices('coding').map((choice) => choice.value)).toEqual([
      'laravel',
      'flutter',
      'react',
      'vue',
      'django',
      'fastapi',
      'rails',
      'spring-boot',
      'express',
      'angular',
      'svelte',
      'astro',
      'go-web',
      'rust-web',
      'dotnet',
      'nextjs',
      'flask',
      'nestjs',
      'kotlin-android',
    ]);
  });

  it('allows revising selections before continuing', async () => {
    mockCheckbox.mockResolvedValue(['claude-code']);
    mockSelect
      .mockResolvedValueOnce('django')
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce('revise')
      .mockResolvedValueOnce('flutter')
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce('continue');

    const result = await resolveSelections({
      ...emptyDetection,
      recommended_capabilities: ['coding'] as never[],
    });

    expect(result.domain).toBe('coding');
    expect(result.stack).toBe('flutter');
    expect(mockSelect).toHaveBeenCalledTimes(6);
  });

  it('skips confirmation for content-only onboarding', async () => {
    mockCheckbox.mockResolvedValueOnce(['codex-cli']);

    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    const result = await resolveSelections(emptyDetection);

    expect(result.domain).toBe('content');
    expect(result.stack).toBe('short-video');
    expect(mockSelect).not.toHaveBeenCalled();
    expect(writeSpy).not.toHaveBeenCalled();
    writeSpy.mockRestore();
  });

  it('aborts before onboarding continues when confirmation is rejected', async () => {
    mockCheckbox.mockResolvedValueOnce(['junie']);
    mockSelect
      .mockResolvedValueOnce('django')
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce('abort');

    await expect(
      resolveSelections({
        ...emptyDetection,
        recommended_capabilities: ['coding'] as never[],
      }),
    ).rejects.toThrow('Onboarding cancelled before confirmation.');
  });

  it('collects Docker and Compose traits for flutter during manual selection', async () => {
    mockCheckbox.mockResolvedValueOnce(['claude-code']);
    mockSelect
      .mockResolvedValueOnce('flutter')
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce('continue');

    const result = await resolveSelections({
      ...emptyDetection,
      recommended_capabilities: ['coding'] as never[],
    });

    expect(result.domain).toBe('coding');
    expect(result.stack).toBe('flutter');
    expect(result.capabilities).toEqual(['docker', 'compose']);
  });

  it('collects stack traits plus container traits for react during manual selection', async () => {
    mockCheckbox.mockResolvedValueOnce(['claude-code']);
    mockSelect
      .mockResolvedValueOnce('react')
      .mockResolvedValueOnce('next')
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce('continue');

    const result = await resolveSelections({
      ...emptyDetection,
      recommended_capabilities: ['coding'] as never[],
    });

    expect(result.stack).toBe('react');
    expect(result.capabilities).toEqual(['next', 'tailwind', 'docker', 'compose']);
  });

  it('offers generic container prompts for stacks without custom capability dialogs', async () => {
    mockCheckbox.mockResolvedValueOnce(['claude-code']);
    mockSelect
      .mockResolvedValueOnce('django')
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce('continue');

    const result = await resolveSelections({
      ...emptyDetection,
      recommended_capabilities: ['coding'] as never[],
    });

    expect(result.stack).toBe('django');
    expect(result.capabilities).toEqual(['docker']);
  });

  it('collects full Laravel capability set with Sail during manual selection', async () => {
    mockCheckbox.mockResolvedValueOnce(['claude-code']);
    mockSelect
      .mockResolvedValueOnce('laravel') // stack
      .mockResolvedValueOnce(true) // inertia = yes
      .mockResolvedValueOnce('react') // frontend = react
      .mockResolvedValueOnce(true) // tailwind = yes
      .mockResolvedValueOnce(true) // boost = yes
      .mockResolvedValueOnce('pest') // testing = pest
      .mockResolvedValueOnce(true) // sail = yes
      .mockResolvedValueOnce('continue'); // confirmation

    const result = await resolveSelections({
      ...emptyDetection,
      recommended_capabilities: ['coding'] as never[],
    });

    expect(result.stack).toBe('laravel');
    expect(result.capabilities).toEqual(['inertia', 'react', 'tailwind', 'boost', 'pest', 'sail']);
  });

  it('collects Laravel capabilities with docker and compose when no Sail', async () => {
    mockCheckbox.mockResolvedValueOnce(['claude-code']);
    mockSelect
      .mockResolvedValueOnce('laravel') // stack
      .mockResolvedValueOnce(false) // inertia = no
      .mockResolvedValueOnce('none') // frontend = none
      .mockResolvedValueOnce(false) // tailwind = no
      .mockResolvedValueOnce(false) // boost = no
      .mockResolvedValueOnce('phpunit') // testing = phpunit
      .mockResolvedValueOnce(false) // sail = no
      .mockResolvedValueOnce(true) // docker = yes
      .mockResolvedValueOnce(true) // compose = yes
      .mockResolvedValueOnce('continue'); // confirmation

    const result = await resolveSelections({
      ...emptyDetection,
      recommended_capabilities: ['coding'] as never[],
    });

    expect(result.stack).toBe('laravel');
    expect(result.capabilities).toEqual(['phpunit', 'docker', 'compose']);
  });
});

describe('renderStackConfirmationSummary', () => {
  it('shows detected and final choices when overrides differ', () => {
    const summary = renderStackConfirmationSummary(
      laravelDetection,
      {
        toolchains: [{ ecosystem: 'node', package_manager: 'pnpm', lockfile: 'pnpm-lock.yaml' }],
        packages: [
          {
            name: 'react',
            version_constraint: '^19.0.0',
            locked_version: '19.0.0',
            ecosystem: 'node',
            is_dev: false,
          },
        ],
        profile: {
          domain: 'coding',
          frameworks: ['laravel'],
          traits: [],
          toolchains: [{ ecosystem: 'node', package_manager: 'pnpm', lockfile: 'pnpm-lock.yaml' }],
          version_bands: [],
          sources: [],
        },
      },
      {
        providers: ['codex-cli'],
        domain: 'coding',
        stack: 'react',
        capabilities: ['next'],
        stack_profile: {
          domain: 'coding',
          frameworks: ['react'],
          traits: ['next'],
          toolchains: [{ ecosystem: 'node', package_manager: 'pnpm', lockfile: 'pnpm-lock.yaml' }],
          version_bands: [],
          sources: [{ file: 'package.json', kind: 'manifest', detail: 'NPM manifest' }],
        },
      },
    );

    expect(summary).toContain('Detected choice: coding / laravel');
    expect(summary).toContain('Final effective choice: coding / react');
    expect(summary).toContain('Traits/capabilities: next');
  });
});

function setInteractive(value: boolean): void {
  Object.defineProperty(process.stdout, 'isTTY', { value, configurable: true });
  Object.defineProperty(process.stdin, 'isTTY', { value, configurable: true });
}
