import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const TRIGGER = resolve(__dirname, '../../../runtime/hooks/context-refresh-trigger.mjs');
const MARKER_REL = '.paqad/locks/rule-context.marker';

function run(projectRoot: string, env: NodeJS.ProcessEnv = {}): number {
  try {
    execFileSync('node', [TRIGGER], {
      env: { ...process.env, CLAUDE_PROJECT_DIR: projectRoot, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return 0;
  } catch (error) {
    return (error as { status: number }).status ?? 1;
  }
}

describe('runtime/hooks/context-refresh-trigger.mjs', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-trigger-'));
    mkdirSync(join(projectRoot, '.paqad'), { recursive: true });
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('exits 0 and stamps the debounce marker when rag is on', () => {
    expect(run(projectRoot, { PAQAD_RAG_ENABLED: 'true' })).toBe(0);
    expect(existsSync(join(projectRoot, MARKER_REL))).toBe(true);
  });

  it('is a no-op (no marker) when rag is off by default', () => {
    expect(run(projectRoot)).toBe(0);
    expect(existsSync(join(projectRoot, MARKER_REL))).toBe(false);
  });

  it('is a no-op (no marker) when paqad is disabled', () => {
    writeFileSync(join(projectRoot, '.paqad/.config'), 'paqad_enable=false\n');
    expect(run(projectRoot, { PAQAD_RAG_ENABLED: 'true' })).toBe(0);
    expect(existsSync(join(projectRoot, MARKER_REL))).toBe(false);
  });

  it('never errors and stays silent (stdout empty)', () => {
    const out = execFileSync('node', [TRIGGER], {
      env: { ...process.env, CLAUDE_PROJECT_DIR: projectRoot, PAQAD_RAG_ENABLED: 'true' },
      stdio: ['ignore', 'pipe', 'pipe'],
    }).toString('utf8');
    expect(out).toBe('');
  });
});
