import { describe, expect, it } from 'vitest';

import { FileRegistryMapper } from '@/context/file-registry-mapper.js';

describe('FileRegistryMapper', () => {
  const mapper = new FileRegistryMapper();

  it('maps all documented file patterns to the correct registries', () => {
    expect(mapper.getAffectedRegistries('app/Models/User.php')).toEqual([
      'model-registry.md',
      'table-registry.md',
    ]);
    expect(mapper.getAffectedRegistries('routes/web.php')).toEqual(['api-registry.md']);
    expect(mapper.getAffectedRegistries('app/Http/Controllers/UserController.php')).toEqual([
      'api-registry.md',
    ]);
    expect(mapper.getAffectedRegistries('database/migrations/2026_01_01_create_users.php')).toEqual(
      ['table-registry.md', 'query-registry.md'],
    );
    expect(mapper.getAffectedRegistries('src/components/Button.tsx')).toEqual([
      'component-registry.md',
    ]);
    expect(mapper.getAffectedRegistries('resources/views/dashboard.blade.php')).toEqual([
      'screen-registry.md',
    ]);
    expect(mapper.getAffectedRegistries('app/Events/UserCreated.php')).toEqual([
      'job-event-registry.md',
      'integration-registry.md',
    ]);
    expect(mapper.getAffectedRegistries('app/Exceptions/DomainException.php')).toEqual([
      'error-code-registry.md',
    ]);
    expect(mapper.getAffectedRegistries('tests/Feature/UserTest.php')).toEqual([
      'test-registry.md',
    ]);
    expect(mapper.getAffectedRegistries('docs/modules/billing/summary.md')).toEqual([
      'module-registry.md',
      'feature-registry.md',
    ]);
  });
});
