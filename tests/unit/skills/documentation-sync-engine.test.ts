import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { lines, runScript } from './_helpers/run-script.js';

const SKILL = 'runtime/base/skills/documentation-sync-engine';
const sh = (n: string) => join(SKILL, 'scripts', n);

describe('documentation-sync-engine', () => {
  describe('route-paths.sh', () => {
    const path = sh('route-paths.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('emits empty stdout (exit 0) on empty stdin', () => {
      const r = runScript(path, [], { input: '' });
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe('');
    });

    it('routes api/endpoints/schemas/error-codes paths to api domain (most specific)', () => {
      const r = runScript(path, [], {
        input:
          'docs/modules/x/api/endpoints.md\ndocs/modules/x/api/schemas.md\ndocs/modules/x/api/error-codes.md\n',
      });
      const out = lines(r.stdout);
      expect(out).toEqual(out.filter((l) => l.startsWith('api\t')));
      expect(out.length).toBe(3);
    });

    it('routes events/contracts/integration(s) paths to integration domain', () => {
      const r = runScript(path, [], {
        input:
          'docs/modules/x/events.md\ndocs/modules/x/contracts.md\ndocs/modules/x/integration.md\ndocs/modules/x/integrations.md\n',
      });
      const out = lines(r.stdout);
      expect(out.length).toBe(4);
      expect(out.every((l) => l.startsWith('integration\t'))).toBe(true);
    });

    it('routes a non-api error-codes.md to the error domain', () => {
      const r = runScript(path, [], { input: 'docs/modules/x/error-codes.md\n' });
      expect(r.stdout.trim()).toBe('error\tdocs/modules/x/error-codes.md');
    });

    it('routes glossary paths to glossary domain', () => {
      const r = runScript(path, [], {
        input: '.paqad/glossary.md\ndocs/maintainers/glossary-extras.md\n',
      });
      const out = lines(r.stdout);
      expect(out.every((l) => l.startsWith('glossary\t'))).toBe(true);
    });

    it('routes anything else to canonical', () => {
      const r = runScript(path, [], {
        input: 'docs/modules/x/README.md\ndocs/business/governance.md\n',
      });
      const out = lines(r.stdout);
      expect(out.every((l) => l.startsWith('canonical\t'))).toBe(true);
    });

    it('output is sorted and deduped', () => {
      const r = runScript(path, [], {
        input: 'docs/b.md\ndocs/a.md\ndocs/a.md\n',
      });
      const out = lines(r.stdout);
      expect(out).toEqual([...out].sort());
      expect(new Set(out).size).toBe(out.length);
    });
  });

  describe('lint-output.sh', () => {
    const path = sh('lint-output.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('passes the empty short-circuit literal', () => {
      const r = runScript(path, [], {
        input: 'Documentation Sync: no canonical docs require update.\n',
      });
      expect(r.status).toBe(0);
    });

    it('passes a valid block with allowed delegate domain headings', () => {
      const ok = [
        '## Documentation Sync',
        '',
        'Stale Doc Set: Detected: 3 | Routed: 3 | Skipped (target_domains filter): 0',
        '',
        '### api',
        '- `docs/modules/x/api/endpoints.md` — POST',
        '',
        '### canonical',
        '- `docs/modules/x/README.md` — added refund',
        '',
        'Known Drift: none',
      ].join('\n');
      expect(runScript(path, [], { input: ok }).status).toBe(0);
    });

    it('rejects an unknown delegate domain heading', () => {
      const bad = [
        '## Documentation Sync',
        'Stale Doc Set: Detected: 1 | Routed: 1 | Skipped (target_domains filter): 0',
        '### marketing',
        '- `x.md`',
        'Known Drift: none',
      ].join('\n');
      const r = runScript(path, [], { input: bad });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/unknown delegate domain: marketing/);
    });

    it('fails on malformed Stale Doc Set summary', () => {
      const r = runScript(path, [], {
        input: '## Documentation Sync\nStale Doc Set: detected 5\nKnown Drift: none\n',
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/Stale Doc Set/);
    });

    it('fails when "Known Drift" missing', () => {
      const r = runScript(path, [], {
        input:
          '## Documentation Sync\nStale Doc Set: Detected: 1 | Routed: 1 | Skipped (target_domains filter): 0\n',
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/Known Drift/);
    });
  });
});
