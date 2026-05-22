import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { execa } from 'execa';

describe('context-hit-tracker.sh', () => {
  const script = join(process.cwd(), 'runtime/hooks/context-hit-tracker.sh');

  it('writes hit-rate output', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-hit-'));
    const output = join(root, 'context.json');
    const result = await execa(script, {
      reject: false,
      input: JSON.stringify({
        output_path: output,
        files_loaded: 10,
        files_referenced: 7,
      }),
    });

    expect(result.exitCode).toBe(0);
    expect(existsSync(output)).toBe(true);
    expect(JSON.parse(readFileSync(output, 'utf8')).hit_rate).toBe(0.7);
    rmSync(root, { recursive: true, force: true });
  });
});
