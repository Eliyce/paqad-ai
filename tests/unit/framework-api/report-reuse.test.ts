import { describe, expect, it } from 'vitest';

import type { FeatureBundleExport } from '@/feature-evidence/export.js';
import { renderFeatureReportHtml } from '@/feature-evidence/report.js';
import { foldRowsWithKey } from '@/stage-evidence/fold.js';
import type { SessionLedgerRow } from '@/session-ledger/ledger.js';

const DIR = '397-framework-api-index-01KXD47JQ2AKEF8C3KCMA977NB';
const AT = '2026-07-25T10:00:00.000Z';

function renderWith(reusing: Record<string, unknown>[]): string {
  const rows = [{ kind: 'open', ts: AT, adapter: 'claude-code' }] as SessionLedgerRow[];
  const bundle: FeatureBundleExport = {
    dir_name: DIR,
    exported_at: AT,
    files: {
      plan: {
        title: 'Framework reuse',
        summary: 'Reuse framework APIs.',
        reuse: {
          consulted: [{ source: 'framework-api', query: 'useId', target: 'react@19.2.6', hits: 1 }],
          reusing,
          new_constructs: [],
        },
      },
      stageEvidence: rows,
    },
  };
  const fold = foldRowsWithKey(rows, { sessionId: 's', changeKey: DIR, promptOrdinal: 0 });
  return renderFeatureReportHtml(bundle, fold, { generatedAt: AT });
}

describe('framework reuse in the feature report', () => {
  it('tags a verified claim with its package@version and says it was verified', () => {
    const html = renderWith([
      {
        symbol: 'useId',
        how: 'call as-is',
        package: 'react',
        version: '19.2.6',
        provenance: 'asserted',
      },
    ]);
    expect(html).toContain('react@19.2.6');
    expect(html).toContain('verified against the installed version');
    expect(html).toContain('1 framework-native reuse claim(s); 1 verified');
  });

  it('marks a dynamic claim as not statically verified', () => {
    const html = renderWith([
      {
        symbol: 'Component.render',
        how: 'call as-is',
        package: 'react',
        version: '19.2.6',
        provenance: 'unknown-dynamic',
      },
    ]);
    expect(html).toContain('provided dynamically');
    expect(html).toContain('1 framework-native reuse claim(s); 0 verified');
  });

  it('marks a claim with no computed provenance as unverified rather than staying silent', () => {
    const html = renderWith([{ symbol: 'useId', how: 'call as-is', package: 'react' }]);
    expect(html).toContain('not verified against an installed version');
    expect(html).toContain('>react<');
  });

  it('adds nothing for a first-party-only plan, which reads exactly as before', () => {
    const html = renderWith([
      { symbol: 'formatIsoDate', file: 'src/utils/dates.ts', how: 'call as-is' },
    ]);
    expect(html).toContain('src/utils/dates.ts');
    expect(html).not.toContain('framework-native reuse claim');
    expect(html).not.toContain('verified against the installed version');
  });
});
