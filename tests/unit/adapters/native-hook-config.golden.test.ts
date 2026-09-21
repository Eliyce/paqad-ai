import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AdapterFactory } from '@/adapters';
import type { AdapterType } from '@/core/types/adapter.js';

/**
 * Byte-identity guard for the native hook-config renderer (issue #566, AC-3 / AC-10).
 *
 * The Codex-parity change generalizes one renderer to drive every hook-capable host, so the
 * Claude `.claude/settings.json` and the Gemini `.gemini/settings.json` MUST come out
 * byte-identical to before the refactor. These snapshots pin the exact bytes; a snapshot diff
 * on either host is a regression, never an accepted `-u` update. The framework home is pinned so
 * the absolute `node "<abs>"` commands are machine-independent.
 */
const FIXED_HOME = '/fake/home/.paqad-ai/current';

/** The file each host actually executes hooks from (the byte-identity target). */
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

describe('native hook-config byte-identity (issue #566)', () => {
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
