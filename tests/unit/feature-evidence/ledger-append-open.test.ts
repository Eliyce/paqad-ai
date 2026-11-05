import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { featureDir, featureFilePath } from '@/feature-evidence/paths.js';
import { appendFeatureStageRow } from '@/feature-evidence/stage-ledger.js';

const DIR = 'ledger-open-01JABCDEFGHJKMNPQRSTVWXYZ0';
const SESSION = 'ses_ledger_open';

const opens = vi.hoisted(() => ({
  count: 0,
  failures: [] as string[],
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    openSync: (...args: Parameters<typeof actual.openSync>) => {
      const [path, flags] = args;
      if (flags === 'a' && String(path).endsWith('stage-evidence.jsonl')) {
        opens.count += 1;
        const code = opens.failures.shift();
        if (code !== undefined) throw Object.assign(new Error(code), { code });
      }
      return actual.openSync(...args);
    },
  };
});

let root: string;

beforeEach(() => {
  opens.count = 0;
  opens.failures = [];
  root = mkdtempSync(join(tmpdir(), 'paqad-ledger-open-'));
  mkdirSync(join(root, featureDir(DIR)), { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function append() {
  return appendFeatureStageRow(root, SESSION, DIR, { kind: 'open' });
}

function codeOf(action: () => unknown): unknown {
  try {
    action();
  } catch (error) {
    return (error as NodeJS.ErrnoException).code;
  }
  return null;
}

describe('opening the stage ledger to append', () => {
  it('retries once after creating the folder, and writes the row', () => {
    opens.failures = ['ENOENT'];
    append();
    expect(opens.count).toBe(2);
    const ledger = readFileSync(join(root, featureFilePath(DIR, 'stageEvidence')), 'utf8');
    expect(ledger.trim().split('\n')).toHaveLength(1);
  });

  it('gives up after the second open when the file still cannot be opened', () => {
    opens.failures = ['ENOENT', 'ENOENT', 'ENOENT'];
    expect(codeOf(append)).toBe('ENOENT');
    expect(opens.count).toBe(2);
  });

  it('rethrows any other error from the first open without a retry', () => {
    opens.failures = ['EACCES'];
    expect(codeOf(append)).toBe('EACCES');
    expect(opens.count).toBe(1);
  });

  it('rethrows any other error from the retry', () => {
    opens.failures = ['ENOENT', 'EACCES'];
    expect(codeOf(append)).toBe('EACCES');
    expect(opens.count).toBe(2);
  });
});
