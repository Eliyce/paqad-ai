import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { hashSourceFiles } from '@/document';

describe('hashSourceFiles', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-document-staleness-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('distinguishes identical content when the source paths differ', async () => {
    mkdirSync(join(root, 'app'), { recursive: true });
    mkdirSync(join(root, 'routes'), { recursive: true });
    writeFileSync(join(root, 'app/source.php'), '<?php return true;');
    writeFileSync(join(root, 'routes/source.php'), '<?php return true;');

    await expect(hashSourceFiles(root, ['app/source.php'])).resolves.not.toEqual(
      await hashSourceFiles(root, ['routes/source.php']),
    );
  });

  it('treats the source set as stable regardless of input ordering or duplicates', async () => {
    mkdirSync(join(root, 'app'), { recursive: true });
    writeFileSync(join(root, 'app/one.php'), '<?php return 1;');
    writeFileSync(join(root, 'app/two.php'), '<?php return 2;');

    const canonical = await hashSourceFiles(root, ['app/one.php', 'app/two.php']);
    const reordered = await hashSourceFiles(root, ['app/two.php', 'app/one.php', 'app/one.php']);

    expect(reordered).toBe(canonical);
  });

  it('distinguishes missing files from present files at the same logical location', async () => {
    mkdirSync(join(root, 'app'), { recursive: true });
    writeFileSync(join(root, 'app/present.php'), '<?php return 1;');

    await expect(hashSourceFiles(root, ['app/missing.php'])).resolves.not.toEqual(
      await hashSourceFiles(root, ['app/present.php']),
    );
  });
});
