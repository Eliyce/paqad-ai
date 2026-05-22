import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('repository docs alignment', () => {
  it('keeps the README aligned with the shipped onboarding CLI', () => {
    const readme = readFileSync(join(process.cwd(), 'README.md'), 'utf8');

    expect(readme).not.toContain('--domain <domain>');
    expect(readme).toContain(
      'If no `--providers` flag is passed, onboarding defaults to `claude-code`',
    );
    expect(readme).not.toContain(
      'If no `--providers` flag is passed in a non-interactive context, files for all four providers are generated.',
    );
    expect(readme).toContain('`antigravity`');

    for (const stack of [
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
      'short-video',
    ]) {
      expect(readme).toContain(`\`${stack}\``);
    }
  });

  it('keeps maintainer docs free of the removed runtime/domains layout', () => {
    for (const file of [
      'architecture-map.md',
      'runtime-content-guide.md',
      'development-workflow.md',
      'troubleshooting.md',
    ]) {
      const content = readFileSync(join(process.cwd(), 'docs', 'maintainers', file), 'utf8');
      expect(content).not.toContain('runtime/domains/');
    }
  });

  it('keeps repo governance docs aligned with the strict delivery bar', () => {
    const readme = readFileSync(join(process.cwd(), 'README.md'), 'utf8');
    const workflow = readFileSync(
      join(process.cwd(), 'docs', 'maintainers', 'development-workflow.md'),
      'utf8',
    );
    const howToWork = readFileSync(
      join(process.cwd(), 'docs', 'maintainers', 'how-to-work.md'),
      'utf8',
    );
    const repoRule = readFileSync(
      join(
        process.cwd(),
        'docs',
        'instructions',
        'rules',
        'coding',
        'repo-quality-gates.md',
      ),
      'utf8',
    );
    const website = readFileSync(join(process.cwd(), 'website', 'index.html'), 'utf8');

    for (const content of [readme, workflow, howToWork, repoRule, website]) {
      expect(content).toContain('100%');
    }

    expect(repoRule).toContain('positive and negative');
    expect(repoRule).toContain('docs/modules/**');
    expect(repoRule).toContain('website/');
    expect(repoRule).toContain('npm run format');
    expect(repoRule).toContain('npm run ci');
    expect(workflow).toContain('SOLID');
  });
});
