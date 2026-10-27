import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildAgentRouterDocument,
  LOADED_INSTRUCTION_DIRS,
} from '@/onboarding/agent-bootstrap-writer.js';

import { loadSteps } from '../../../runtime/hooks/lib/agent-entry-directive.mjs';
import {
  changedFilesLines,
  filesNewer,
  LOADED_INSTRUCTION_DIRS as HOOK_LOADED_INSTRUCTION_DIRS,
  sentinelDetail,
  sentinelPath,
  sentinelState,
} from '../../../runtime/hooks/lib/agent-entry-sentinel.mjs';

const SESSION = 'session-a';
const BASE = 1_700_000_000;
const OLDER = new Date((BASE - 20) * 1000);
const LOADED = new Date((BASE - 10) * 1000);
const NEWER = new Date(BASE * 1000);

describe('agent-entry sentinel staleness walk', () => {
  let projectRoot: string;

  function write(relative: string, mtime: Date = NEWER): void {
    const full = join(projectRoot, relative);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, '# x\n');
    utimesSync(full, mtime, mtime);
  }

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-sentinel-'));
    write('CLAUDE.md', OLDER);
    write('.paqad/framework-path.txt', OLDER);
    write('docs/instructions/workflows/feature-development.yaml', OLDER);
    write('docs/instructions/stack/overview.md', OLDER);
    const sentinel = sentinelPath(projectRoot, SESSION);
    mkdirSync(join(sentinel, '..'), { recursive: true });
    writeFileSync(sentinel, '{}');
    utimesSync(sentinel, LOADED, LOADED);
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('stays fresh when a tech-debt item is written after the load', () => {
    write('docs/instructions/tech-debt/TD-01M5CCWX6FTKY8C6EJKMR9EH3D.md');
    write('docs/instructions/tech-debt/overview.md');

    expect(sentinelState(projectRoot, {}, undefined, SESSION)).toBe('fresh');
  });

  it('AC-44: stays fresh when a rules file under docs/instructions changes', () => {
    write('docs/instructions/rules/x.md');
    write('docs/instructions/rules/rule-script-map.yml');

    expect(sentinelState(projectRoot, {}, undefined, SESSION)).toBe('fresh');
  });

  it('AC-49: stays fresh for changes outside the loaded folders', () => {
    for (const dir of ['registries', 'architecture', 'benchmarks', 'tech-debt-notes']) {
      write(`docs/instructions/${dir}/a.md`);
    }
    write('docs/instructions/loose.md');

    expect(sentinelState(projectRoot, {}, undefined, SESSION)).toBe('fresh');
  });

  it('AC-45: goes stale on a workflow change and names only that file', () => {
    write('docs/instructions/workflows/feature-development.yaml');

    expect(sentinelDetail(projectRoot, {}, undefined, SESSION)).toEqual({
      state: 'stale:docs-instructions',
      files: ['docs/instructions/workflows/feature-development.yaml'],
    });
  });

  it('AC-47: goes stale on a nested stack or design-system change', () => {
    write('docs/instructions/stack/react/overview.md');
    write('docs/instructions/design-system/tokens.md');

    expect(sentinelDetail(projectRoot, {}, undefined, SESSION).files).toEqual([
      'docs/instructions/design-system/tokens.md',
      'docs/instructions/stack/react/overview.md',
    ]);
  });

  it('AC-50: keeps a docs-stale marker so a retry sees the same files', () => {
    write('docs/instructions/workflows/feature-development.yaml');

    const first = sentinelDetail(projectRoot, {}, undefined, SESSION);
    const second = sentinelDetail(projectRoot, {}, undefined, SESSION);

    expect(second).toEqual(first);
    expect(second.state).toBe('stale:docs-instructions');
  });

  it('AC-46: a changed entry file stays stale:entry-file and drops the marker', () => {
    write('CLAUDE.md');
    write('docs/instructions/workflows/feature-development.yaml');

    expect(sentinelDetail(projectRoot, {}, undefined, SESSION)).toEqual({
      state: 'stale:entry-file',
      files: [],
    });
    expect(sentinelState(projectRoot, {}, undefined, SESSION)).toBe('missing');
  });

  it('AC-47: a changed framework-path.txt stays stale:framework-path', () => {
    write('.paqad/framework-path.txt');

    expect(sentinelState(projectRoot, {}, undefined, SESSION)).toBe('stale:framework-path');
  });
});

describe('filesNewer', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'paqad-files-newer-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function seed(count: number): void {
    for (let index = 0; index < count; index += 1) {
      const full = join(dir, `f${String(index).padStart(2, '0')}.md`);
      writeFileSync(full, '# x\n');
      utimesSync(full, NEWER, NEWER);
    }
    const old = join(dir, 'old.md');
    writeFileSync(old, '# x\n');
    utimesSync(old, OLDER, OLDER);
  }

  it('AC-49: returns nothing when no file is newer', () => {
    seed(0);
    expect(filesNewer(dir, LOADED.getTime())).toEqual([]);
    expect(changedFilesLines([])).toEqual([]);
  });

  it('AC-49: lists all ten files with no "and N more"', () => {
    seed(10);
    const lines = changedFilesLines(filesNewer(dir, LOADED.getTime()).sort());
    expect(lines).toHaveLength(10);
    expect(lines.some((line: string) => line.includes('more'))).toBe(false);
  });

  it('AC-49: lists ten of eleven files plus "and 1 more"', () => {
    seed(11);
    const lines = changedFilesLines(filesNewer(dir, LOADED.getTime()).sort());
    expect(lines).toHaveLength(11);
    expect(lines[10]).toBe('[paqad]   and 1 more');
  });

  it('skips the named folder', () => {
    mkdirSync(join(dir, 'skip'));
    const full = join(dir, 'skip', 'a.md');
    writeFileSync(full, '# x\n');
    utimesSync(full, NEWER, NEWER);
    expect(filesNewer(dir, LOADED.getTime(), join(dir, 'skip'))).toEqual([]);
  });

  it('returns nothing for a folder that does not exist', () => {
    expect(filesNewer(join(dir, 'absent'), LOADED.getTime())).toEqual([]);
  });
});

describe('loaded instruction folders', () => {
  it('AC-52: the hook list equals the router writer list', () => {
    expect([...HOOK_LOADED_INSTRUCTION_DIRS]).toEqual([...LOADED_INSTRUCTION_DIRS]);
  });

  it('AC-52: the router lists exactly those folders under its always-load heading', () => {
    const router = buildAgentRouterDocument();
    const listed = [...router.matchAll(/^- `docs\/instructions\/([a-z-]+)`/gm)].map(
      (match) => match[1],
    );
    expect(listed).toEqual([...HOOK_LOADED_INSTRUCTION_DIRS]);
  });

  it('AC-52: the gate load steps name the same folders', () => {
    expect(loadSteps('CLAUDE.md').join('\n')).toContain(
      `docs/instructions/{${HOOK_LOADED_INSTRUCTION_DIRS.join(',')}}`,
    );
  });
});
