import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  assertEmbeddingProviderAvailable,
  findRemovedEmbeddingProvider,
  isRemovedEmbeddingProviderError,
  REMOVED_EMBEDDING_PROVIDER_MESSAGE,
  RemovedEmbeddingProviderError,
  resolveRemovedEmbeddingProvider,
} from '@/rag/removed-provider.js';

describe('removed embedding provider guard', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-removed-provider-'));
    mkdirSync(join(root, '.paqad'), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function writeConfig(text: string): void {
    writeFileSync(join(root, '.paqad/.config'), text);
  }

  function writeProfile(text: string): void {
    writeFileSync(join(root, '.paqad/project-profile.yaml'), text);
  }

  it('names the remaining choices and the way to fix the setting', () => {
    expect(REMOVED_EMBEDDING_PROVIDER_MESSAGE).toContain('Voyage embedding provider was removed');
    expect(REMOVED_EMBEDDING_PROVIDER_MESSAGE).toContain('local or openai');
    expect(REMOVED_EMBEDDING_PROVIDER_MESSAGE).toContain('rag_embedding_provider');
    expect(REMOVED_EMBEDDING_PROVIDER_MESSAGE).toContain('PAQAD_RAG_EMBEDDING_PROVIDER');
    expect(REMOVED_EMBEDDING_PROVIDER_MESSAGE).toContain('paqad-ai rag init --provider local');
  });

  it('recognises only the removed provider name', () => {
    expect(findRemovedEmbeddingProvider(' VoyageAI ')).toBe('voyageai');
    expect(findRemovedEmbeddingProvider('local')).toBeUndefined();
    expect(findRemovedEmbeddingProvider(42)).toBeUndefined();
  });

  it('reads the config file before the profile', () => {
    writeConfig('rag_embedding_provider=voyageai\n');
    writeProfile('intelligence:\n  embedding_provider: local\n');
    expect(resolveRemovedEmbeddingProvider(root, {})).toBe('voyageai');

    writeConfig('rag_embedding_provider=openai\n');
    writeProfile('intelligence:\n  embedding_provider: voyageai\n');
    expect(resolveRemovedEmbeddingProvider(root, {})).toBeUndefined();
  });

  it('lets the environment override the config file', () => {
    writeConfig('rag_embedding_provider=voyageai\n');
    expect(
      resolveRemovedEmbeddingProvider(root, { PAQAD_RAG_EMBEDDING_PROVIDER: 'openai' }),
    ).toBeUndefined();

    writeConfig('rag_embedding_provider=openai\n');
    expect(
      resolveRemovedEmbeddingProvider(root, { PAQAD_RAG_EMBEDDING_PROVIDER: 'voyageai' }),
    ).toBe('voyageai');
  });

  it('falls back to the profile only when no config value is set', () => {
    writeConfig('rag_embedding_provider=\n');
    writeProfile('intelligence:\n  embedding_provider: voyageai\n');
    expect(resolveRemovedEmbeddingProvider(root, {})).toBe('voyageai');
  });

  it('treats a missing, empty or unreadable profile as not removed', () => {
    expect(resolveRemovedEmbeddingProvider(root, {})).toBeUndefined();
    writeProfile('');
    expect(resolveRemovedEmbeddingProvider(root, {})).toBeUndefined();
    writeProfile('intelligence: [unclosed\n');
    expect(resolveRemovedEmbeddingProvider(root, {})).toBeUndefined();
  });

  it('checks an explicit choice instead of the saved setting', () => {
    writeConfig('rag_embedding_provider=voyageai\n');

    expect(() => assertEmbeddingProviderAvailable(root, 'local', {})).not.toThrow();
    expect(() => assertEmbeddingProviderAvailable(root, 'voyageai', {})).toThrow(
      RemovedEmbeddingProviderError,
    );
    expect(() => assertEmbeddingProviderAvailable(root, '  ', {})).toThrow(
      REMOVED_EMBEDDING_PROVIDER_MESSAGE,
    );
    expect(() => assertEmbeddingProviderAvailable(root, undefined, {})).toThrow(
      REMOVED_EMBEDDING_PROVIDER_MESSAGE,
    );
  });

  it('uses the process environment by default', () => {
    expect(() => assertEmbeddingProviderAvailable(root)).not.toThrow();
    expect(resolveRemovedEmbeddingProvider(root)).toBeUndefined();
  });

  it('identifies its own error type', () => {
    const error = new RemovedEmbeddingProviderError('voyageai');
    expect(error.name).toBe('RemovedEmbeddingProviderError');
    expect(error.provider).toBe('voyageai');
    expect(isRemovedEmbeddingProviderError(error)).toBe(true);
    expect(isRemovedEmbeddingProviderError(new Error('other'))).toBe(false);
  });
});

describe('voyageai package left out of the test suite and the build', () => {
  function testFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...testFiles(full));
      else if (/\.(?:test|e2e)\.[cm]?[jt]sx?$|\.[cm]?[jt]s$/.test(entry.name)) out.push(full);
    }
    return out;
  }

  it('AC-15 has no test mocking voyageai and no voyageai engine kept external', () => {
    const mocksVoyage = /vi\.(?:do)?[mM]ock\(\s*['"]voyageai['"]/;
    const offenders = testFiles('tests').filter((file) =>
      mocksVoyage.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);

    const pluginTest = readFileSync('tests/unit/plugin/no-node-modules.test.ts', 'utf8');
    expect(pluginTest).toMatch(/const EXTERNAL_DEPS = \['@huggingface\/transformers', 'openai'\];/);
    expect(readFileSync('tsup.config.ts', 'utf8')).not.toContain("'voyageai'");
  });
});
