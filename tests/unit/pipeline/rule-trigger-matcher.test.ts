import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { matchRuleTriggers } from '@/pipeline/rule-trigger-matcher.js';

describe('matchRuleTriggers', () => {
  it('returns no matches when compiled rules are missing', async () => {
    expect(
      await matchRuleTriggers(mkdtempSync(join(tmpdir(), 'paqad-rules-')), ['src/a.ts']),
    ).toEqual([]);
  });

  it('matches glob-like trigger patterns and the catch-all pattern', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-rules-'));
    mkdirSync(join(root, '.paqad'), { recursive: true });
    writeFileSync(
      join(root, '.paqad/compiled-rules.json'),
      JSON.stringify({
        schema_version: 1,
        generated_at: new Date().toISOString(),
        source_hash: 'sha256:test',
        rules: [
          {
            rule_id: 'RULE-1',
            title: 'API',
            source_path: 'x',
            trigger_patterns: ['src/api/*'],
            severity: 'must',
            summary: 'api',
          },
          {
            rule_id: 'RULE-2',
            title: 'All',
            source_path: 'x',
            trigger_patterns: ['**'],
            severity: 'should',
            summary: 'all',
          },
        ],
      }),
    );

    expect(await matchRuleTriggers(root, ['src/api/users'])).toEqual(['RULE-1', 'RULE-2']);
  });
});
