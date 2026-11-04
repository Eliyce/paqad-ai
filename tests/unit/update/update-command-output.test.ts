import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRun } = vi.hoisted(() => ({ mockRun: vi.fn() }));

vi.mock('@/update/index.js', () => ({
  FrameworkUpdater: class {
    run = mockRun;
  },
}));

vi.mock('@/update/audit.js', () => ({
  appendAuditLog: vi.fn(),
  appendAuditLogFailure: vi.fn(),
}));

vi.mock('@/install/plugin-migration.js', () => ({
  maybeMigrateToPlugin: vi.fn(),
  runClaudeInstallWith: vi.fn(),
}));

import { createUpdateCommand, formatUpdateSummary } from '@/cli/commands/update.js';
import type { UpdateReport } from '@/update/index.js';

const FILE_TEXT = 'the full text of a rule file';

function report(overrides: Partial<UpdateReport> = {}): UpdateReport {
  return {
    previous_version: '1.117.0',
    target_version: '1.118.0',
    regenerated: ['CLAUDE.md', 'AGENTS.md'],
    skipped: [
      { path: 'docs/rules/a.md', before: FILE_TEXT, after: `${FILE_TEXT} v2` },
      { path: 'docs/rules/b.md', before: FILE_TEXT, after: `${FILE_TEXT} v2` },
    ],
    deprecated: [],
    new_mcp_servers: [],
    new_scripts: [],
    config_keys_pruned: [],
    team_setup_notes: ['Commit these team setup files.'],
    git_workflow_notes: ['Removed the old workflow copy.'],
    ...overrides,
  };
}

describe('paqad-ai update output', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  const printed = (): string => logSpy.mock.calls.map((call) => String(call[0])).join('\n');

  async function run(...flags: string[]): Promise<void> {
    await createUpdateCommand().parseAsync(['node', 'update', '--project-root', '/repo', ...flags]);
  }

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockRun.mockResolvedValue(report());
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('prints a summary and the notes, never JSON or file text, with no flags', async () => {
    await run();

    const output = printed();
    expect(output).toContain('Updated paqad from 1.117.0 to 1.118.0.');
    expect(output).toContain('CLAUDE.md');
    expect(output).toContain('Kept 2 files');
    expect(output).toContain('--json');
    expect(output).toContain('Commit these team setup files.');
    expect(output).toContain('Removed the old workflow copy.');
    expect(output).not.toContain(FILE_TEXT);
    expect(output).not.toContain('docs/rules/a.md');
    expect(() => JSON.parse(output)).toThrow();
  });

  it('prints only the full report with --json', async () => {
    await run('--json');

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(printed())).toEqual(report());
  });

  it('prints nothing with --silent, even with --json', async () => {
    await run('--silent');
    await run('--silent', '--json');

    expect(logSpy).not.toHaveBeenCalled();
  });
});

describe('formatUpdateSummary', () => {
  it('says so when the version and every file are already current', () => {
    const lines = formatUpdateSummary(
      report({ previous_version: '1.118.0', regenerated: [], skipped: [] }),
    );

    expect(lines).toEqual(['paqad is already on 1.118.0.', 'No files needed changing.']);
  });

  it('handles a project with no recorded version and uses the singular', () => {
    const lines = formatUpdateSummary(
      report({
        previous_version: null,
        regenerated: ['CLAUDE.md'],
        skipped: [{ path: 'a.md', before: 'a', after: 'b' }],
      }),
    );

    expect(lines[0]).toBe('Updated paqad to 1.118.0.');
    expect(lines).toContain('Changed 1 file:');
    expect(lines).toContain('  CLAUDE.md');
    expect(lines.join('\n')).toContain('Kept 1 file ');
  });

  it('names the settings it removed from personal config', () => {
    const lines = formatUpdateSummary(report({ config_keys_pruned: ['old_key'] }));

    expect(lines).toContain('Removed 1 setting paqad no longer has: old_key.');
  });
});
