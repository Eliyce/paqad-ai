import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DesignTokensValidationError,
  getDesignTokensConfig,
  putDesignTokens,
} from '@/dashboard/config-design-tokens.js';
import { contentHash, WriteConflictError } from '@/dashboard/write-pipeline.js';
import { DESIGN_TOKENS_PLACEHOLDER_NOTE } from '@/design-tokens/service.js';

const TOKENS_PATH = 'docs/instructions/design-system/design-tokens.json';

const VALID_TOKENS = `${JSON.stringify(
  {
    color: {
      primary: { $value: '#102030', $type: 'color' },
      secondary: { $value: '#405060', $type: 'color' },
    },
    spacing: {
      sm: { $value: '4px', $type: 'dimension' },
    },
  },
  null,
  2,
)}\n`;

const PLACEHOLDER_TOKENS = `${JSON.stringify(
  {
    $comment: DESIGN_TOKENS_PLACEHOLDER_NOTE,
    color: {
      primary: { $value: '#000000', $type: 'color' },
    },
  },
  null,
  2,
)}\n`;

function write(root: string, relative: string, content: string): void {
  const full = join(root, relative);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

describe('design tokens config endpoint logic', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-config-dt-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  describe('getDesignTokensConfig', () => {
    it('returns a missing file, null tokens, and the schema on a bare project', () => {
      const config = getDesignTokensConfig(root);
      expect(config.file.exists).toBe(false);
      expect(config.tokens).toBeNull();
      expect(config.placeholder).toBe(false);
      expect(config.schema).toMatchObject({ $id: 'design-tokens' });
    });

    it('parses the tokens and flags the placeholder scaffold', () => {
      write(root, TOKENS_PATH, PLACEHOLDER_TOKENS);
      const config = getDesignTokensConfig(root);
      expect(config.file.exists).toBe(true);
      expect(config.file.hash).toBe(contentHash(PLACEHOLDER_TOKENS));
      expect(config.tokens).toMatchObject({ $comment: DESIGN_TOKENS_PLACEHOLDER_NOTE });
      expect(config.placeholder).toBe(true);
    });

    it('reports edited tokens as non-placeholder', () => {
      write(root, TOKENS_PATH, VALID_TOKENS);
      const config = getDesignTokensConfig(root);
      expect(config.placeholder).toBe(false);
      expect(config.tokens).toMatchObject({ color: { primary: { $value: '#102030' } } });
    });

    it('returns null tokens when the on-disk file is not valid JSON', () => {
      write(root, TOKENS_PATH, '{not json');
      const config = getDesignTokensConfig(root);
      expect(config.file.exists).toBe(true);
      expect(config.tokens).toBeNull();
      expect(config.placeholder).toBe(false);
    });
  });

  describe('putDesignTokens', () => {
    it('validates, writes, audits, and regenerates the derived docs', async () => {
      const result = await putDesignTokens(root, { content: VALID_TOKENS, baseHash: null });

      expect(result.path).toBe(TOKENS_PATH);
      expect(result.hash).toBe(contentHash(VALID_TOKENS));
      expect(result.regenerationError).toBeUndefined();
      expect(result.regenerated).toContain(join('docs/instructions/design-system', 'tokens.md'));
      expect(result.regenerated).toContain('.paqad/theme/theme.css');
      expect(readFileSync(join(root, TOKENS_PATH), 'utf8')).toBe(VALID_TOKENS);
      expect(existsSync(join(root, 'docs/instructions/design-system/tokens.md'))).toBe(true);
      expect(existsSync(join(root, '.paqad/theme/theme.css'))).toBe(true);

      const audit = readFileSync(join(root, '.paqad/audit.log'), 'utf8');
      expect(audit).toContain('dashboard.config.design-tokens.write');
      expect(audit).toContain('actor="dashboard"');
    });

    it('saves placeholder content but reports the regeneration error', async () => {
      const result = await putDesignTokens(root, { content: PLACEHOLDER_TOKENS, baseHash: null });

      expect(result.hash).toBe(contentHash(PLACEHOLDER_TOKENS));
      expect(result.regenerated).toEqual([]);
      expect(result.regenerationError).toContain('placeholder');
      expect(readFileSync(join(root, TOKENS_PATH), 'utf8')).toBe(PLACEHOLDER_TOKENS);
      expect(existsSync(join(root, 'docs/instructions/design-system/tokens.md'))).toBe(false);
    });

    it('rejects content that is not valid JSON, with a root-level issue', async () => {
      await expect(putDesignTokens(root, { content: '{not json', baseHash: null })).rejects.toThrow(
        DesignTokensValidationError,
      );
      try {
        await putDesignTokens(root, { content: '{not json', baseHash: null });
      } catch (err) {
        expect((err as DesignTokensValidationError).issues[0]?.path).toBe('/');
      }
    });

    it('rejects non-object JSON', async () => {
      await expect(putDesignTokens(root, { content: '[1, 2]', baseHash: null })).rejects.toThrow(
        /JSON object/,
      );
    });

    it('rejects schema violations and writes nothing', async () => {
      const invalid = JSON.stringify({ color: 'red' });
      let error: DesignTokensValidationError | null = null;
      try {
        await putDesignTokens(root, { content: invalid, baseHash: null });
      } catch (err) {
        error = err as DesignTokensValidationError;
      }
      expect(error).toBeInstanceOf(DesignTokensValidationError);
      expect(error?.issues.length).toBeGreaterThan(0);
      expect(() => readFileSync(join(root, TOKENS_PATH), 'utf8')).toThrow();
    });

    it('propagates a write conflict when the file changed underneath', async () => {
      write(root, TOKENS_PATH, VALID_TOKENS);
      await expect(
        putDesignTokens(root, {
          content: VALID_TOKENS.replace('#102030', '#0a0b0c'),
          baseHash: contentHash('something stale'),
        }),
      ).rejects.toThrow(WriteConflictError);
    });

    it('accepts an update that echoes the current hash', async () => {
      write(root, TOKENS_PATH, VALID_TOKENS);
      const updated = VALID_TOKENS.replace('#102030', '#0a0b0c');
      const result = await putDesignTokens(root, {
        content: updated,
        baseHash: contentHash(VALID_TOKENS),
      });
      expect(result.hash).toBe(contentHash(updated));
    });
  });
});
