import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { lines, runScript } from './_helpers/run-script.js';
import { withTempDir, writeFile } from './_helpers/temp-fs.js';

const SKILL = 'runtime/capabilities/security/skills/dependency-advisory-triage';
const sh = (n: string) => join(SKILL, 'scripts', n);

describe('dependency-advisory-triage', () => {
  describe('normalize-advisories.sh', () => {
    const path = sh('normalize-advisories.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('exits 2 with usage when no files', () => {
      expect(runScript(path).status).toBe(2);
    });

    it('parses npm-audit shape into JSONL records', () => {
      withTempDir((dir) => {
        const f = writeFile(
          dir,
          'npm.json',
          JSON.stringify({
            vulnerabilities: {
              lodash: {
                name: 'lodash',
                severity: 'high',
                range: '<4.17.21',
                via: [
                  {
                    url: 'https://github.com/advisories/GHSA-x',
                    source: 1,
                    title: 'Prototype pollution',
                  },
                ],
              },
            },
          }),
        );
        const r = runScript(path, [f]);
        expect(r.status).toBe(0);
        const records = lines(r.stdout).map((l) => JSON.parse(l));
        expect(records.length).toBe(1);
        expect(records[0]).toMatchObject({
          ecosystem: 'npm',
          package: 'lodash',
          severity: 'high',
        });
        expect(records[0].sources).toContain('npm.json');
      });
    });

    it('parses OSV shape', () => {
      withTempDir((dir) => {
        const f = writeFile(
          dir,
          'osv.json',
          JSON.stringify({
            vulns: [
              {
                id: 'GHSA-y',
                summary: 'XSS in foo',
                affected: [{ package: { ecosystem: 'npm', name: 'foo' } }],
                database_specific: { severity: 'medium' },
              },
            ],
          }),
        );
        const r = runScript(path, [f]);
        const records = lines(r.stdout).map((l) => JSON.parse(l));
        expect(records[0]).toMatchObject({
          ecosystem: 'npm',
          package: 'foo',
          advisory_id: 'GHSA-y',
          severity: 'medium',
        });
      });
    });

    it('merges duplicates across two artifacts taking max severity and longest title', () => {
      withTempDir((dir) => {
        const npm = writeFile(
          dir,
          'npm.json',
          JSON.stringify({
            vulnerabilities: {
              lodash: {
                name: 'lodash',
                severity: 'high',
                via: [{ url: 'GHSA-x', title: 'short' }],
              },
            },
          }),
        );
        const osv = writeFile(
          dir,
          'osv.json',
          JSON.stringify({
            vulns: [
              {
                id: 'GHSA-x',
                summary: 'a much longer description of the same vulnerability',
                affected: [{ package: { ecosystem: 'npm', name: 'lodash' } }],
                database_specific: { severity: 'critical' },
              },
            ],
          }),
        );
        const r = runScript(path, [npm, osv]);
        const records = lines(r.stdout).map((l) => JSON.parse(l));
        // Same key (npm|lodash|GHSA-x) → one merged record.
        expect(records.length).toBe(1);
        expect(records[0].severity).toBe('critical');
        expect(records[0].sources.length).toBe(2);
      });
    });

    it('skips files that do not exist (note on stderr)', () => {
      const r = runScript(path, ['/no/such/file.json']);
      expect(r.status).toBe(0);
      expect(r.stderr).toMatch(/missing/);
    });
  });

  describe('lint-output.sh', () => {
    const path = sh('lint-output.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('passes valid block', () => {
      const ok = [
        '## Dependency Findings',
        '### npm:lodash — GHSA-x',
        '- **Severity:** high',
        '- **Installed:** 4.17.20',
        '- **Sources:** npm-audit',
        '- **Title:** Prototype pollution',
        '- **Remediation:** upgrade to >= 4.17.21',
      ].join('\n');
      expect(runScript(path, [], { input: ok }).status).toBe(0);
    });

    it('fails when key is duplicated', () => {
      const dup = [
        '## Dependency Findings',
        '### npm:lodash — GHSA-x',
        '- **Severity:** high',
        '- **Installed:** 4.17.20',
        '- **Sources:** npm-audit',
        '- **Remediation:** y',
        '### npm:lodash — GHSA-x',
        '- **Severity:** high',
        '- **Installed:** 4.17.20',
        '- **Sources:** npm-audit',
        '- **Remediation:** y',
      ].join('\n');
      const r = runScript(path, [], { input: dup });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/duplicate/);
    });

    it('fails when "## Dependency Findings" missing', () => {
      const r = runScript(path, [], { input: '### npm:foo — x\n' });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/Dependency Findings/);
    });
  });
});
