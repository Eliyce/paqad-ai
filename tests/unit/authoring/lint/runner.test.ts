import { describe, expect, it } from 'vitest';

import {
  checkDynamic,
  checkEmDash,
  checkNeverWrite,
  checkSecrets,
  checkShouted,
  countFindings,
  FindingSink,
  formatLintJson,
  lintExitCode,
  sortFindings,
} from '@/authoring/lint/runner.js';

function file(text: string) {
  return { rel: 'agent.md', lines: text.split('\n') };
}

describe('the shared lint runner', () => {
  it('sorts by file, line, rule and message and counts severities', () => {
    const sink = new FindingSink();
    sink.warn('X-2', 'b.md', 1, 'w');
    sink.block('X-1', 'a.md', 3, 'z');
    sink.block('X-1', 'a.md', 3, 'a');
    sink.block('X-0', 'a.md', 3, 'a');
    sink.block('X-9', 'a.md', 1, 'a');
    const sorted = sortFindings(sink.findings);
    expect(
      sorted.map((finding) => `${finding.file}:${finding.line}:${finding.rule}:${finding.message}`),
    ).toEqual(['a.md:1:X-9:a', 'a.md:3:X-0:a', 'a.md:3:X-1:a', 'a.md:3:X-1:z', 'b.md:1:X-2:w']);
    expect(countFindings(sorted)).toEqual({ blocking: 4, warnings: 1 });
    expect(lintExitCode({ blocking: 0 })).toBe(0);
    expect(lintExitCode({ blocking: 2 })).toBe(1);
    expect(formatLintJson({ a: 1 })).toBe('{\n  "a": 1\n}\n');
  });

  it('runs the shared checks under the rule id it is given', () => {
    const sink = new FindingSink();
    const target = file('one — two\nYou MUST stop\nin order to win\nrun #4 today');
    checkEmDash(sink, 'AG-013', target);
    checkShouted(sink, 'AG-020', target);
    checkNeverWrite(sink, 'AG-021', target, /in order to/giu);
    checkDynamic(sink, 'AG-019', target, { firstLine: 1, message: 'dynamic' });
    expect(sortFindings(sink.findings).map((finding) => [finding.rule, finding.line])).toEqual([
      ['AG-013', 1],
      ['AG-020', 2],
      ['AG-021', 3],
      ['AG-019', 4],
    ]);
  });

  it('skips exempt lines and lines before the first line, and takes extra patterns', () => {
    const sink = new FindingSink();
    checkDynamic(sink, 'R', file('2026-01-01\nverified 2026-01-02\nid 1a2b3c4d\n10:30'), {
      firstLine: 2,
      exempt: /verified/u,
      extraPatterns: [/\b[0-9a-f]{8}\b/u, /\b\d{1,2}:\d{2}\b/u],
      message: 'dynamic',
    });
    expect(sink.findings.map((finding) => finding.line)).toEqual([3, 4]);
  });

  it('reports a secret with its fingerprint under the given rule', () => {
    const sink = new FindingSink();
    checkSecrets(sink, 'AG-012', [{ path: 'agent.md', content: 'key: AKIAIOSFODNN7EXAMPLE\n' }]);
    expect(sink.findings).toHaveLength(1);
    expect(sink.findings[0]).toMatchObject({ rule: 'AG-012', severity: 'block', file: 'agent.md' });
    expect(sink.findings[0]!.fingerprint).toBeTruthy();
    expect(sink.findings[0]!.message).not.toContain('AKIAIOSFODNN7EXAMPLE');
  });
});
