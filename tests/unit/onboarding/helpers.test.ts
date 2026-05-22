import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { writeGeneratedFiles } from '@/onboarding/file-writer';
import { resolveSelections } from '@/onboarding/prompts';

describe('onboarding helpers', () => {
  it('resolves defaults from detection when no overrides are given (non-interactive)', async () => {
    const result = await resolveSelections(
      {
        detected_domain: null,
        detected_stack: null,
        detected_capabilities: [],
        confidence: 'low',
        signals: [],
        timestamp: new Date().toISOString(),
      },
      undefined,
    );

    expect(result.domain).toBe('content');
    expect(result.stack).toBe('short-video');
    expect(result.capabilities).toEqual([]);
    expect(result.providers).toEqual(['claude-code']);
  });

  it('respects overrides over detection', async () => {
    const result = await resolveSelections(
      {
        detected_domain: 'coding',
        detected_stack: 'laravel',
        detected_capabilities: ['react'],
        confidence: 'high',
        signals: [],
        timestamp: new Date().toISOString(),
      },
      { stack: 'flutter', capabilities: [] },
    );

    expect(result.domain).toBe('coding');
    expect(result.stack).toBe('flutter');
    expect(result.capabilities).toEqual([]);
  });

  it('allows overriding detection with standalone react stack selections', async () => {
    const result = await resolveSelections(
      {
        detected_domain: 'coding',
        detected_stack: 'laravel',
        detected_capabilities: ['react'],
        confidence: 'high',
        signals: [],
        timestamp: new Date().toISOString(),
      },
      { stack: 'react', capabilities: ['next', 'tailwind'] },
    );

    expect(result.stack).toBe('react');
    expect(result.capabilities).toEqual(['next', 'tailwind']);
  });

  it('allows overriding detection with a newly shipped pack selection', async () => {
    const result = await resolveSelections(
      {
        detected_domain: 'coding',
        detected_stack: 'laravel',
        detected_capabilities: [],
        confidence: 'high',
        signals: [],
        timestamp: new Date().toISOString(),
      },
      { stack: 'fastapi', capabilities: [] },
    );

    expect(result.stack).toBe('fastapi');
    expect(result.domain).toBe('coding');
  });

  it('uses provided providers override', async () => {
    const result = await resolveSelections(
      {
        detected_domain: 'coding',
        detected_stack: 'laravel',
        detected_capabilities: [],
        confidence: 'high',
        signals: [],
        timestamp: new Date().toISOString(),
      },
      { providers: ['claude-code'], stack: 'laravel', capabilities: [] },
    );

    expect(result.providers).toEqual(['claude-code']);
    expect(result.stack).toBe('laravel');
  });

  it('writes files and skips protected files', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'paqad-ai-file-writer-'));
    const protectedPath = join(projectRoot, 'protected.txt');
    writeFileSync(protectedPath, 'keep');

    const result = writeGeneratedFiles(projectRoot, [
      { path: 'script.sh', content: '#!/usr/bin/env bash\n', autoUpdate: true, executable: true },
      { path: 'protected.txt', content: 'replace', autoUpdate: false },
    ]);

    expect(result.written).toContain('script.sh');
    expect(result.skipped).toContain('protected.txt');
    expect(readFileSync(protectedPath, 'utf8')).toBe('keep');
    expect(existsSync(join(projectRoot, 'script.sh'))).toBe(true);

    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('preserves project-owned glossary and registry files on later writes', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'paqad-ai-registry-writer-'));
    const glossaryPath = join(projectRoot, '.paqad/glossary.md');
    const registryPath = join(projectRoot, 'docs/instructions/registries/module-registry.md');
    const statusPath = join(projectRoot, '.paqad/indexes/registry-status.json');

    writeGeneratedFiles(projectRoot, [
      { path: '.paqad/glossary.md', content: '# Glossary\n\n', autoUpdate: false },
      {
        path: 'docs/instructions/registries/module-registry.md',
        content: '# module-registry.md\n\n- core\n',
        autoUpdate: false,
      },
      {
        path: '.paqad/indexes/registry-status.json',
        content: '{"generated":true}',
        autoUpdate: true,
      },
    ]);

    writeFileSync(glossaryPath, '# Glossary\n\n- curated term\n');
    writeFileSync(registryPath, '# module-registry.md\n\n- manually curated\n');
    writeFileSync(statusPath, '{"generated":"old"}');

    const result = writeGeneratedFiles(projectRoot, [
      { path: '.paqad/glossary.md', content: '# Glossary\n\n', autoUpdate: false },
      {
        path: 'docs/instructions/registries/module-registry.md',
        content: '# module-registry.md\n\n- core\n',
        autoUpdate: false,
      },
      {
        path: '.paqad/indexes/registry-status.json',
        content: '{"generated":"new"}',
        autoUpdate: true,
      },
    ]);

    expect(result.skipped).toEqual(
      expect.arrayContaining([
        '.paqad/glossary.md',
        'docs/instructions/registries/module-registry.md',
      ]),
    );
    expect(readFileSync(glossaryPath, 'utf8')).toContain('curated term');
    expect(readFileSync(registryPath, 'utf8')).toContain('manually curated');
    expect(readFileSync(statusPath, 'utf8')).toBe('{"generated":"new"}');

    rmSync(projectRoot, { recursive: true, force: true });
  });
});
