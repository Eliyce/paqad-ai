import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSpecPipelineCommand } from '@/cli/commands/spec-pipeline.js';
import { openFeatureChange } from '@/feature-evidence/stage-ledger.js';

describe('spec pipeline CLI without an active feature', () => {
  let root: string;
  let errors: string[];

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-pipeline-nofeature-'));
    errors = [];
    process.exitCode = 0;
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation((message?: unknown) => {
      errors.push(String(message));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = 0;
    rmSync(root, { recursive: true, force: true });
  });

  it.each([
    [['start', '--request-file', 'request.md']],
    [['ground']],
    [['label', 'export invoices']],
    [['record', 'task', 'task.json']],
    [['finish']],
    [['redo', 'ground']],
    [['metrics']],
    [['experts', 'record', 'need.json']],
    [['experts', 'brief', 'qa-engineer']],
    [['experts', 'context']],
    [['experts', 'notes', 'notes.json']],
    [['experts', 'synthesis', 'synthesis.json']],
  ])('refuses %j with exit 1', async (args) => {
    await createSpecPipelineCommand().parseAsync(
      [...args, '--project-root', root, '--session', 'ses-none'],
      { from: 'user' },
    );
    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toMatch(/no active feature/);
  });

  it.each([
    [['--ticket', 'PROJ-12'], 'Jira tickets are fetched through the Atlassian MCP'],
    [['--ticket', 'see the doc'], '"see the doc" is not a GitHub issue ref'],
    [['--request-file', 'missing.md'], 'could not read request file "missing.md"'],
    [[], 'start needs --request-file <path> or --ticket <ref>'],
  ])('start refuses a request it cannot read: %j', async (flags, message) => {
    openFeatureChange(root, 'ses-start', {
      adapter: 'claude-code',
      title: 'start refusals',
      issue: null,
      ulid: '01JABCDEFGHJKMNPQRSTVWXYZ1',
    });
    await createSpecPipelineCommand().parseAsync(
      ['start', ...flags, '--project-root', root, '--session', 'ses-start'],
      { from: 'user' },
    );
    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toContain(message);
  });
});
