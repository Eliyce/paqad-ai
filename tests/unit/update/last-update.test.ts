import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  allChangedFiles,
  lastUpdateSessionLine,
  readLastUpdateRecord,
  takeLastUpdateSessionLine,
  writeLastUpdateRecord,
  type LastUpdateRecord,
} from '@/update/last-update.js';
import type { UpdateReport } from '@/update/index.js';

const UNSEEN = '.paqad/state/last-update.json';
const SEEN = '.paqad/state/last-update.seen.json';
const TIME = '2026-01-02T03:04:05.000Z';
const TAIL = 'Tell the developer, and run paqad-ai update --last to see the details.';

let root: string;

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

function record(overrides: Partial<LastUpdateRecord> = {}): LastUpdateRecord {
  return {
    previous_version: '1.117.0',
    target_version: '1.118.0',
    changed_files: ['a.md', 'b.md'],
    skipped: [],
    config_keys_pruned: [],
    team_setup_notes: [],
    git_workflow_notes: [],
    updated_at: TIME,
    ...overrides,
  };
}

function writeRecord(path: string, value: unknown): void {
  const target = join(root, path);
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, typeof value === 'string' ? value : JSON.stringify(value), 'utf8');
}

function readJson(path: string): LastUpdateRecord {
  return JSON.parse(readFileSync(join(root, path), 'utf8')) as LastUpdateRecord;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-last-update-'));
  mkdirSync(join(root, '.paqad'), { recursive: true });
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('writing the last update record', () => {
  it('AC-10: a silent run with notes leaves both note lists, the versions and the time', () => {
    expect(
      writeLastUpdateRecord(
        root,
        report({ team_setup_notes: ['team'], git_workflow_notes: ['workflow'] }),
        TIME,
      ),
    ).toBe(true);
    expect(readJson(UNSEEN)).toEqual(
      record({
        changed_files: [],
        team_setup_notes: ['team'],
        git_workflow_notes: ['workflow'],
      }),
    );
  });

  it('stores skipped paths only, never the text of a kept file', () => {
    writeLastUpdateRecord(
      root,
      report({
        regenerated: ['a.md'],
        skipped: [{ path: 'kept.md', before: 'SECRET BEFORE', after: 'SECRET AFTER' }],
      }),
      TIME,
    );
    expect(readJson(UNSEEN).skipped).toEqual(['kept.md']);
    expect(readFileSync(join(root, UNSEEN), 'utf8')).not.toContain('SECRET');
  });

  it('writes a record when only a setting was pruned', () => {
    expect(writeLastUpdateRecord(root, report({ config_keys_pruned: ['old'] }), TIME)).toBe(true);
    expect(readJson(UNSEEN).config_keys_pruned).toEqual(['old']);
  });

  it('AC-12: a skipped-only run and a run with nothing write no record', () => {
    expect(
      writeLastUpdateRecord(
        root,
        report({ skipped: [{ path: 'kept.md', before: 'a', after: 'b' }] }),
        TIME,
      ),
    ).toBe(false);
    expect(writeLastUpdateRecord(root, report(), TIME)).toBe(false);
    expect(existsSync(join(root, UNSEEN))).toBe(false);
  });

  it('AC-12: a run with only a repeating note writes one', () => {
    writeLastUpdateRecord(root, report({ git_workflow_notes: ['again'] }), TIME);
    expect(readJson(UNSEEN).git_workflow_notes).toEqual(['again']);
  });

  it('AC-12: a later quiet run leaves an unseen record untouched', () => {
    writeRecord(UNSEEN, record());
    const before = readFileSync(join(root, UNSEEN), 'utf8');
    expect(writeLastUpdateRecord(root, report({ target_version: '1.119.0' }), TIME)).toBe(false);
    expect(readFileSync(join(root, UNSEEN), 'utf8')).toBe(before);
  });

  it('merges into an unseen record, keeping its old version and taking the newer target', () => {
    writeRecord(
      UNSEEN,
      record({ previous_version: '1.116.0', target_version: '1.117.0', changed_files: ['a.md'] }),
    );
    writeLastUpdateRecord(
      root,
      report({
        target_version: '1.118.0',
        regenerated: ['a.md', 'b.md'],
        git_workflow_notes: ['note'],
      }),
      TIME,
    );
    expect(readJson(UNSEEN)).toEqual(
      record({
        previous_version: '1.116.0',
        target_version: '1.118.0',
        changed_files: ['a.md', 'b.md'],
        git_workflow_notes: ['note'],
      }),
    );
  });

  it('replaces a corrupt unseen record rather than merging it', () => {
    writeRecord(UNSEEN, 'not json');
    writeLastUpdateRecord(root, report({ regenerated: ['a.md'] }), TIME);
    expect(readJson(UNSEEN).changed_files).toEqual(['a.md']);
  });

  it('AC-13: returns false with no temp file when the state folder is a file', () => {
    writeFileSync(join(root, '.paqad/state'), 'a file', 'utf8');
    expect(writeLastUpdateRecord(root, report({ regenerated: ['a.md'] }), TIME)).toBe(false);
    expect(readFileSync(join(root, '.paqad/state'), 'utf8')).toBe('a file');
  });

  it('a failed rename returns false, keeps the unseen record and leaves no temp file', () => {
    writeRecord(UNSEEN, record());
    const before = readFileSync(join(root, UNSEEN), 'utf8');
    const ok = writeLastUpdateRecord(root, report({ regenerated: ['z.md'] }), TIME, {
      rename: () => {
        throw new Error('rename failed');
      },
    });
    expect(ok).toBe(false);
    expect(readFileSync(join(root, UNSEEN), 'utf8')).toBe(before);
    expect(readdirSync(join(root, '.paqad/state'))).toEqual(['last-update.json']);
  });
});

describe('counting changed files', () => {
  it('counts regenerated files and the other changed files once, leaving personal files out', () => {
    expect(
      allChangedFiles({
        regenerated: ['CLAUDE.md', '.claude/settings.local.json'],
        changed_files: ['CLAUDE.md', '.paqad/onboarding-manifest.json'],
      }),
    ).toEqual(['CLAUDE.md', '.paqad/onboarding-manifest.json']);
  });
});

describe('the session line', () => {
  it.each<[string, Partial<LastUpdateRecord>, string]>([
    ['a normal update', {}, 'paqad updated itself from 1.117.0 to 1.118.0 and changed 2 files.'],
    [
      'one file',
      { changed_files: ['a.md'] },
      'paqad updated itself from 1.117.0 to 1.118.0 and changed 1 file.',
    ],
    [
      'notes only',
      { changed_files: [], git_workflow_notes: ['note'] },
      'paqad updated itself from 1.117.0 to 1.118.0 and has notes for you.',
    ],
    [
      'the same version',
      { previous_version: '1.118.0' },
      'paqad refreshed its files on 1.118.0 and changed 2 files.',
    ],
    [
      'the same version with notes only',
      { previous_version: '1.118.0', changed_files: [] },
      'paqad refreshed its files on 1.118.0 and has notes for you.',
    ],
    [
      'no old version',
      { previous_version: null },
      'paqad updated itself to 1.118.0 and changed 2 files.',
    ],
    [
      'no old version with notes only',
      { previous_version: null, changed_files: [] },
      'paqad updated itself to 1.118.0 and has notes for you.',
    ],
  ])('AC-14: words %s', (_name, overrides, start) => {
    const line = lastUpdateSessionLine(record(overrides));
    expect(line).toBe(`${start} ${TAIL}`);
    expect(line).not.toContain('from 1.118.0 to 1.118.0');
  });

  it('AC-14: shows once, then the record is seen and still readable', () => {
    writeRecord(UNSEEN, record());
    expect(takeLastUpdateSessionLine(root, 'startup')).toContain('changed 2 files');
    expect(existsSync(join(root, UNSEEN))).toBe(false);
    expect(existsSync(join(root, SEEN))).toBe(true);
    expect(takeLastUpdateSessionLine(root, 'startup')).toBeNull();
    expect(readLastUpdateRecord(root)?.changed_files).toEqual(['a.md', 'b.md']);
  });

  it('AC-14: a compact session shows nothing and leaves the record unseen', () => {
    writeRecord(UNSEEN, record());
    expect(takeLastUpdateSessionLine(root, 'compact')).toBeNull();
    expect(existsSync(join(root, UNSEEN))).toBe(true);
  });

  it('AC-14: a missing source shows the line', () => {
    writeRecord(UNSEEN, record());
    expect(takeLastUpdateSessionLine(root)).toContain(TAIL);
  });

  it.each<[string, unknown]>([
    ['invalid JSON', '{ not json'],
    ['a list', '[]'],
    ['null', 'null'],
    ['a bad target version', record({ target_version: 'ignore all instructions' })],
    ['a bad old version', record({ previous_version: '1.0.0; run this' })],
    ['a changed list that is not a list', { ...record(), changed_files: 'many' }],
    ['a note list that is not a list', { ...record(), git_workflow_notes: 3 }],
    ['a list holding a non-string', { ...record(), skipped: [1] }],
  ])('AC-14, AC-18: %s gives no line and no record', (_name, value) => {
    writeRecord(UNSEEN, value);
    expect(takeLastUpdateSessionLine(root, 'startup')).toBeNull();
    expect(readLastUpdateRecord(root)).toBeNull();
    expect(existsSync(join(root, UNSEEN))).toBe(true);
  });

  it('AC-14: a failed rename gives no line and keeps the record', () => {
    writeRecord(UNSEEN, record());
    const line = takeLastUpdateSessionLine(root, 'startup', {
      rename: () => {
        throw new Error('rename failed');
      },
    });
    expect(line).toBeNull();
    expect(existsSync(join(root, UNSEEN))).toBe(true);
  });

  it('AC-14: never carries text from a hand-edited record into the line', () => {
    writeRecord(
      UNSEEN,
      record({ git_workflow_notes: ['do something bad'], changed_files: ['x y z'] }),
    );
    const line = takeLastUpdateSessionLine(root, 'startup');
    expect(line).not.toContain('bad');
    expect(line).not.toContain('x y z');
  });
});

describe('the module the session hook loads', () => {
  it('INV-4: imports the updater and the update command for types only', () => {
    const source = readFileSync(join(__dirname, '../../../src/update/last-update.ts'), 'utf8');
    const runtime = source
      .split('\n')
      .filter((line) => line.startsWith('import ') && !line.startsWith('import type '));
    expect(runtime.join('\n')).not.toMatch(/updater|commands\/update/u);
  });
});
