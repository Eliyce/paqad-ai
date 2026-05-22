import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { lines, runScript } from './_helpers/run-script.js';
import { withTempDir, writeFile } from './_helpers/temp-fs.js';

const SKILL = 'runtime/base/skills/integration-doc-maintainer';
const sh = (n: string) => join(SKILL, 'scripts', n);

describe('integration-doc-maintainer', () => {
  describe('find-integration-docs.sh', () => {
    const path = sh('find-integration-docs.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('exits 0 with empty stdout when no canonical integration docs', () => {
      withTempDir((dir) => {
        writeFile(dir, 'modules/users/README.md', 'unrelated');
        const r = runScript(path, [join(dir, 'modules')]);
        expect(r.status).toBe(0);
        expect(r.stdout.trim()).toBe('');
      });
    });

    it('finds events.md / contracts.md / integration.md / integrations.md / jobs.md', () => {
      withTempDir((dir) => {
        writeFile(dir, 'modules/users/events.md', '');
        writeFile(dir, 'modules/billing/contracts.md', '');
        writeFile(dir, 'modules/orders/integration.md', '');
        writeFile(dir, 'modules/notify/integrations.md', '');
        writeFile(dir, 'modules/queue/jobs.md', '');
        const r = runScript(path, [join(dir, 'modules')]);
        const out = lines(r.stdout);
        expect(out.length).toBe(5);
      });
    });
  });

  describe('extract-events.sh', () => {
    const path = sh('extract-events.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('exits 2 with usage when no files', () => {
      const r = runScript(path);
      expect(r.status).toBe(2);
    });

    it('returns empty stdout when files have no event names', () => {
      withTempDir((dir) => {
        const f = writeFile(dir, 'a.ts', 'function foo() { return 1; }');
        const r = runScript(path, [f]);
        expect(r.status).toBe(0);
        expect(r.stdout.trim()).toBe('');
      });
    });

    it('extracts event names from emit/publish/dispatch calls', () => {
      withTempDir((dir) => {
        const f = writeFile(
          dir,
          'a.ts',
          [
            'emit("user.created", payload);',
            'eventBus.publish("order.refunded", { id });',
            'queue.dispatch("invite.invited", inv);',
          ].join('\n'),
        );
        const r = runScript(path, [f]);
        const out = lines(r.stdout);
        expect(out).toContain('user.created');
        expect(out).toContain('order.refunded');
        expect(out).toContain('invite.invited');
      });
    });

    it('extracts namespaced event-like literals with allowed verb suffixes', () => {
      withTempDir((dir) => {
        const f = writeFile(dir, 'a.ts', `const t = "session.failed"; const u = "user.deleted";`);
        const r = runScript(path, [f]);
        expect(r.stdout).toContain('session.failed');
        expect(r.stdout).toContain('user.deleted');
      });
    });

    it('output is sorted and deduplicated across multiple files', () => {
      withTempDir((dir) => {
        const a = writeFile(dir, 'a.ts', 'emit("user.created", x); emit("user.created", y);');
        const b = writeFile(dir, 'b.ts', 'emit("order.created", z);');
        const r = runScript(path, [a, b]);
        const out = lines(r.stdout);
        expect(out).toEqual([...out].sort());
        expect(new Set(out).size).toBe(out.length);
      });
    });
  });

  describe('lint-output.sh', () => {
    const path = sh('lint-output.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('passes a valid block', () => {
      const ok =
        '## Updated Integration Docs\n- `docs/modules/x/events.md` — added\n## Consistency Warnings\n- none\n';
      expect(runScript(path, [], { input: ok }).status).toBe(0);
    });

    it('passes when "Consistency Warnings: none" is the literal line', () => {
      const ok =
        '## Updated Integration Docs\n- `docs/modules/x/events.md` — y\nConsistency Warnings: none\n';
      expect(runScript(path, [], { input: ok }).status).toBe(0);
    });

    it('fails when Updated Integration Docs missing', () => {
      const r = runScript(path, [], { input: 'Consistency Warnings: none\n' });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/Updated Integration Docs/);
    });

    it('fails when Updated Integration Docs has no backticked path', () => {
      const r = runScript(path, [], {
        input: '## Updated Integration Docs\n- nothing here\nConsistency Warnings: none\n',
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/backticked .md path/);
    });
  });
});
