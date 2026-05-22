import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { DocumentProgressTracker } from '@/document';

describe('DocumentProgressTracker', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-document-progress-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns an empty progress file when progress has not been created yet', async () => {
    const progress = await new DocumentProgressTracker().load(root);

    expect(progress).toEqual({
      schema_version: '1',
      generated_by: 'paqad-ai',
      framework_version: expect.any(String),
      modules: {},
      global: {},
    });
  });

  it('throws when the progress path exists but cannot be read as a file', async () => {
    mkdirSync(join(root, PATHS.DOC_PROGRESS), { recursive: true });

    await expect(new DocumentProgressTracker().load(root)).rejects.toThrow(
      `Failed to read document progress at ${PATHS.DOC_PROGRESS}`,
    );
  });

  it('throws when the progress file contains invalid JSON', async () => {
    mkdirSync(join(root, '.paqad'), { recursive: true });
    writeFileSync(join(root, PATHS.DOC_PROGRESS), '{not json');

    await expect(new DocumentProgressTracker().load(root)).rejects.toThrow(
      `Invalid JSON in ${PATHS.DOC_PROGRESS}`,
    );
  });

  it('throws when the progress file violates the schema', async () => {
    mkdirSync(join(root, '.paqad'), { recursive: true });
    writeFileSync(
      join(root, PATHS.DOC_PROGRESS),
      JSON.stringify({
        schema_version: '1',
        generated_by: 'paqad-ai',
        framework_version: '0.2.0',
        modules: [],
        global: {},
      }),
    );

    await expect(new DocumentProgressTracker().load(root)).rejects.toThrow(
      `Invalid document progress schema in ${PATHS.DOC_PROGRESS}`,
    );
  });
});
