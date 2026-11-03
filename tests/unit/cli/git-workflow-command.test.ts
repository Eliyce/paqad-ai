import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import {
  createGitWorkflowCommand,
  runChange,
  runCheck,
  runCheckCommit,
  runCheckPush,
  runSetup,
} from '@/cli/commands/git-workflow.js';
import { PATHS } from '@/core/constants/paths.js';
import type { DeliveryShell } from '@/delivery/runner.js';
import { applyEdits, parseEdits, readJsonFile } from '@/git-workflow/change.js';
import { renderDefaultGitWorkflowFile } from '@/git-workflow/defaults.js';
import { stampLastApplied } from '@/git-workflow/last-applied.js';
import { GIT_WORKFLOW_FILES } from '@/git-workflow/types.js';

let root: string;
let out: string[];
let err: string[];
const dir = () => join(root, PATHS.GIT_WORKFLOW_DIR);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-wf-cmd-'));
  out = [];
  err = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    out.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    err.push(String(chunk));
    return true;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
  rmSync(root, { recursive: true, force: true });
});

function writeDefaults(): void {
  mkdirSync(dir(), { recursive: true });
  for (const file of GIT_WORKFLOW_FILES) {
    writeFileSync(join(dir(), file), renderDefaultGitWorkflowFile(file, { version: '1.0.0' }));
  }
  stampLastApplied(root);
}

async function cli(...args: string[]): Promise<void> {
  await createGitWorkflowCommand().parseAsync([...args, '--project-root', root], { from: 'user' });
}

function gitShell(): DeliveryShell {
  return {
    async run(command, args) {
      if (command === 'git' && args[0] === 'rev-parse') {
        return { stdout: '.git', stderr: '', exitCode: 0 };
      }
      return { stdout: '', stderr: '', exitCode: 1 };
    },
  };
}

describe('git-workflow command line', () => {
  it('show prints the resolved rules and sets the exit code', async () => {
    writeDefaults();
    await cli('show');
    expect(out.join('')).toContain('people: warn');
    expect(process.exitCode).toBe(0);
  });

  it('change needs exactly one of --plan or --apply', async () => {
    await cli('change');
    expect(process.exitCode).toBe(1);
    expect(err.join('')).toContain('Pass exactly one of --plan');
    out = [];
    await cli('change', '--plan', 'a.json', '--apply', 'b.json');
    expect(JSON.parse(out.join('')).error).toContain('Pass exactly one of');
  });

  it('change --plan and --apply read the change file', async () => {
    writeDefaults();
    writeFileSync(
      join(root, 'change.json'),
      JSON.stringify({ edits: [{ file: 'enforcement.yaml', path: ['people'], value: 'block' }] }),
    );
    await cli('change', '--plan', 'change.json');
    expect(JSON.parse(out.join('')).valid).toBe(true);
    out = [];
    await cli('change', '--apply', 'change.json');
    expect(JSON.parse(out.join('')).written).toEqual(['enforcement.yaml']);
  });

  it('check reports validity and --accept restamps', async () => {
    writeDefaults();
    await cli('check');
    expect(JSON.parse(out.join('')).valid).toBe(true);
    out = [];
    await cli('check', '--accept');
    expect(JSON.parse(out.join('')).accepted).toBe(true);
  });

  it('check exits 1 on an invalid config without --accept', () => {
    writeDefaults();
    writeFileSync(join(dir(), 'branches.yaml'), 'default_type: nope\n');
    expect(runCheck(root, false).exitCode).toBe(1);
  });

  it('setup prints exit 2 and the git error when the folder is not a repository', async () => {
    await cli('setup');
    expect(process.exitCode).toBe(2);
    expect(JSON.parse(out.join('')).error).toContain("git can't read this folder");
  });

  it('check-commit writes the finding to stderr and sets exit code 1 under block', async () => {
    writeDefaults();
    writeFileSync(join(dir(), 'enforcement.yaml'), 'people: block\nagents: block\n');
    writeFileSync(join(root, 'MSG'), 'fix\n');
    await cli('check-commit', 'MSG');
    expect(process.exitCode).toBe(1);
    expect(err.join('')).toContain('commit "fix"');
  });

  it('check-push reads nothing from a terminal and passes', async () => {
    writeDefaults();
    const original = Object.getOwnPropertyDescriptor(process, 'stdin')!;
    Object.defineProperty(process, 'stdin', {
      configurable: true,
      value: Object.assign(Readable.from([]), { isTTY: true }),
    });
    try {
      await cli('check-push');
    } finally {
      Object.defineProperty(process, 'stdin', original);
    }
    expect(process.exitCode).toBe(0);
    expect(err).toEqual([]);
  });

  it('check-push reads the pushed refs from piped stdin', async () => {
    writeDefaults();
    writeFileSync(join(dir(), 'enforcement.yaml'), 'people: block\nagents: block\n');
    const line = `refs/heads/misc/x ${'a'.repeat(40)} refs/heads/misc/x ${'0'.repeat(40)}\n`;
    const original = Object.getOwnPropertyDescriptor(process, 'stdin')!;
    Object.defineProperty(process, 'stdin', {
      configurable: true,
      value: Readable.from([Buffer.from(line)]),
    });
    try {
      await cli('check-push');
    } finally {
      Object.defineProperty(process, 'stdin', original);
    }
    expect(process.exitCode).toBe(1);
    expect(err.join('')).toContain('branch misc/x');
  });
});

describe('git-workflow hooks: edge inputs', () => {
  it('passes when there are no rules, the message file is missing, or the subject is empty', () => {
    expect(runCheckCommit({ projectRoot: root, messageFile: 'MSG', env: {} }).exitCode).toBe(0);
    writeDefaults();
    writeFileSync(join(dir(), 'enforcement.yaml'), 'people: block\n');
    expect(runCheckCommit({ projectRoot: root, messageFile: 'MISSING', env: {} }).stderr).toBe('');
    writeFileSync(join(root, 'MSG'), '# only a comment\n\n');
    expect(runCheckCommit({ projectRoot: root, messageFile: 'MSG', env: {} }).stderr).toBe('');
    expect(runCheckPush({ projectRoot: join(root, 'nowhere'), stdin: '', env: {} }).exitCode).toBe(
      0,
    );
  });

  it('treats a commit as a merge when git has a MERGE_HEAD, and reads the process env by default', () => {
    execFileSync('git', ['init', '-q'], { cwd: root });
    writeDefaults();
    writeFileSync(join(dir(), 'enforcement.yaml'), 'people: block\nagents: block\n');
    writeFileSync(join(root, 'MSG'), 'fix\n');
    expect(runCheckCommit({ projectRoot: root, messageFile: 'MSG' }).exitCode).toBe(1);
    writeFileSync(join(root, '.git', 'MERGE_HEAD'), `${'a'.repeat(40)}\n`);
    expect(runCheckCommit({ projectRoot: root, messageFile: 'MSG' }).exitCode).toBe(0);
    expect(runCheckPush({ projectRoot: root, stdin: '' }).exitCode).toBe(0);
  });
});

describe('git-workflow setup and change: bad inputs', () => {
  it('setup reads answers without a choices object and refuses an invalid result', async () => {
    writeFileSync(join(root, 'empty.json'), 'null');
    const dry = await runSetup({
      projectRoot: root,
      shell: gitShell(),
      answersFile: 'empty.json',
      dryRun: true,
    });
    expect(dry.exitCode).toBe(0);
    expect(JSON.parse(dry.stdout).not_confirmed.length).toBeGreaterThan(0);
    writeFileSync(
      join(root, 'bad.json'),
      JSON.stringify({ choices: { 'tickets.tracker': 'carrier-pigeon' } }),
    );
    const bad = await runSetup({ projectRoot: root, shell: gitShell(), answersFile: 'bad.json' });
    expect(bad.exitCode).toBe(1);
    expect(JSON.parse(bad.stdout).error).toContain("isn't one of the options");
  });

  it('change --plan exits 1 on an invalid result and reports a missing or broken change file', () => {
    writeDefaults();
    writeFileSync(
      join(root, 'change.json'),
      JSON.stringify({ edits: [{ file: 'branches.yaml', path: ['default_type'], value: 'nope' }] }),
    );
    expect(runChange(root, 'change.json', false).exitCode).toBe(1);
    expect(JSON.parse(runChange(root, 'missing.json', false).stdout).error).toContain(
      "doesn't exist",
    );
    writeFileSync(join(root, 'broken.json'), '{');
    expect(() => readJsonFile(join(root, 'broken.json'))).toThrow("isn't valid JSON");
  });

  it('rejects edits without a value, to paqad_version, or with a null entry', () => {
    expect(() => parseEdits(null)).toThrow('"edits" list');
    expect(() => parseEdits({ edits: [null] })).toThrow('edits[0].file must be one of');
    expect(() => parseEdits({ edits: [{ file: 'commits.yaml', path: ['template'] }] })).toThrow(
      'edits[0].value is missing.',
    );
    expect(() =>
      parseEdits({ edits: [{ file: 'commits.yaml', path: ['paqad_version'], value: '1' }] }),
    ).toThrow('paqad_version is set by paqad');
    expect(() => parseEdits({ edits: [{ file: 'commits.yaml', path: [''], value: 1 }] })).toThrow(
      'non-empty list',
    );
  });

  it('names the file and key when an edit cannot be applied to the YAML', () => {
    expect(() =>
      applyEdits({ 'commits.yaml': 'template: [unclosed\n' }, [
        { file: 'commits.yaml', path: ['template'], value: 'x' },
      ]),
    ).toThrow(/^commits\.yaml template: /);
    expect(() =>
      applyEdits({}, [{ file: 'commits.yaml', path: ['sign_off'], value: true }]),
    ).toThrow("commits.yaml sign_off: can't add sign_off: its parent isn't a block map");
  });
});
