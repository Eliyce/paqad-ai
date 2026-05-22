import { execa } from 'execa';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { RunnerScriptGenerator } from '@/scripts';

import { scriptProfile } from './shared.fixture';

describe('extract-routes.sh', () => {
  it('renders artisan for laravel', async () => {
    const generator = new RunnerScriptGenerator();
    const files = await generator.generate(scriptProfile('laravel'));
    const extract = files.find((file) => file.path === 'scripts/extract-routes.sh');
    expect(extract?.content).toContain('php artisan route:list --json');
  });

  it('returns a standard artisan-not-available fallback for flutter', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-scripts-'));
    const generator = new RunnerScriptGenerator();
    await generator.write(root, scriptProfile('flutter'));

    const result = await execa(join(root, 'scripts/extract-routes.sh'), {
      reject: false,
      cwd: root,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('"error": "artisan not available"');
    rmSync(root, { recursive: true, force: true });
  });

  it('renders stack-specific extractors for the new stacks', async () => {
    const generator = new RunnerScriptGenerator();

    const next = await generator.generate(scriptProfile('nextjs'));
    expect(next.find((file) => file.path === 'scripts/extract-routes.sh')?.content).toContain(
      'app/**/page.tsx',
    );

    const nest = await generator.generate(scriptProfile('nestjs'));
    expect(nest.find((file) => file.path === 'scripts/extract-routes.sh')?.content).toContain(
      '*.controller.ts',
    );

    const dotnet = await generator.generate(scriptProfile('dotnet'));
    expect(dotnet.find((file) => file.path === 'scripts/extract-routes.sh')?.content).toContain(
      'MapGet',
    );
  });
});
