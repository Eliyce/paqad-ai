import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { execa } from 'execa';

describe('pre-write-check-spec.sh', () => {
  const script = join(process.cwd(), 'runtime/hooks/pre-write-check-spec.sh');

  it('passes in fast lane', async () => {
    const result = await execa(script, {
      reject: false,
      input: JSON.stringify({ lane: 'fast' }),
    });
    expect(result.exitCode).toBe(0);
  });

  it('blocks when spec is missing in full lane', async () => {
    const result = await execa(script, {
      reject: false,
      input: JSON.stringify({ lane: 'full', story_id: 'S-1', spec_path: '/tmp/missing' }),
    });
    expect(result.exitCode).toBe(2);
  });

  it('passes when spec exists', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-spec-'));
    const spec = join(root, 'story.md');
    writeFileSync(spec, '# Spec');
    const result = await execa(script, {
      reject: false,
      input: JSON.stringify({ lane: 'graduated', story_id: 'S-1', spec_path: spec }),
    });
    expect(result.exitCode).toBe(0);
    rmSync(root, { recursive: true, force: true });
  });
});
