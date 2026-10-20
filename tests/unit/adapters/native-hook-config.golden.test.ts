import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AdapterFactory } from '@/adapters';
import type { AdapterType } from '@/core/types/adapter.js';

const FIXED_HOME = '/fake/home/.paqad-ai/current';

const EXECUTED_HOOK_FILE: Partial<Record<AdapterType, string>> = {
  'claude-code': '.claude/settings.json',
  'gemini-cli': '.gemini/settings.json',
};

async function renderExecutedHookFile(type: AdapterType): Promise<string> {
  const projectRoot = mkdtempSync(join(tmpdir(), `paqad-golden-${type}-`));
  const files = await AdapterFactory.create(type).generateConfig({
    frameworkPath: '.paqad/framework-path.txt',
    rulesPath: 'docs/instructions/rules',
    projectRoot,
  });
  const wanted = EXECUTED_HOOK_FILE[type]!;
  const file = files.find((candidate) => candidate.path === wanted);
  if (!file) {
    throw new Error(`${type} did not generate ${wanted}`);
  }
  return file.content;
}

describe('native hook-config byte-identity', () => {
  let priorHome: string | undefined;

  beforeEach(() => {
    priorHome = process.env.PAQAD_FRAMEWORK_HOME;
    process.env.PAQAD_FRAMEWORK_HOME = FIXED_HOME;
  });
  afterEach(() => {
    if (priorHome === undefined) {
      delete process.env.PAQAD_FRAMEWORK_HOME;
    } else {
      process.env.PAQAD_FRAMEWORK_HOME = priorHome;
    }
  });

  it('renders the Claude settings.json exactly as before the shared-renderer change', async () => {
    expect(await renderExecutedHookFile('claude-code')).toMatchSnapshot();
  });

  it('renders the Gemini settings.json exactly as before the shared-renderer change', async () => {
    expect(await renderExecutedHookFile('gemini-cli')).toMatchSnapshot();
  });
});
