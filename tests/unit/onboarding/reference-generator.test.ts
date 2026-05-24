import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { posix } from 'node:path';

const { join } = posix;

import { generateReferenceGuides } from '@/onboarding/reference-generator.js';

describe('generateReferenceGuides', () => {
  let runtimeRoot: string;

  beforeEach(() => {
    runtimeRoot = mkdtempSync(join(tmpdir(), 'paqad-reference-generator-'));
  });

  afterEach(() => {
    rmSync(runtimeRoot, { recursive: true, force: true });
  });

  it('copies reference guides for any coding pack that ships references', async () => {
    const referencesRoot = join(
      runtimeRoot,
      'capabilities',
      'coding',
      'stacks',
      'django',
      'references',
      'tools',
    );
    mkdirSync(referencesRoot, { recursive: true });
    writeFileSync(
      join(
        runtimeRoot,
        'capabilities',
        'coding',
        'stacks',
        'django',
        'references',
        'tools-catalog.md',
      ),
      '# Django Tools\n',
    );
    writeFileSync(join(referencesRoot, 'testing.md'), '# Testing\n');

    const files = await generateReferenceGuides(runtimeRoot, {
      domain: 'coding',
      stack_profile: {
        frameworks: ['django'],
        traits: [],
        toolchains: [],
        version_bands: [],
        sources: [],
      },
    });

    expect(files.map((file) => file.path)).toEqual([
      'docs/instructions/tools/django/README.md',
      'docs/instructions/tools/django/testing.md',
    ]);
  });

  it('returns no references for content-only projects', async () => {
    const files = await generateReferenceGuides(runtimeRoot, {
      domain: 'content',
      stack_profile: {
        frameworks: ['short-video'],
        traits: [],
        toolchains: [],
        version_bands: [],
        sources: [],
      },
    });

    expect(files).toEqual([]);
  });

  it('writes a fallback README when a coding stack ships no reference directory', async () => {
    const files = await generateReferenceGuides(runtimeRoot, {
      domain: 'coding',
      stack_profile: {
        frameworks: ['fastapi'],
        traits: [],
        toolchains: [],
        version_bands: [],
        sources: [],
      },
    });

    expect(files).toEqual([
      expect.objectContaining({
        path: 'docs/instructions/tools/fastapi/README.md',
      }),
    ]);
    expect(files[0]?.content).toContain('# Fastapi Tool References');
    expect(files[0]?.content).toContain('minimum viable runtime tool contract');
  });

  it('writes a fallback README when the reference directory exists but is empty', async () => {
    mkdirSync(join(runtimeRoot, 'capabilities', 'coding', 'stacks', 'node-cli', 'references'), {
      recursive: true,
    });

    const files = await generateReferenceGuides(runtimeRoot, {
      domain: 'coding',
      stack_profile: {
        frameworks: ['node-cli'],
        traits: [],
        toolchains: [],
        version_bands: [],
        sources: [],
      },
    });

    expect(files).toEqual([
      expect.objectContaining({
        path: 'docs/instructions/tools/node-cli/README.md',
      }),
    ]);
    expect(files[0]?.content).toContain('# Node Cli Tool References');
  });
});
