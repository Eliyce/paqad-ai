import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { writeGitignore } from '@/onboarding/gitignore-writer.js';
import { recordRagEvidence } from '@/rag-ledger/recorder.js';
import { readSessionDoc } from '@/session-ledger/ledger.js';
import { RAG_EVIDENCE_DOC_TYPE } from '@/rag-ledger/types.js';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(here, '../../../src');

/** Collect the `import ... from '...'` specifiers in a TS source file. */
function importSpecifiers(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  return [...text.matchAll(/^\s*import[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
}

function tsFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((entry) => entry.endsWith('.ts'))
    .map((entry) => join(dir, entry));
}

describe('rag-evidence ledger independence (#249 P3 / C1)', () => {
  it('neither src/session-ledger nor src/rag-ledger imports enterprise code', () => {
    const files = [...tsFiles(join(SRC, 'session-ledger')), ...tsFiles(join(SRC, 'rag-ledger'))];
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      for (const spec of importSpecifiers(file)) {
        expect(spec.toLowerCase()).not.toContain('enterprise');
        expect(spec).not.toContain('ai-bom');
      }
    }
  });

  it('the ledger directory is git-ignored by the managed block (no new gitignore needed)', () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-gi-'));
    try {
      writeGitignore(root);
      const gitignore = readFileSync(join(root, '.paqad', '.gitignore'), 'utf8');
      expect(gitignore).toContain('ledger/');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('records regardless of any enterprise flag (always-on)', () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-ent-'));
    try {
      // No enterprise config of any kind in this project — the recorder still writes.
      const row = recordRagEvidence(
        root,
        'refreshed',
        { refresh_kind: 'rule-context' },
        { sessionId: 'ses_ent', adapter: 'engine', ragEnabled: true },
      );
      expect(row).not.toBeNull();
      const rows = readSessionDoc(root, RAG_EVIDENCE_DOC_TYPE, 'ses_ent');
      expect(rows.some((r) => r.kind === 'refreshed')).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
