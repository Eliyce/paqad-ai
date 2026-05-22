import { execa } from 'execa';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { RunnerScriptGenerator } from '@/scripts';

import { scriptProfile } from './shared.fixture';

describe('verify.sh', () => {
  it('runs successfully on dry run', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-scripts-'));
    const generator = new RunnerScriptGenerator();
    await generator.write(root, scriptProfile());

    const result = await execa(join(root, 'scripts/verify.sh'), {
      reject: false,
      cwd: root,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('All gates passed');
    rmSync(root, { recursive: true, force: true });
  });
});
