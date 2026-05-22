import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { execa } from 'execa';

describe('skill-cache-check.sh', () => {
  const script = join(process.cwd(), 'runtime/hooks/skill-cache-check.sh');

  it('misses when cache does not exist', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-cache-'));
    const input = join(root, 'input.txt');
    writeFileSync(input, 'hello');
    const result = await execa(script, {
      reject: false,
      input: JSON.stringify({ cache_dir: root, skill_name: 'demo', input_files: [input] }),
    });
    expect(result.exitCode).toBe(1);
    rmSync(root, { recursive: true, force: true });
  });

  it('hits after cache write', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-cache-'));
    const input = join(root, 'input.txt');
    writeFileSync(input, 'hello');
    await execa(script, {
      reject: false,
      input: JSON.stringify({
        cache_dir: root,
        skill_name: 'demo',
        input_files: [input],
        write_result: { ok: true },
      }),
    });
    const result = await execa(script, {
      reject: false,
      input: JSON.stringify({ cache_dir: root, skill_name: 'demo', input_files: [input] }),
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('"ok": true');
    rmSync(root, { recursive: true, force: true });
  });
});
