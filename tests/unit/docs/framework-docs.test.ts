import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('framework docs canon', () => {
  it('keeps the canonical replacement docs free of legacy runtime and routing references', () => {
    const projectOverview = readFileSync(
      join(process.cwd(), 'docs', 'maintainers', 'project-overview.md'),
      'utf8',
    );
    const architecture = readFileSync(
      join(process.cwd(), 'docs', 'maintainers', 'architecture-map.md'),
      'utf8',
    );
    const authoring = readFileSync(
      join(process.cwd(), 'docs', 'modules', 'packs', 'features', 'authoring', 'technical.md'),
      'utf8',
    );

    expect(projectOverview).not.toContain('runtime/domains/');
    expect(architecture).not.toContain('runtime/domains/');
    expect(projectOverview).not.toContain('routing.domain');
    expect(architecture).not.toContain('routing.domain');
    expect(authoring).toContain('paqad-ai packs create <name>');
  });

  it('documents the full shipped built-in pack surface', () => {
    const commands = readFileSync(
      join(process.cwd(), 'docs', 'modules', 'cli', 'features', 'commands', 'business.md'),
      'utf8',
    );
    const contractMap = readFileSync(
      join(process.cwd(), 'docs', 'maintainers', 'canonical-contract-map.md'),
      'utf8',
    );

    for (const pack of [
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
      'node-cli',
      'node-library',
      'node-service',
    ]) {
      expect(readFileSync(join(process.cwd(), 'README.md'), 'utf8')).toContain(`\`${pack}\``);
    }

    expect(commands).toContain('- `packs`');
    expect(contractMap).toContain('`docs/framework/stack-packs.md`');
  });

  it('keeps workflow and hook requirement docs aligned with shipped routing and adapter contracts', () => {
    const silentUpdateTechnical = readFileSync(
      join(
        process.cwd(),
        'docs',
        'modules',
        'update',
        'features',
        'silent-auto-update',
        'technical.md',
      ),
      'utf8',
    );
    const silentUpdateBusiness = readFileSync(
      join(
        process.cwd(),
        'docs',
        'modules',
        'update',
        'features',
        'silent-auto-update',
        'business.md',
      ),
      'utf8',
    );
    const gaRequirements = readFileSync(
      join(process.cwd(), 'docs', 'features', 'ga-pain-point-analysis-requirements.md'),
      'utf8',
    );

    expect(silentUpdateTechnical).toContain(
      '- Generated adapter entry files must not mention or invoke the hook directly.',
    );
    expect(silentUpdateBusiness).toContain(
      '- Silent update is always background infrastructure, never an agent-instruction feature.',
    );

    expect(gaRequirements).toContain('The workflow-router skill must distinguish this workflow');
    expect(gaRequirements).not.toContain(
      'The classifier must distinguish this workflow from general content, coding, or security requests.',
    );
  });
});
