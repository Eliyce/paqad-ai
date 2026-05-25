import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { DesignTokenService, DesignTokensMissingError } from '@/design-tokens';

describe('DesignTokenService', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-design-tokens-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('seeds the canonical token file and generates derived docs', async () => {
    const service = new DesignTokenService();

    await service.seed(root);
    await service.writeDocs(root);
    await service.writeThemeExports(root, 'laravel');

    expect(readFileSync(join(root, PATHS.DESIGN_TOKENS_FILE), 'utf8')).toContain('"color"');
    expect(readFileSync(join(root, PATHS.DESIGN_SYSTEM_DIR, 'tokens.md'), 'utf8')).toContain(
      'Design Tokens',
    );
    expect(readFileSync(join(root, '.paqad/theme/theme.css'), 'utf8')).toContain('--color-primary');
    const tailwindTheme = readFileSync(join(root, '.paqad/theme/tailwind.theme.cjs'), 'utf8');
    expect(tailwindTheme).toContain("'color-primary' : '#0F766E'");
    expect(tailwindTheme).not.toContain('spacing-xs');
    expect(tailwindTheme).not.toContain('typography-fontFamily-body');
    expect(tailwindTheme).not.toContain('motion-duration-fast');
  });

  it('throws DesignTokensMissingError when the tokens file is absent', async () => {
    const service = new DesignTokenService();
    await expect(service.load(root)).rejects.toBeInstanceOf(DesignTokensMissingError);
  });
});
