import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import YAML from 'yaml';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { listFolderFiles } from '@/authoring/hash.js';
import { runDraft } from '@/authoring/stages/draft.js';
import { runRelease } from '@/authoring/stages/release.js';
import { runSkillTest } from '@/authoring/stages/test.js';
import { AgentWorkspace, OVERRIDES_FILE, SkillWorkspace } from '@/authoring/workspace.js';
import { readSkillRecord } from '@/feature-evidence/artifacts.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';
import { resolveSessionId } from '@/rag-ledger/session.js';

const NAME = 'csv-dedupe';
const SKILL = [
  '---',
  `name: ${NAME}`,
  'description: Removes duplicate rows from a CSV file. Use when a CSV has repeated rows.',
  '---',
  '# Removing duplicates',
  '',
  'Run the script on the file.',
  '',
  '## Gotchas',
  '',
  'Header rows count as data when the file has none.',
  '',
].join('\n');
const SCRIPT = '#!/bin/sh\nexit 0\n';
const POSIX = process.platform !== 'win32';
const ALL_SKIPPED = ['S0', 'S1', 'S2', 'S5', 'S6'];

let root: string;
let sessionId: string;
let dir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-file-modes-'));
  mkdirSync(join(root, '.paqad'), { recursive: true });
  mkdirSync(join(root, 'home'));
  vi.stubEnv('HOME', join(root, 'home'));
  vi.stubEnv('USERPROFILE', join(root, 'home'));
  vi.stubEnv('PAQAD_SKILL_ORCHESTRATOR_ENABLED', undefined);
  writeFileSync(
    join(root, '.paqad/onboarding-manifest.json'),
    JSON.stringify({ adapter: 'claude-code' }),
  );
  writeFileSync(
    join(root, '.paqad/project-profile.yaml'),
    YAML.stringify({ project: { name: 'x', id: 'x' }, commands: { test: 'npm test' } }),
  );
  sessionId = resolveSessionId(root, 'ses-override-modes');
  dir = openFeatureChange(root, sessionId, {
    adapter: 'claude-code',
    title: 'release skills in place',
    lane: 'graduated',
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

function overridden(workspace: SkillWorkspace | AgentWorkspace, gates: string[]): void {
  workspace.writeJson(
    OVERRIDES_FILE,
    gates.map((gate) => ({
      gate,
      reason: 'owner decision',
      by: 'human',
      at: '2026-10-31T10:00:00.000Z',
      decision: `D-${gate}`,
    })),
  );
}

function skillFolder(rel: string): string {
  mkdirSync(join(root, rel, 'bin'), { recursive: true });
  writeFileSync(join(root, rel, 'SKILL.md'), SKILL);
  writeFileSync(join(root, rel, 'bin/dedupe.sh'), SCRIPT);
  chmodSync(join(root, rel, 'bin/dedupe.sh'), 0o755);
  return rel;
}

function modeOf(path: string): number {
  return statSync(path).mode & 0o777;
}

function snapshot(rel: string): Array<{ rel: string; bytes: string; mode: number }> {
  return listFolderFiles(join(root, rel)).map((file) => ({
    rel: file.rel,
    bytes: file.bytes.toString('base64'),
    mode: modeOf(join(root, rel, file.rel)),
  }));
}

async function testedAndReleased(workspace: SkillWorkspace) {
  const tested = await runSkillTest(workspace, {
    runTests: async () => ({ exitCode: 0, failedTests: null }),
  });
  expect(tested.lines).toEqual(expect.arrayContaining([expect.stringContaining('S4 passed')]));
  return runRelease(workspace, { sessionId, now: () => new Date('2026-10-31T10:00:00.000Z') });
}

describe.skipIf(!POSIX)('file modes through draft and release', () => {
  it('keeps a 0755 script executable in the draft and in the released host folder', async () => {
    const workspace = new SkillWorkspace(root, NAME);
    overridden(workspace, ALL_SKIPPED);
    const source = skillFolder('src-skill');
    expect(runDraft(workspace, { dir: join(root, source), traceText: '' }).ok).toBe(true);
    expect(modeOf(workspace.path(`draft/${NAME}/bin/dedupe.sh`))).toBe(0o755);
    const released = await testedAndReleased(workspace);
    expect(released.ok).toBe(true);
    expect(modeOf(join(root, `.claude/skills/${NAME}/bin/dedupe.sh`))).toBe(0o755);
  });

  it('releases a runtime skill in place without changing a byte or a mode in its folder', async () => {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'paqad-ai' }));
    const source = skillFolder(`runtime/base/skills/${NAME}`);
    const before = snapshot(source);
    const workspace = new SkillWorkspace(root, NAME);
    overridden(workspace, ALL_SKIPPED);
    expect(runDraft(workspace, { dir: join(root, source), traceText: '' }).ok).toBe(true);
    chmodSync(workspace.path(`draft/${NAME}/bin/dedupe.sh`), 0o644);
    const released = await testedAndReleased(workspace);
    expect(released.lines[0]).toContain(`into ${source};`);
    expect(released.lines[1]).toBe(
      `The draft came from ${source}, so no file in it was copied or changed.`,
    );
    expect(snapshot(source)).toEqual(before);
    expect(readSkillRecord(root, dir, NAME)!.released_path).toBe(source);
    const tracked = `.paqad/authoring/skills/${NAME}`;
    expect(JSON.parse(readFileSync(join(root, tracked, 'evidence.json'), 'utf8')).version).toBe(
      '1.0.0',
    );
    expect(readFileSync(join(root, tracked, 'CHANGELOG.md'), 'utf8')).toContain('## 1.0.0');
  });

  it('refuses an in-place release when the source folder changed after the draft', async () => {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'paqad-ai' }));
    const source = skillFolder(`runtime/base/skills/${NAME}`);
    const workspace = new SkillWorkspace(root, NAME);
    overridden(workspace, ALL_SKIPPED);
    expect(runDraft(workspace, { dir: join(root, source), traceText: '' }).ok).toBe(true);
    writeFileSync(join(root, source, 'bin/dedupe.sh'), '#!/bin/sh\nexit 1\n');
    await expect(testedAndReleased(workspace)).rejects.toThrow(
      `Release refused: ${source} changed after S3 drafted it`,
    );
    expect(readFileSync(join(root, source, 'bin/dedupe.sh'), 'utf8')).toBe('#!/bin/sh\nexit 1\n');
  });
});
