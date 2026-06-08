import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import {
  readTriageLedger,
  recordVerdict,
  toLedgerEntry,
  writeTriageLedger,
} from '@/triage/ledger.js';
import type { TriageFinding, TriageVerdict } from '@/core/types/triage.js';

const NOW = '2026-06-08T00:00:00.000Z';

const FINDING: TriageFinding = {
  id: 'F-1',
  source: 'adversarial-reviewer',
  kind: 'naming-preference',
  message: 'prefer camelCase',
  file: 'src/x.ts',
  line: 3,
  signals: { style_only: true },
};

const TASTE_VERDICT: TriageVerdict = {
  finding_id: 'F-1',
  pile: 'taste',
  ambiguous: false,
  route: 'record',
  reason: 'taste',
};

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'paqad-triage-ledger-'));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe('triage ledger', () => {
  it('returns an empty ledger when none exists yet', async () => {
    const ledger = await readTriageLedger(projectRoot, NOW);
    expect(ledger.entries).toEqual([]);
    expect(ledger.schema_version).toBe('1.0.0');
    expect(ledger.updated_at).toBe(NOW);
  });

  it('writes and reads back a ledger atomically', async () => {
    const ledger = recordVerdict(
      await readTriageLedger(projectRoot, NOW),
      FINDING,
      TASTE_VERDICT,
      NOW,
    );
    const path = await writeTriageLedger(projectRoot, ledger);
    expect(path).toBe(join(projectRoot, PATHS.TRIAGE_LEDGER));

    const reread = await readTriageLedger(projectRoot);
    expect(reread.entries).toHaveLength(1);
    expect(reread.entries[0]).toMatchObject({
      finding_id: 'F-1',
      pile: 'taste',
      route: 'record',
      reason: 'taste',
      file: 'src/x.ts',
      line: 3,
    });
  });

  it('records a confirmed verdict with its confirmation sub-state', () => {
    const entry = toLedgerEntry(
      { ...FINDING, file: undefined, line: undefined },
      {
        finding_id: 'F-1',
        pile: 'confirmed',
        ambiguous: false,
        confirmation: 'demonstrable',
        route: 'code-change',
        reason: 'confirmed',
      },
      NOW,
    );
    expect(entry.confirmation).toBe('demonstrable');
    expect(entry.file).toBeNull();
    expect(entry.line).toBeNull();
  });

  it('omits confirmation when the verdict has none', () => {
    const entry = toLedgerEntry(FINDING, TASTE_VERDICT, NOW);
    expect(entry).not.toHaveProperty('confirmation');
  });

  it('replaces an existing entry for the same finding rather than duplicating', () => {
    let ledger = recordVerdict(
      { schema_version: '1.0.0', updated_at: NOW, entries: [] },
      FINDING,
      TASTE_VERDICT,
      NOW,
    );
    const later = '2026-06-09T00:00:00.000Z';
    ledger = recordVerdict(
      ledger,
      FINDING,
      { ...TASTE_VERDICT, pile: 'false-alarm', reason: 'changed my mind' },
      later,
    );
    expect(ledger.entries).toHaveLength(1);
    expect(ledger.entries[0].pile).toBe('false-alarm');
    expect(ledger.updated_at).toBe(later);
  });

  it('appends entries for distinct findings', () => {
    let ledger = recordVerdict(
      { schema_version: '1.0.0', updated_at: NOW, entries: [] },
      FINDING,
      TASTE_VERDICT,
      NOW,
    );
    ledger = recordVerdict(
      ledger,
      { ...FINDING, id: 'F-2' },
      { ...TASTE_VERDICT, finding_id: 'F-2' },
      NOW,
    );
    expect(ledger.entries.map((e) => e.finding_id)).toEqual(['F-1', 'F-2']);
  });

  it('treats a corrupt or malformed ledger file as empty (never blocks a build)', async () => {
    const path = join(projectRoot, PATHS.TRIAGE_LEDGER);
    mkdirSync(dirname(path), { recursive: true });

    writeFileSync(path, '{ not valid json');
    expect((await readTriageLedger(projectRoot, NOW)).entries).toEqual([]);

    writeFileSync(path, JSON.stringify({ schema_version: '1.0.0', entries: 'nope' }));
    expect((await readTriageLedger(projectRoot, NOW)).entries).toEqual([]);
  });
});
