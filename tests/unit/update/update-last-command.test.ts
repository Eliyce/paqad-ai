import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRun, mockAudit } = vi.hoisted(() => ({ mockRun: vi.fn(), mockAudit: vi.fn() }));

vi.mock('@/update/index.js', async (load) => ({
  ...(await load<typeof import('@/update/index.js')>()),
  FrameworkUpdater: class {
    run = mockRun;
  },
}));

vi.mock('@/update/audit.js', async (load) => {
  const real = await load<typeof import('@/update/audit.js')>();
  return { ...real, appendAuditLog: mockAudit };
});

vi.mock('@/install/plugin-migration.js', () => ({
  maybeMigrateToPlugin: vi.fn(),
  runClaudeInstallWith: vi.fn(),
}));

import { createUpdateCommand, formatUpdateReportLines } from '@/cli/commands/update.js';
import type { UpdateReport } from '@/update/index.js';
import { takeLastUpdateSessionLine } from '@/update/last-update.js';

const UNSEEN = '.paqad/state/last-update.json';
const SEEN = '.paqad/state/last-update.seen.json';
const REMOVED =
  "Removed an old copy of paqad's planning instruction from feature-development/workflow.yaml: Keep planning";

let root: string;
let logSpy: ReturnType<typeof vi.spyOn>;

function report(overrides: Partial<UpdateReport> = {}): UpdateReport {
  return {
    previous_version: '1.117.0',
    target_version: '1.118.0',
    regenerated: [],
    skipped: [],
    deprecated: [],
    new_mcp_servers: [],
    new_scripts: [],
    config_keys_pruned: [],
    team_setup_notes: [],
    git_workflow_notes: [],
    ...overrides,
  };
}

async function run(...flags: string[]): Promise<void> {
  await createUpdateCommand().parseAsync(['node', 'update', '--project-root', root, ...flags]);
}

function printed(): string[] {
  return logSpy.mock.calls.map((call) => String(call[0]));
}

function snapshot(): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else files[path] = readFileSync(path, 'utf8');
    }
  };
  walk(root);
  return files;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-update-last-'));
  mkdirSync(join(root, '.paqad'), { recursive: true });
  mockRun.mockReset();
  mockAudit.mockReset();
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  logSpy.mockRestore();
  rmSync(root, { recursive: true, force: true });
});

describe('update --silent', () => {
  it('AC-10: writes the record and prints nothing', async () => {
    mockRun.mockResolvedValue(report({ git_workflow_notes: ['note'] }));
    await run('--silent');
    expect(printed()).toEqual([]);
    expect(JSON.parse(readFileSync(join(root, UNSEEN), 'utf8')).git_workflow_notes).toEqual([
      'note',
    ]);
  });

  it('a manual run writes no record', async () => {
    mockRun.mockResolvedValue(report({ regenerated: ['a.md'] }));
    await run();
    expect(existsSync(join(root, UNSEEN))).toBe(false);
  });

  it('AC-12: a failed update writes no record', async () => {
    mockRun.mockRejectedValue(new Error('boom'));
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    try {
      await run('--silent');
    } finally {
      exit.mockRestore();
    }
    expect(existsSync(join(root, UNSEEN))).toBe(false);
  });

  it('AC-13: exits normally and still writes the audit line when the state folder is a file', async () => {
    writeFileSync(join(root, '.paqad/state'), 'a file', 'utf8');
    mockRun.mockResolvedValue(report({ regenerated: ['a.md'] }));
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    try {
      await run('--silent');
      expect(exit).not.toHaveBeenCalled();
    } finally {
      exit.mockRestore();
    }
    expect(mockAudit).toHaveBeenCalledTimes(1);
    expect(readdirSync(join(root, '.paqad'))).toEqual(['state']);
  });

  it('the record survives a failed audit write', async () => {
    mockRun.mockResolvedValue(report({ regenerated: ['a.md'] }));
    mockAudit.mockImplementation(() => {
      throw new Error('audit failed');
    });
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    try {
      await run('--silent');
    } finally {
      exit.mockRestore();
    }
    expect(existsSync(join(root, UNSEEN))).toBe(true);
  });

  it('AC-11: a run changing only the manifest and a team file reports 2 files in both places', async () => {
    mockRun.mockResolvedValue(
      report({
        changed_files: [
          '.paqad/onboarding-manifest.json',
          '.paqad/configs/feature-development/workflow.yaml',
        ],
      }),
    );
    await run('--silent');
    logSpy.mockClear();
    await run('--last');
    expect(printed()).toContain('Changed 2 files:');
    expect(takeLastUpdateSessionLine(root, 'startup')).toContain('changed 2 files');
  });
});

describe('update --last', () => {
  it('AC-16: prints what a manual run printed, apart from the pointer on the kept line', async () => {
    const real = report({
      regenerated: ['CLAUDE.md'],
      changed_files: ['CLAUDE.md', '.paqad/onboarding-manifest.json'],
      skipped: [{ path: 'kept.md', before: 'a', after: 'b' }],
      config_keys_pruned: ['old_key'],
      team_setup_notes: ['Commit these team setup files.'],
      git_workflow_notes: [REMOVED],
    });
    mockRun.mockResolvedValue(real);
    await run();
    const manual = printed();
    expect(manual).toEqual(formatUpdateReportLines(real));
    logSpy.mockClear();
    await run('--silent');
    logSpy.mockClear();
    await run('--last');
    expect(mockRun).toHaveBeenCalledTimes(2);
    const last = printed();
    expect(last).toHaveLength(manual.length);
    const differing = last.filter((line, index) => line !== manual[index]);
    expect(differing).toEqual([
      'Kept 1 file paqad would write differently. Run paqad-ai update --last --json to see it.',
    ]);
  });

  it('AC-17: shows every removed line from a background update', async () => {
    mockRun.mockResolvedValue(report({ git_workflow_notes: [REMOVED, `${REMOVED} again`] }));
    await run('--silent');
    logSpy.mockClear();
    await run('--last');
    expect(printed()).toEqual(expect.arrayContaining([REMOVED, `${REMOVED} again`]));
  });

  it('AC-18: falls through a corrupt unseen record to the seen one, then to the empty message', async () => {
    mkdirSync(join(root, '.paqad/state'), { recursive: true });
    writeFileSync(join(root, UNSEEN), '{ corrupt', 'utf8');
    mockRun.mockResolvedValue(report({ regenerated: ['a.md'] }));
    writeFileSync(
      join(root, SEEN),
      JSON.stringify({
        previous_version: null,
        target_version: '1.2.3',
        changed_files: ['seen.md'],
        skipped: [],
        config_keys_pruned: [],
        team_setup_notes: [],
        git_workflow_notes: [],
        updated_at: 'then',
      }),
      'utf8',
    );
    await run('--last');
    expect(printed()).toContain('  seen.md');
    logSpy.mockClear();
    writeFileSync(join(root, SEEN), JSON.stringify({ target_version: 7 }), 'utf8');
    await run('--last');
    expect(printed()).toEqual(['No background update to report.']);
  });

  it('AC-19: with no record prints the set outputs', async () => {
    await run('--last');
    expect(printed()).toEqual(['No background update to report.']);
    logSpy.mockClear();
    await run('--last', '--json');
    expect(JSON.parse(printed().join('\n'))).toEqual({ last_update: null });
  });

  it('AC-19: the unseen record beats the seen one, and reading changes no file', async () => {
    const write = (path: string, file: string): void => {
      mkdirSync(join(root, '.paqad/state'), { recursive: true });
      writeFileSync(
        join(root, path),
        JSON.stringify({
          previous_version: '1.0.0',
          target_version: '1.1.0',
          changed_files: [file],
          skipped: [],
          config_keys_pruned: [],
          team_setup_notes: [],
          git_workflow_notes: [],
          updated_at: 'then',
        }),
        'utf8',
      );
    };
    write(SEEN, 'seen.md');
    write(UNSEEN, 'unseen.md');
    const before = snapshot();
    await run('--last');
    expect(printed()).toContain('  unseen.md');
    logSpy.mockClear();
    await run('--last', '--json');
    expect(JSON.parse(printed().join('\n')).changed_files).toEqual(['unseen.md']);
    expect(snapshot()).toEqual(before);
    expect(mockRun).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
    expect(takeLastUpdateSessionLine(root, 'startup')).not.toBeNull();
  });
});
