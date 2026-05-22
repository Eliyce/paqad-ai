import { generateModuleScaffold } from '@/onboarding/scaffold-generator.js';
import { validateApiDoc, validateErrorCatalogMarkdown } from '@/validators';

describe('module scaffold templates', () => {
  it('generates api/endpoints.md', async () => {
    const files = await generateModuleScaffold('users');
    const apiEndpoints = files.find((file) => file.path.includes('api/endpoints.md'));
    expect(apiEndpoints).toBeDefined();
    expect(apiEndpoints!.content).toContain('API Endpoints');
    expect(validateApiDoc(apiEndpoints!.content).valid).toBe(true);
  });

  it('generates api/schemas.md', async () => {
    const files = await generateModuleScaffold('users');
    const apiSchemas = files.find((file) => file.path.includes('api/schemas.md'));
    expect(apiSchemas).toBeDefined();
  });

  it('generates api/error-codes.md', async () => {
    const files = await generateModuleScaffold('users');
    const errorCodes = files.find((file) => file.path.includes('api/error-codes.md'));
    expect(errorCodes).toBeDefined();
  });

  it('generates integration/events.md', async () => {
    const files = await generateModuleScaffold('users');
    const events = files.find((file) => file.path.includes('integration/events.md'));
    expect(events).toBeDefined();
  });

  it('generates integration/contracts.md', async () => {
    const files = await generateModuleScaffold('users');
    const contracts = files.find((file) => file.path.includes('integration/contracts.md'));
    expect(contracts).toBeDefined();
  });

  it('generates error-catalog.md', async () => {
    const files = await generateModuleScaffold('users');
    const catalog = files.find((file) => file.path.includes('error-catalog.md'));
    expect(catalog).toBeDefined();
    expect(catalog!.content).toContain('Error Catalog');
    expect(validateErrorCatalogMarkdown(catalog!.content).valid).toBe(true);
  });

  it('generates business and technical module docs', async () => {
    const files = await generateModuleScaffold('users');
    expect(
      files.find((file) => file.path.endsWith('features/core/business.md'))?.content,
    ).toContain('Business Rules');
    expect(
      files.find((file) => file.path.endsWith('features/core/technical.md'))?.content,
    ).toContain('Testing Entry Points');
  });

  it('generates all 16 module scaffold files', async () => {
    const files = await generateModuleScaffold('users');
    expect(files.length).toBeGreaterThanOrEqual(16);
  });
});
