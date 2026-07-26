import { describe, expect, it } from 'vitest';

import { jvmFrameworkApiAdapter } from '@/framework-api/adapters/jvm.js';
import { nodeFrameworkApiAdapter } from '@/framework-api/adapters/node.js';
import { phpFrameworkApiAdapter } from '@/framework-api/adapters/php.js';
import { pythonFrameworkApiAdapter } from '@/framework-api/adapters/python.js';
import { createDefaultFrameworkApiAdapterRegistry } from '@/framework-api/adapters/registry.js';
import {
  DYNAMIC_MEMBER_SUFFIX,
  containerOf,
  dynamicRecord,
  lastNameSegment,
} from '@/framework-api/adapters/shared.js';

describe('lastNameSegment', () => {
  it('splits on the separators every indexed ecosystem uses', () => {
    expect(lastNameSegment('Component.render')).toBe('render');
    expect(lastNameSegment('Cache::get')).toBe('get');
    expect(lastNameSegment('Illuminate\\Support\\Str')).toBe('Str');
    expect(lastNameSegment('Illuminate\\Support\\Str::random')).toBe('random');
  });

  it('returns an unqualified name unchanged', () => {
    expect(lastNameSegment('useId')).toBe('useId');
  });
});

describe('containerOf', () => {
  it('returns the qualifying prefix, or null when there is none', () => {
    expect(containerOf('Illuminate\\Support\\Str::random')).toBe('Illuminate\\Support\\Str');
    expect(containerOf('Component.render')).toBe('Component');
    expect(containerOf('useId')).toBeNull();
  });
});

describe('dynamicRecord', () => {
  it('marks the container open-ended, never absent (INV-1)', () => {
    expect(dynamicRecord('Cache')).toEqual({
      name: `Cache${DYNAMIC_MEMBER_SUFFIX}`,
      kind: 'member',
      exists: true,
      deprecated: false,
      message: null,
      since: null,
      for_removal: false,
      provenance: 'unknown-dynamic',
    });
  });
});

describe('createDefaultFrameworkApiAdapterRegistry', () => {
  it('registers every ecosystem that has an adapter, and only those', () => {
    const registry = createDefaultFrameworkApiAdapterRegistry();
    expect(registry.get('node')).toBe(nodeFrameworkApiAdapter);
    expect(registry.get('php')).toBe(phpFrameworkApiAdapter);
    expect(registry.get('python')).toBe(pythonFrameworkApiAdapter);
    expect(registry.get('jvm')).toBe(jvmFrameworkApiAdapter);
    // Deliberately unregistered: an ecosystem with no adapter must record `no-adapter`
    // rather than be run through the wrong reader.
    expect(registry.get('go')).toBeNull();
    expect(registry.get('rust')).toBeNull();
    expect(registry.get('dart')).toBeNull();
    expect(registry.get('ruby')).toBeNull();
  });
});
