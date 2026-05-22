import {
  buildDetectedStackProfile,
  compareStackProfiles,
  getPrimaryStack,
} from '@/core/stack-profile';

describe('stack profile drift', () => {
  it('treats the first resolved framework as the primary stack for newly shipped packs', () => {
    expect(
      getPrimaryStack({
        active_capabilities: ['content', 'coding', 'security'],
        stack_profile: {
          frameworks: ['django', 'react'],
          traits: [],
          toolchains: [],
          version_bands: [],
          sources: [],
        },
      }),
    ).toBe('django');
  });

  it('treats environment trait changes as material drift', () => {
    const previous = buildDetectedStackProfile({
      domain: 'coding',
      toolchains: [{ ecosystem: 'php', package_manager: 'composer', lockfile: 'composer.lock' }],
      packages: [
        {
          name: 'laravel/framework',
          version_constraint: '^12.0',
          locked_version: '12.1.0',
          ecosystem: 'php',
          is_dev: false,
        },
      ],
      sources: [{ file: 'composer.json', kind: 'manifest', detail: 'Detected laravel framework' }],
      detectedTraits: ['compose'],
    });

    const current = buildDetectedStackProfile({
      domain: 'coding',
      toolchains: [{ ecosystem: 'php', package_manager: 'composer', lockfile: 'composer.lock' }],
      packages: [
        {
          name: 'laravel/framework',
          version_constraint: '^12.0',
          locked_version: '12.1.0',
          ecosystem: 'php',
          is_dev: false,
        },
        {
          name: 'laravel/sail',
          version_constraint: '^1.0',
          locked_version: '1.34.0',
          ecosystem: 'php',
          is_dev: false,
        },
      ],
      sources: [
        { file: 'composer.json', kind: 'manifest', detail: 'Detected laravel framework' },
        {
          file: 'compose.yaml',
          kind: 'config',
          detail: 'Detected docker compose environment from compose configuration',
        },
      ],
      detectedTraits: ['compose', 'sail'],
    });

    const drift = compareStackProfiles(previous, current);

    expect(drift.status).toBe('drift-detected');
    expect(drift.material_changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'trait-added', key: 'sail', after: 'sail' }),
      ]),
    );
    expect(drift.review_targets).toContain('docs/instructions/stack/**');
    expect(drift.review_targets).toContain('docs/instructions/tools/**');
  });
});
