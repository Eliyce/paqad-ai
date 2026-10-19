import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ExtensionSurfaceGate } from '@/verification/gates/extension-surface.js';

import { createVerificationContext } from '../shared.fixture.js';

describe('ExtensionSurfaceGate', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-surface-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function writeSurfaceDoc() {
    mkdirSync(join(root, 'docs'), { recursive: true });
    writeFileSync(join(root, 'docs', 'extension-surface.md'), '# Surface\n');
  }

  it('AC-11: reads not required (never a pass) when the surface document is absent', async () => {
    const result = await new ExtensionSurfaceGate().check(
      createVerificationContext({ project_root: root, changed_files: ['src/index.ts'] }),
    );
    expect(result.passed).toBe(true);
    expect(result.inconclusive).toBeUndefined();
    expect(result.outcome).toBe('not-required');
    expect(result.detail).toContain('no extension surface document');
  });

  it('AC-11: reads not required when no public barrel changed', async () => {
    writeSurfaceDoc();
    const result = await new ExtensionSurfaceGate().check(
      createVerificationContext({ project_root: root, changed_files: ['src/foo.ts'] }),
    );
    expect(result.passed).toBe(true);
    expect(result.outcome).toBe('not-required');
    expect(result.detail).toContain('no public export barrel changed');
  });

  it('fails when a public barrel changed without amending the document', async () => {
    writeSurfaceDoc();
    const result = await new ExtensionSurfaceGate().check(
      createVerificationContext({
        project_root: root,
        changed_files: ['./src/cli/index.ts', 'src/foo.ts'],
      }),
    );
    expect(result.passed).toBe(false);
    expect(result.detail).toContain('src/cli/index.ts changed without amending');
    expect(result.remediation).toContain('docs/extension-surface.md');
  });

  it('passes when the barrel change is accompanied by a document amendment', async () => {
    writeSurfaceDoc();
    const result = await new ExtensionSurfaceGate().check(
      createVerificationContext({
        project_root: root,
        changed_files: ['src/index.ts', 'docs/extension-surface.md'],
      }),
    );
    expect(result.passed).toBe(true);
    expect(result.detail).toContain('amended in the same change');
  });
});
