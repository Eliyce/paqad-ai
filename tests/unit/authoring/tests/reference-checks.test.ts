import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { checkSkillReferences, defaultBlockRunner } from '@/authoring/tests/reference-checks.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function setup(reference: string): { root: string; folder: string } {
  const root = mkdtempSync(join(tmpdir(), 'paqad-refs-'));
  roots.push(root);
  const folder = join(root, 'skill');
  const write = (abs: string, text: string) => {
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  };
  write(join(root, 'app/Models/Invoice.php'), '<?php\n');
  write(join(root, 'config/app.json'), JSON.stringify({ name: 'x', db: { host: 'h', port: 1 } }));
  write(join(root, 'config/queue.yaml'), 'driver: redis\nretries: 3\n');
  write(join(root, 'Makefile'), 'build: deps\n\tcc\nlint:\n\tx\nVAR := 1\n');
  write(join(root, 'package.json'), JSON.stringify({ scripts: { 'invoices:import': 'x' } }));
  write(join(folder, 'SKILL.md'), '---\nname: skill\n---\n');
  write(join(folder, 'scripts/extract.ts'), '');
  write(join(folder, 'references/guide.md'), reference);
  return { root, folder };
}

describe('reference checks', () => {
  it('passes a reference whose paths and commands exist and that carries a verification date', () => {
    const { root, folder } = setup(
      'verified: 2026-10-31\n\nSee `app/Models/Invoice.php`, `scripts/extract.ts` and run `npm run invoices:import`.\n',
    );
    expect(checkSkillReferences({ skillFolder: folder, projectRoot: root })).toEqual([]);
  });

  it('AC-28: fails a missing path or command with file and line, unless marked external', () => {
    const { root, folder } = setup(
      [
        'human-verified: 2026-10-31',
        'Read `app/Models/Missing.php`.',
        'Run `pnpm run nope`.',
        'The vendor docs live at `vendor/docs/api.md` (external).',
      ].join('\n'),
    );
    expect(checkSkillReferences({ skillFolder: folder, projectRoot: root })).toEqual([
      {
        file: 'references/guide.md',
        line: 2,
        message: 'The path app/Models/Missing.php does not exist. Fix it or mark it external.',
      },
      {
        file: 'references/guide.md',
        line: 3,
        message:
          'The command "pnpm run nope" names a script the project does not define. Fix it or mark it external.',
      },
    ]);
  });

  it('AC-28: fails a runnable block that exits non-zero, at its fence line', () => {
    const { root, folder } = setup(
      'verified: 2026-10-31\n\n```bash runnable\nexit 3\n```\n\n```bash\nexit 4\n```\n',
    );
    const ran: string[] = [];
    const findings = checkSkillReferences({
      skillFolder: folder,
      projectRoot: root,
      runner: (language, code) => {
        ran.push(`${language}:${code}`);
        return { exitCode: 3, output: '' };
      },
    });
    expect(ran).toEqual(['bash:exit 3']);
    expect(findings).toEqual([
      { file: 'references/guide.md', line: 3, message: 'The runnable block exits 3.' },
    ]);
  });

  it('runs a real runnable block through the default runner', () => {
    expect(defaultBlockRunner('bash', 'exit 0', process.cwd()).exitCode).toBe(0);
    expect(defaultBlockRunner('node', 'process.exit(2)', process.cwd()).exitCode).toBe(2);
  });

  it('fails a reference with no verification date', () => {
    const { root, folder } = setup('Plain text.\n');
    expect(checkSkillReferences({ skillFolder: folder, projectRoot: root })[0]).toMatchObject({
      line: 1,
      message: expect.stringContaining('carries no verification date'),
    });
  });
  it('AC-28: validates JSON and YAML examples against the named real file by key', () => {
    const fence = '```';
    const { root, folder } = setup(
      [
        'verified: 2026-10-31',
        `${fence}json validates=config/app.json`,
        '{ "db": { "host": "h" } }',
        fence,
        `${fence}yaml validates=config/queue.yaml`,
        'driver: redis',
        'timeout: 5',
        fence,
        `${fence}json validates=config/missing.json`,
        '{}',
        fence,
      ].join('\n'),
    );
    expect(checkSkillReferences({ skillFolder: folder, projectRoot: root })).toEqual([
      {
        file: 'references/guide.md',
        line: 5,
        message: 'The example uses keys config/queue.yaml does not have: timeout.',
      },
      {
        file: 'references/guide.md',
        line: 9,
        message: 'The example names config/missing.json, which does not exist.',
      },
    ]);
  });

  it('asks for human-verified on an example it cannot validate, and accepts it once marked', () => {
    const fence = '```';
    const block = [`${fence}blade validates=resources/views/a.blade.php`, '{{ $x }}', fence];
    const unmarked = setup(['verified: 2026-10-31', ...block].join('\n'));
    expect(
      checkSkillReferences({ skillFolder: unmarked.folder, projectRoot: unmarked.root })[0]!
        .message,
    ).toContain('Mark the reference human-verified: <date>.');
    const marked = setup(['human-verified: 2026-10-31', ...block].join('\n'));
    expect(checkSkillReferences({ skillFolder: marked.folder, projectRoot: marked.root })).toEqual(
      [],
    );
  });

  it('checks make targets as commands', () => {
    const { root, folder } = setup(
      'verified: 2026-10-31\n\nRun `make build` then `make deploy`.\n',
    );
    expect(checkSkillReferences({ skillFolder: folder, projectRoot: root })).toEqual([
      {
        file: 'references/guide.md',
        line: 3,
        message:
          'The command "make deploy" names a make target the project does not define. Fix it or mark it external.',
      },
    ]);
  });
});
