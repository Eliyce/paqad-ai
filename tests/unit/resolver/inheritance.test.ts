import { getInheritanceDirectories } from '@/resolver/inheritance';

describe('getInheritanceDirectories', () => {
  it('builds capability and pack inheritance in order', () => {
    const directories = getInheritanceDirectories(
      '/runtime',
      {
        active_capabilities: ['content', 'coding', 'security'],
        matched_packs: ['laravel', 'react'],
        capabilities: ['inertia', 'react'],
      },
      'rules',
    );

    expect(directories.map((directory) => directory.path)).toEqual([
      '/runtime/base/rules',
      '/runtime/capabilities/content/rules',
      '/runtime/capabilities/coding/rules',
      '/runtime/capabilities/coding/stacks/_shared/rules',
      '/runtime/capabilities/coding/stacks/laravel/rules',
      '/runtime/capabilities/coding/stacks/react/rules',
      '/runtime/capabilities/coding/stacks/laravel/capabilities/inertia/rules',
      '/runtime/capabilities/coding/stacks/laravel/capabilities/react/rules',
      '/runtime/capabilities/coding/stacks/react/capabilities/inertia/rules',
      '/runtime/capabilities/coding/stacks/react/capabilities/react/rules',
      '/runtime/capabilities/security/rules',
    ]);
    expect(directories.map((directory) => directory.level)).toEqual([
      0, 1, 2, 3, 4, 5, 5, 5, 5, 5, 6,
    ]);
  });

  it('supports content-only inheritance without content stack directories', () => {
    const directories = getInheritanceDirectories(
      '/runtime',
      {
        active_capabilities: ['content'],
      },
      'rules',
    );

    expect(directories.map((directory) => directory.path)).toEqual([
      '/runtime/base/rules',
      '/runtime/capabilities/content/rules',
    ]);
  });

  it('supports standalone react stack inheritance without laravel capability paths', () => {
    const directories = getInheritanceDirectories(
      '/runtime',
      {
        active_capabilities: ['content', 'coding', 'security'],
        matched_packs: ['react'],
        capabilities: ['next'],
      },
      'rules',
    );

    expect(directories.map((directory) => directory.path)).toEqual([
      '/runtime/base/rules',
      '/runtime/capabilities/content/rules',
      '/runtime/capabilities/coding/rules',
      '/runtime/capabilities/coding/stacks/_shared/rules',
      '/runtime/capabilities/coding/stacks/react/rules',
      '/runtime/capabilities/coding/stacks/react/capabilities/next/rules',
      '/runtime/capabilities/security/rules',
    ]);
  });
});
