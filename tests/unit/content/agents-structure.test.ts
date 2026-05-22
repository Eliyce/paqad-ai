import fg from 'fast-glob';
import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

describe('runtime agents', () => {
  it('all shipped agents have the required sections', async () => {
    const files = (
      await fg('runtime/**/agents/*.md', { cwd: process.cwd(), absolute: true })
    ).sort();
    expect(files.length).toBeGreaterThanOrEqual(20);

    for (const file of files) {
      const content = await readFile(file, 'utf8');
      expect(content).toContain('## Purpose');
      expect(content).toContain('## Model');
      expect(content).toContain('## Tools');
      expect(content).toContain('## Instructions');
    }
  });

  it('the seven deepened prompts include the full contract and stay stack-profile driven', async () => {
    const targets = [
      'runtime/capabilities/coding/agents/doc-maintainer.md',
      'runtime/capabilities/security/agents/security-auditor.md',
      'runtime/capabilities/coding/agents/devops-engineer.md',
      'runtime/capabilities/coding/agents/performance-analyst.md',
      'runtime/capabilities/coding/agents/data-modeler.md',
      'runtime/capabilities/coding/agents/integration-architect.md',
      'runtime/base/agents/market-researcher.md',
    ];

    const forbiddenFrameworkNames = [
      'Laravel',
      'React',
      'Vue',
      'Flutter',
      'Django',
      'Rails',
      'FastAPI',
      'Spring Boot',
      'Express',
      'Svelte',
      'Angular',
      'Astro',
    ];

    for (const path of targets) {
      const content = await readFile(path, 'utf8');
      const lines = content.split('\n');

      expect(content).toContain('## Purpose');
      expect(content).toContain('## Model');
      expect(content).toContain('## Tools');
      expect(content).toContain('## Inputs');
      expect(content).toContain('## Instructions');
      expect(content).toContain('## Output Contract');
      expect(lines.length).toBeLessThanOrEqual(500);

      const instructionsSection = content
        .split('## Instructions')[1]
        ?.split('## Output Contract')[0];

      expect(instructionsSection).toBeTruthy();

      for (const framework of forbiddenFrameworkNames) {
        expect(instructionsSection).not.toContain(framework);
      }
    }
  });
});
