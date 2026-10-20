import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { featureFilePath } from '@/feature-evidence/paths.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import {
  collectFeatureTechDebt,
  readFeatureTechDebtIndex,
  writeFeatureTechDebtIndex,
} from '@/feature-evidence/tech-debt-index.js';
import { TECH_DEBT_DOC_TYPE } from '@/feature-evidence/types.js';
import { closeTechDebt, raiseTechDebt } from '@/tech-debt/index.js';

const SES = 'td-index-sess';
const ULID = '01JABCDEFGHJKMNPQRSTVWXYZ0';

describe('tech-debt.json bundle index', () => {
  let root: string;
  let dir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-td-index-'));
    mkdirSync(join(root, '.paqad/session'), { recursive: true });
    dir = openFeatureChange(root, SES, { adapter: 'claude-code', title: 'A change', ulid: ULID });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const raise = (title: string, change: string | null) =>
    raiseTechDebt(root, {
      title,
      kind: 'bug',
      severity: 'high',
      files: [],
      foundIn: { change },
    });

  it('writes nothing while the change raised no items', () => {
    raise('elsewhere', 'OTHER');
    expect(writeFeatureTechDebtIndex(root, dir)).toEqual({ path: null, items: [], written: false });
    expect(readFeatureTechDebtIndex(root, dir)).toBeNull();
  });

  it('lists only this change items, once, and rewrites only on a change', () => {
    const b = raise('B item', ULID);
    const a = raise('A item', ULID);
    raise('B item', ULID);
    raise('other', null);

    const first = writeFeatureTechDebtIndex(root, dir, { sessionId: SES });
    expect(first.written).toBe(true);
    const ids = [a.id, b.id].sort();
    expect(first.items.map((item) => item.id)).toEqual(ids);
    const doc = JSON.parse(readFileSync(join(root, featureFilePath(dir, 'techDebt')), 'utf8')) as {
      doc_type: string;
      items: unknown[];
    };
    expect(doc.doc_type).toBe(TECH_DEBT_DOC_TYPE);
    expect(doc.items).toEqual(collectFeatureTechDebt(root, dir));
    expect(writeFeatureTechDebtIndex(root, dir).written).toBe(false);

    closeTechDebt(root, a.id, 'done');
    expect(writeFeatureTechDebtIndex(root, dir).written).toBe(false);
    expect(readFeatureTechDebtIndex(root, dir)).toEqual([
      { id: ids[0], title: ids[0] === a.id ? 'A item' : 'B item', kind: 'bug', severity: 'high' },
      { id: ids[1], title: ids[1] === a.id ? 'A item' : 'B item', kind: 'bug', severity: 'high' },
    ]);
  });

  it('is rebuilt by raise when the active bundle is passed', () => {
    const item = raiseTechDebt(
      root,
      { title: 'X', kind: 'gap', severity: 'low', files: [], foundIn: { change: ULID } },
      new Date(),
      { dirName: dir, sessionId: SES },
    );
    expect(readFeatureTechDebtIndex(root, dir)?.map((entry) => entry.id)).toEqual([item.id]);
  });
});
