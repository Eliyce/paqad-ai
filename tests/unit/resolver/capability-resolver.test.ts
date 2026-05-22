import { resolveCapabilityDirectories } from '@/resolver/capability-resolver';

describe('resolveCapabilityDirectories', () => {
  it('keeps capabilities in declared order', () => {
    expect(
      resolveCapabilityDirectories('/runtime', 'laravel', ['inertia', 'react', 'boost'], 'rules'),
    ).toEqual([
      '/runtime/capabilities/coding/stacks/laravel/capabilities/inertia/rules',
      '/runtime/capabilities/coding/stacks/laravel/capabilities/react/rules',
      '/runtime/capabilities/coding/stacks/laravel/capabilities/boost/rules',
    ]);
  });

  it('resolves vue and tailwind capability directories', () => {
    expect(
      resolveCapabilityDirectories('/runtime', 'laravel', ['vue', 'tailwind'], 'rules'),
    ).toEqual([
      '/runtime/capabilities/coding/stacks/laravel/capabilities/vue/rules',
      '/runtime/capabilities/coding/stacks/laravel/capabilities/tailwind/rules',
    ]);
  });

  it('does not resolve react and vue simultaneously when only vue is selected', () => {
    const dirs = resolveCapabilityDirectories('/runtime', 'laravel', ['vue'], 'rules');
    expect(dirs).toEqual(['/runtime/capabilities/coding/stacks/laravel/capabilities/vue/rules']);
    expect(dirs).not.toContain(
      '/runtime/capabilities/coding/stacks/laravel/capabilities/react/rules',
    );
  });

  it('returns no directories for empty capabilities', () => {
    expect(resolveCapabilityDirectories('/runtime', 'flutter', [], 'skills')).toEqual([]);
  });
});
