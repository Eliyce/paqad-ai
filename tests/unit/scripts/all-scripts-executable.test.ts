import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { RunnerScriptGenerator } from '@/scripts';

import { scriptProfile } from './shared.fixture';

describe('generated runner scripts', () => {
  it('are executable after write', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-scripts-'));
    const generator = new RunnerScriptGenerator();
    const paths = await generator.write(root, scriptProfile());

    for (const relativePath of paths) {
      const mode = statSync(join(root, relativePath)).mode;
      expect(mode & 0o111).toBeGreaterThan(0);
    }

    rmSync(root, { recursive: true, force: true });
  });
});
