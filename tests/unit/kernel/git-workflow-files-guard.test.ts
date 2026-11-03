import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import { runCapabilityGate } from '@/kernel/gate.js';

const MESSAGE = (path: string) =>
  `**▸ paqad** · the git workflow rules are changed by the git-workflow skill\n` +
  `> 🔴 Needs your attention: \`${path}\` holds this team's git workflow rules. Only the ` +
  `git-workflow skill changes them, so every change is checked, explained and recorded. Use the ` +
  `git-workflow skill instead.`;

describe('git-workflow-files guard at pre-mutation', () => {
  let root: string;
  const rel = `${PATHS.GIT_WORKFLOW_DIR}/commits.yaml`;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-wf-guard-'));
    mkdirSync(join(root, '.paqad/configs'), { recursive: true });
    writeFileSync(join(root, '.paqad/configs/.config.policy'), 'stages_mode=off\n');
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function gate(toolName: string, payload: { targetPath?: string; targetPaths?: string[] }) {
    return runCapabilityGate({
      projectRoot: root,
      seam: 'pre-mutation',
      payload: { toolName, ...payload },
    });
  }

  it('blocks an Edit, Write or NotebookEdit under .paqad/configs/git-workflow/ with the exact message', async () => {
    for (const tool of ['Edit', 'Write', 'NotebookEdit']) {
      const result = await gate(tool, { targetPath: join(root, rel) });
      expect(result.block).toBe(true);
      expect(result.summary).toContain(MESSAGE(rel));
    }
  });

  it('blocks an apply_patch when any of its paths is a git workflow file', async () => {
    const result = await gate('apply_patch', {
      targetPaths: ['src/app.ts', `${PATHS.GIT_WORKFLOW_DIR}/.last-applied.json`],
    });
    expect(result.block).toBe(true);
    expect(result.summary).toContain(`${PATHS.GIT_WORKFLOW_DIR}/.last-applied.json`);
  });

  it('lets other config files through', async () => {
    const result = await gate('Write', { targetPath: join(root, '.paqad/configs/README.md') });
    expect(result.summary ?? '').not.toContain('git-workflow skill');
  });
});
