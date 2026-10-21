import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { aggregateSiemEvents } from '@/audit/aggregate';
import { HEALTH_RUN_DOC_TYPE } from '@/codebase-health/ledger';
import { DELIVERY_EVIDENCE_DOC_TYPE } from '@/delivery/delivery-ledger';
import { CHANGE_METRICS_RUN_DOC_TYPE, RULE_RUN_DOC_TYPE } from '@/feature-evidence/bundle-ledgers';
import { featureFilePath, formatFeatureDirName } from '@/feature-evidence/paths';
import { DECISION_EVIDENCE_DOC_TYPE } from '@/planning/decision-ledger';
import { DISABLED_SESSION_DOC_TYPE } from '@/session-ledger/disabled-audit';
import { appendSessionEvent } from '@/session-ledger/ledger';
import { SITE_MAP_RUN_DOC_TYPE } from '@/site-map/ledger';
import { STAGE_EVIDENCE_DOC_TYPE } from '@/stage-evidence/types';

const TS = '2026-06-20T00:00:00.000Z';
const DIR = formatFeatureDirName({ issue: null, slug: 'x', ulid: '01ARZ3NDEKTSV4RRFFQ69G5FAV' });

describe('aggregateSiemEvents session details for sparse rows', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-audit-detail-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function bundleRows(file: 'ruleRun' | 'stageEvidence' | 'changeMetrics', rows: object[]): void {
    const path = join(root, featureFilePath(DIR, file));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      rows
        .map((row, index) =>
          JSON.stringify({ session_id: 's', ts: TS, content_hash: `h${index}`, ...row }),
        )
        .join('\n'),
    );
  }

  function eventsFor(docType: string): { verdict: string; detail?: string }[] {
    return aggregateSiemEvents(root)
      .filter((event) => event.kind === 'session' && event.doc_type === docType)
      .map((event) => ({ verdict: event.verdict, detail: event.detail }));
  }

  it('falls back to the row kind or a plain word when the identifying fields are missing', () => {
    appendSessionEvent(root, DECISION_EVIDENCE_DOC_TYPE, 's', 0, { kind: 'opened', ts: TS });
    appendSessionEvent(root, DECISION_EVIDENCE_DOC_TYPE, 's', 0, { ts: TS });
    appendSessionEvent(root, DELIVERY_EVIDENCE_DOC_TYPE, 's', 0, { kind: 'detected', ts: TS });
    appendSessionEvent(root, DISABLED_SESSION_DOC_TYPE, 's', 0, { ts: TS });
    appendSessionEvent(root, HEALTH_RUN_DOC_TYPE, 's', 0, { ts: TS });
    appendSessionEvent(root, SITE_MAP_RUN_DOC_TYPE, 's', 0, { ts: TS, event_status: 'partial' });

    expect(eventsFor(DECISION_EVIDENCE_DOC_TYPE)).toEqual(
      expect.arrayContaining([
        { verdict: 'opened', detail: 'opened' },
        { verdict: 'recorded', detail: 'record' },
      ]),
    );
    expect(eventsFor(DELIVERY_EVIDENCE_DOC_TYPE)).toEqual([
      { verdict: 'detected', detail: 'detected' },
    ]);
    expect(eventsFor(DISABLED_SESSION_DOC_TYPE)).toEqual([
      { verdict: 'disabled', detail: 'disabled' },
    ]);
    expect(eventsFor(HEALTH_RUN_DOC_TYPE)).toEqual([
      { verdict: 'recorded', detail: 'health run  · 0 finding(s)' },
    ]);
    expect(eventsFor(SITE_MAP_RUN_DOC_TYPE)).toEqual([
      { verdict: 'partial', detail: 'site-map run  · 0 surface(s) · 0 finding(s)' },
    ]);
  });

  it('describes rule runs, stage rows and change metrics from bundle files', () => {
    bundleRows('ruleRun', [
      { doc_type: RULE_RUN_DOC_TYPE, kind: 'drift', blocked: true },
      { doc_type: RULE_RUN_DOC_TYPE, kind: 'drift' },
      { doc_type: RULE_RUN_DOC_TYPE, kind: 'findings' },
      { doc_type: RULE_RUN_DOC_TYPE, kind: 'skipped' },
    ]);
    bundleRows('stageEvidence', [{ doc_type: STAGE_EVIDENCE_DOC_TYPE, kind: 'open' }]);
    bundleRows('changeMetrics', [{ doc_type: CHANGE_METRICS_RUN_DOC_TYPE, kind: 'measured' }]);

    expect(eventsFor(RULE_RUN_DOC_TYPE).map((event) => event.detail)).toEqual(
      expect.arrayContaining(['drift blocked', 'drift clean', 'findings clean', 'skipped']),
    );
    expect(eventsFor(STAGE_EVIDENCE_DOC_TYPE)).toEqual([{ verdict: 'open', detail: 'open' }]);
    expect(eventsFor(CHANGE_METRICS_RUN_DOC_TYPE)).toEqual([
      { verdict: 'measured', detail: 'measured' },
    ]);
  });
});
