import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runScript } from './_helpers/run-script.js';
import { withTempDir, writeFile } from './_helpers/temp-fs.js';

const SKILL = 'runtime/capabilities/coding/skills/copy-and-ia-review';
const sh = (n: string) => join(SKILL, 'scripts', n);

describe('copy-and-ia-review', () => {
  describe('lint-findings.sh', () => {
    const path = sh('lint-findings.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('accepts a copy finding citing patterns.md', () => {
      const body = [
        '## Findings',
        '- **medium** (patterns.md → terminology) — auth / copy: User vs Member mismatch. Evidence: `src/Settings.tsx:42`. Required action: standardize on Member.',
      ].join('\n');
      expect(runScript(path, [], { input: body }).status).toBe(0);
    });

    it('rejects when Findings heading is missing', () => {
      const r = runScript(path, [], { input: '- nope' });
      expect(r.status).toBe(1);
    });
  });

  describe('extract-user-strings.sh', () => {
    const path = sh('extract-user-strings.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('emits stderr note when search root is missing', () => {
      const r = runScript(path, ['/no/such/dir']);
      expect(r.status).toBe(0);
      expect(r.stderr).toMatch(/search root not found/);
    });

    it('extracts aria-label, placeholder, title, and JSX text', () => {
      withTempDir((dir) => {
        const root = `${dir}/src`;
        writeFile(dir, 'src/A.tsx', '<button aria-label="Open menu" />');
        writeFile(dir, 'src/B.tsx', '<input placeholder="Search products" />');
        writeFile(dir, 'src/C.tsx', '<a href="/" title="Home page">x</a>');
        writeFile(dir, 'src/D.tsx', '<h1>Welcome to Paqad</h1>');
        const r = runScript(path, [root]);
        expect(r.status).toBe(0);
        const rows = r.stdout.split('\n').filter((l) => l.length > 0);
        const cats = rows.map((row) => row.split('\t')[0]);
        expect(cats).toContain('aria-label');
        expect(cats).toContain('placeholder');
        expect(cats).toContain('title');
        expect(cats).toContain('jsx-text');
        const strings = rows.map((row) => row.split('\t')[2]);
        expect(strings).toContain('Open menu');
        expect(strings).toContain('Search products');
        expect(strings).toContain('Home page');
        expect(strings).toContain('Welcome to Paqad');
      });
    });
  });

  describe('check-action-verbs.sh', () => {
    const path = sh('check-action-verbs.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('requires --verbs', () => {
      const r = runScript(path, []);
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/--verbs/);
    });

    it('flags button labels outside the declared verb set', () => {
      withTempDir((dir) => {
        const root = `${dir}/src`;
        writeFile(dir, 'src/A.tsx', '<button>OK</button>');
        writeFile(dir, 'src/B.tsx', '<Button>Yes</Button>');
        writeFile(dir, 'src/C.tsx', '<button>Save</button>');
        const r = runScript(path, [
          '--verbs',
          'Save, Cancel, Delete, Submit, Done',
          '--root',
          root,
        ]);
        expect(r.status).toBe(0);
        expect(r.stdout).toMatch(/A\.tsx.*\tOK$/m);
        expect(r.stdout).toMatch(/B\.tsx.*\tYes$/m);
        expect(r.stdout).not.toMatch(/C\.tsx/);
      });
    });

    it('matching is case-insensitive', () => {
      withTempDir((dir) => {
        const root = `${dir}/src`;
        writeFile(dir, 'src/A.tsx', '<button>save</button>');
        const r = runScript(path, ['--verbs', 'Save', '--root', root]);
        expect(r.status).toBe(0);
        expect(r.stdout.trim()).toBe('');
      });
    });
  });

  describe('check-terminology.sh', () => {
    const path = sh('check-terminology.sh');

    it('--help exits 0', () => {
      expect(runScript(path, ['--help']).status).toBe(0);
    });

    it('requires --preferred and --avoid', () => {
      expect(runScript(path, []).status).toBe(2);
      expect(runScript(path, ['--preferred', 'Member']).status).toBe(2);
    });

    it('flags every disallowed term usage and reports the preferred term', () => {
      withTempDir((dir) => {
        const root = `${dir}/src`;
        writeFile(dir, 'src/Settings.tsx', '<h1>User Settings</h1>');
        writeFile(dir, 'src/Team.tsx', '<p>Add a user to the team.</p>');
        writeFile(dir, 'src/OK.tsx', '<h1>Member directory</h1>');
        const r = runScript(path, [
          '--preferred',
          'Member',
          '--avoid',
          'User,Account',
          '--root',
          root,
        ]);
        expect(r.status).toBe(0);
        const rows = r.stdout.split('\n').filter((l) => l.length > 0);
        expect(
          rows.find((row) => row.includes('Settings.tsx') && /\tUser\tMember$/.test(row)),
        ).toBeTruthy();
        expect(
          rows.find((row) => row.includes('Team.tsx') && /\tuser\tMember$/.test(row)),
        ).toBeTruthy();
        expect(rows.find((row) => row.includes('OK.tsx'))).toBeUndefined();
      });
    });
  });
});
