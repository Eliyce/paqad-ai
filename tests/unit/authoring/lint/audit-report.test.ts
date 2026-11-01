import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { AuditUsageError } from '@/authoring/lint/audit.js';
import { AUDIT_DOC, writeAuditDoc } from '@/authoring/lint/audit-report.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function write(root: string, rel: string, content: string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}

const SKILL = (body: string) =>
  `---\nname: drafting-notes\ndescription: Drafts release notes. Use when the user asks for release notes.\n---\n${body}`;

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-audit-doc-'));
  roots.push(root);
  write(root, 'package.json', '{"name":"paqad-ai"}\n');
  write(
    root,
    '.paqad/onboarding-manifest.json',
    JSON.stringify({ adapter: 'claude-code', generated_artifacts: [] }),
  );
  write(
    root,
    'runtime/base/skills/drafting-notes/SKILL.md',
    SKILL(
      '# Notes\n\n1. Read every merged pull request in the release window carefully and fully.\n2. Group them.\n',
    ),
  );
  write(root, 'runtime/base/skills/drafting-notes/scripts/run.sh', '#!/bin/sh\necho ok\n');
  write(root, 'runtime/base/agents/router.md', '# Router\n\nYou route.\n');
  return root;
}

const read = (root: string): string => readFileSync(join(root, AUDIT_DOC), 'utf8');

describe('writeAuditDoc', () => {
  it('writes the Before section first, with the summary and one details block per group', () => {
    const root = fixture();
    expect(writeAuditDoc(root, { asOf: '2026-11-01' }).section).toBe('before');
    const doc = read(root);
    expect(doc).toContain('## Before');
    expect(doc).toContain('As of 2026-11-01: 1 skills');
    expect(doc).toContain('### By rule');
    expect(doc).toContain('### By group');
    expect(doc).toContain('<summary>skills: base (1,');
    expect(doc).toContain('no activation data');
    expect(doc).toContain('SK-010');
    expect(doc).toContain('`runtime/base/agents/router.md`');
    expect(doc).toContain('## After');
    expect(doc).toContain('Not generated yet.');
  });

  it('keeps Before byte for byte and rewrites only After with the body-token drop', () => {
    const root = fixture();
    writeAuditDoc(root, { asOf: '2026-11-01' });
    const first = read(root);
    const before = first.slice(first.indexOf('## Before'), first.indexOf('## After'));
    write(
      root,
      'runtime/base/skills/drafting-notes/SKILL.md',
      SKILL('# Notes\n\n1. Read the merged pull requests.\n2. Group them.\n'),
    );
    expect(writeAuditDoc(root, { asOf: '2026-11-02' }).section).toBe('after');
    const second = read(root);
    expect(second).toContain(before);
    const after = second.slice(second.indexOf('## After'));
    expect(after).toContain('As of 2026-11-02');
    expect(after).toContain('Body tokens before | after | drop');
    const row = after.split('\n').find((line) => line.startsWith('| `runtime/base/skills/'))!;
    const cells = row.split('|').map((cell) => cell.trim());
    expect(Number(cells[6]) - Number(cells[7])).toBe(Number(cells[8]));
    expect(Number(cells[8])).toBeGreaterThan(0);
  });

  it('is byte-identical when rerun with the same date', () => {
    const root = fixture();
    writeAuditDoc(root, { asOf: '2026-11-01' });
    writeAuditDoc(root, { asOf: '2026-11-01' });
    const once = read(root);
    writeAuditDoc(root, { asOf: '2026-11-01' });
    expect(read(root)).toBe(once);
    expect(once).not.toContain(root);
  });

  it('names the open packet beside an excepted blocking finding in After', () => {
    const root = fixture();
    writeAuditDoc(root, { asOf: '2026-11-01' });
    writeAuditDoc(root, {
      asOf: '2026-11-01',
      exceptions: new Map([['SK-010:drafting-notes', 'D-01TEST']]),
    });
    expect(read(root)).toContain('D-01TEST');
  });

  it('refuses a bad date', () => {
    expect(() => writeAuditDoc(fixture(), { asOf: 'today' })).toThrow(AuditUsageError);
  });
});
