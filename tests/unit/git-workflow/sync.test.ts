import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { renderDefaultGitWorkflowFile } from '@/git-workflow/defaults.js';
import { changedOutside, readLastApplied, stampLastApplied } from '@/git-workflow/last-applied.js';
import { loadGitWorkflow } from '@/git-workflow/load.js';
import { syncGitWorkflow, syncGitWorkflowFile } from '@/git-workflow/sync.js';
import { GIT_WORKFLOW_FILES } from '@/git-workflow/types.js';

describe('syncGitWorkflowFile', () => {
  it('leaves a current file byte-identical', () => {
    for (const file of GIT_WORKFLOW_FILES) {
      const text = renderDefaultGitWorkflowFile(file);
      expect(syncGitWorkflowFile(text)).toBe(text);
    }
  });

  it('INV-3: adds no key and no comment, and only swaps the stamp', () => {
    const text = 'paqad_version: "1.0.0"\n\nenabled: true\nagents: warn\n';
    expect(syncGitWorkflowFile(text)).toBe('schema_version: 1\n\nenabled: true\nagents: warn\n');
  });

  it('keeps CRLF line ends and a file with no final newline', () => {
    expect(syncGitWorkflowFile('paqad_version: "1.0.0"\r\nenabled: true\r\n')).toBe(
      'schema_version: 1\r\nenabled: true\r\n',
    );
    expect(syncGitWorkflowFile('enabled: true\npaqad_version: "1.0.0"')).toBe(
      'enabled: true\nschema_version: 1',
    );
  });

  it('leaves broken YAML alone', () => {
    const broken = 'paqad_version: "1.0.0"\nenabled: [true\n';
    expect(syncGitWorkflowFile(broken)).toBe(broken);
  });
});

describe('syncGitWorkflow', () => {
  let root: string;
  const dir = () => join(root, PATHS.GIT_WORKFLOW_DIR);
  const read = (file: string) => readFileSync(join(dir(), file), 'utf8');
  const write = (file: string, text: string) => writeFileSync(join(dir(), file), text);

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'git-workflow-sync-'));
    mkdirSync(dir(), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function allFilesOnOldStamp(): void {
    for (const file of GIT_WORKFLOW_FILES) {
      write(
        file,
        renderDefaultGitWorkflowFile(file).replace('schema_version: 1', 'paqad_version: "1.119.0"'),
      );
    }
    stampLastApplied(root, GIT_WORKFLOW_FILES, {
      version: '1.119.0',
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    });
  }

  it('writes a missing file whole, and stamps only the file it created', () => {
    write('enforcement.yaml', 'schema_version: 1\nenabled: true\nagents: warn\n');
    const written = syncGitWorkflow(root, { version: '2.0.0', baseBranch: 'develop' });
    expect(written).toHaveLength(4);
    expect(read('branches.yaml')).toContain('\nbase_branch: develop\n');
    expect(read('enforcement.yaml')).toBe('schema_version: 1\nenabled: true\nagents: warn\n');
    expect(Object.keys(readLastApplied(root)?.files ?? {})).toHaveLength(4);
    expect(loadGitWorkflow(root).config.enforcement.agents).toBe('warn');
    expect(syncGitWorkflow(root, { version: '2.0.0' })).toEqual([]);
  });

  it('AC-10: swaps all five files with no outside change left, and a second run writes nothing', () => {
    allFilesOnOldStamp();
    expect(syncGitWorkflow(root)).toHaveLength(5);
    for (const file of GIT_WORKFLOW_FILES) {
      expect(read(file)).toContain('schema_version: 1');
      expect(read(file)).not.toContain('paqad_version');
    }
    expect(changedOutside(root)).toEqual([]);
    expect(syncGitWorkflow(root)).toEqual([]);
    expect(loadGitWorkflow(root).warnings).toEqual([]);
  });

  it('FR-39: the swap changes only the hashes in the record, so two branches merge', () => {
    allFilesOnOldStamp();
    syncGitWorkflow(root);
    expect(readLastApplied(root)).toMatchObject({
      applied_at: '2026-01-01T00:00:00.000Z',
      paqad_version: '1.119.0',
    });
  });

  it('AC-10: a hand edit before the swap keeps its warning', () => {
    allFilesOnOldStamp();
    write('commits.yaml', `${read('commits.yaml')}# by hand\n`);
    syncGitWorkflow(root);
    expect(changedOutside(root)).toEqual(['commits.yaml']);
    expect(read('commits.yaml')).toContain('schema_version: 1');
  });

  it('AC-10: with no record the swap stays unstamped and warns', () => {
    allFilesOnOldStamp();
    rmSync(join(dir(), '.last-applied.json'));
    syncGitWorkflow(root);
    expect(readLastApplied(root)).toBeNull();
    expect(changedOutside(root)).toHaveLength(5);
  });

  it('AC-23: heals a paqad_version added back, once, with no warning left', () => {
    allFilesOnOldStamp();
    syncGitWorkflow(root);
    write('commits.yaml', `${read('commits.yaml')}\npaqad_version: "1.119.0"\n`);
    stampLastApplied(root, ['commits.yaml']);
    expect(syncGitWorkflow(root)).toHaveLength(1);
    expect(read('commits.yaml')).not.toContain('paqad_version');
    expect(changedOutside(root)).toEqual([]);
    expect(syncGitWorkflow(root)).toEqual([]);
    expect(loadGitWorkflow(root).warnings).toEqual([]);
  });

  it('AC-18: leaves a file with a higher schema_version alone and names it', () => {
    allFilesOnOldStamp();
    const newer = 'schema_version: 2\nenabled: true\n';
    write('enforcement.yaml', newer);
    const notes: string[] = [];
    syncGitWorkflow(root, { notes });
    expect(read('enforcement.yaml')).toBe(newer);
    expect(notes).toEqual([
      ".paqad/configs/git-workflow/enforcement.yaml was written by a newer paqad, so it wasn't changed. Update paqad-ai.",
    ]);
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'AC-22: one file that cannot be written is named, the others swap, and the next run finishes',
    () => {
      allFilesOnOldStamp();
      chmodSync(join(dir(), 'tickets.yaml'), 0o444);
      const notes: string[] = [];
      expect(syncGitWorkflow(root, { notes })).toHaveLength(4);
      expect(notes).toHaveLength(1);
      expect(notes[0]).toMatch(/^Couldn't write \.paqad\/configs\/git-workflow\/tickets\.yaml: /u);
      expect(read('tickets.yaml')).toContain('paqad_version');
      chmodSync(join(dir(), 'tickets.yaml'), 0o644);
      expect(syncGitWorkflow(root)).toHaveLength(1);
      expect(read('tickets.yaml')).not.toContain('paqad_version');
      expect(syncGitWorkflow(root)).toEqual([]);
    },
  );
});
