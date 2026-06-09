import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FileCheckMapper } from '@/pentest/file-check-mapper.js';
import { IncrementalScanner } from '@/pentest/incremental-scanner.js';
import { clearEngineLogger, setEngineLogger } from '@/core/logger-registry.js';
import type { EngineLogEntry } from '@/core/types/logger.js';

vi.mock('execa', () => ({
  execa: vi.fn(),
}));

describe('IncrementalScanner', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-incremental-scan-'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearEngineLogger();
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('uses git diff results and warns when the last full scan is stale', async () => {
    const logs: EngineLogEntry[] = [];
    setEngineLogger({ log: (entry) => void logs.push(entry) });
    vi.mocked(execa).mockResolvedValue({
      stdout: 'src/auth.ts\nconfig/app.ts\n',
    } as never);

    mkdirSync(join(projectRoot, '.paqad', 'pentest', 'runs', 'run-1'), { recursive: true });
    mkdirSync(join(projectRoot, '.paqad', 'pentest', 'runs', 'older-full'), { recursive: true });
    writeFileSync(
      join(projectRoot, '.paqad', 'pentest', 'runs', 'run-1', 'progress.json'),
      JSON.stringify({ git_commit: 'abc123' }),
    );
    writeFileSync(
      join(projectRoot, '.paqad', 'pentest', 'runs', 'older-full', 'progress.json'),
      JSON.stringify({
        incremental_type: 'full',
        started_at: '2020-01-01T00:00:00.000Z',
      }),
    );

    const scanner = new IncrementalScanner(new FileCheckMapper(['laravel']));
    const result = await scanner.scan({
      projectRoot,
      lastRunId: 'run-1',
      frameworks: ['laravel'],
      fullScanStalenessThresholdDays: 1,
    });

    expect(execa).toHaveBeenCalledWith('git', ['diff', '--name-only', 'abc123'], {
      cwd: projectRoot,
    });
    expect(result.changed_files).toEqual(['src/auth.ts', 'config/app.ts']);
    expect(Array.from(result.narrowed_scope.checks_to_run)).toEqual(
      expect.arrayContaining([
        'permission-boundary-review',
        'auth-mechanism-review',
        'runtime-surface-probing',
      ]),
    );
    expect(result.narrowed_scope.files_in_scope).toEqual(['src/auth.ts', 'config/app.ts']);
    expect(result.no_security_changes).toBe(false);
    expect(logs).toContainEqual(
      expect.objectContaining({
        level: 'warn',
        message: expect.stringContaining('Last full pentest was'),
      }),
    );
  });

  it('falls back to hash diff and treats deleted files as changed', async () => {
    vi.mocked(execa).mockRejectedValue(new Error('git unavailable'));

    mkdirSync(join(projectRoot, '.paqad', 'pentest', 'runs', 'run-2'), { recursive: true });
    mkdirSync(join(projectRoot, 'src'), { recursive: true });
    const unchangedContent = 'same';
    const changedContent = 'new content';
    writeFileSync(join(projectRoot, 'src', 'auth.ts'), changedContent);
    writeFileSync(join(projectRoot, 'src', 'config.ts'), unchangedContent);

    writeFileSync(
      join(projectRoot, '.paqad', 'pentest', 'runs', 'run-2', 'progress.json'),
      JSON.stringify({
        file_hashes: {
          'src/auth.ts': createHash('sha256').update('old content').digest('hex'),
          'src/config.ts': createHash('sha256').update(unchangedContent).digest('hex'),
          'src/missing.ts': createHash('sha256').update('missing').digest('hex'),
        },
      }),
    );

    const scanner = new IncrementalScanner(new FileCheckMapper(['laravel']));
    const result = await scanner.scan({
      projectRoot,
      lastRunId: 'run-2',
      frameworks: ['laravel'],
    });

    expect(result.changed_files).toEqual(['src/auth.ts', 'src/missing.ts']);
    expect(result.narrowed_scope.files_in_scope).toEqual(['src/auth.ts']);
    expect(result.narrowed_scope.no_security_changes).toBe(false);
  });

  it('falls back to hash diff when git returns an empty diff but tracked file hashes have drifted', async () => {
    vi.mocked(execa).mockResolvedValue({ stdout: '' } as never);

    mkdirSync(join(projectRoot, '.paqad', 'pentest', 'runs', 'run-3'), { recursive: true });
    mkdirSync(join(projectRoot, 'src'), { recursive: true });
    writeFileSync(join(projectRoot, 'src', 'auth.ts'), 'new auth content');

    writeFileSync(
      join(projectRoot, '.paqad', 'pentest', 'runs', 'run-3', 'progress.json'),
      JSON.stringify({
        git_commit: 'stale-ref',
        file_hashes: {
          'src/auth.ts': createHash('sha256').update('old auth content').digest('hex'),
        },
      }),
    );

    const scanner = new IncrementalScanner(new FileCheckMapper(['laravel']));
    const result = await scanner.scan({
      projectRoot,
      lastRunId: 'run-3',
      frameworks: ['laravel'],
    });

    expect(execa).toHaveBeenCalledWith('git', ['diff', '--name-only', 'stale-ref'], {
      cwd: projectRoot,
    });
    expect(result.changed_files).toEqual(['src/auth.ts']);
    expect(result.narrowed_scope.files_in_scope).toEqual(['src/auth.ts']);
    expect(result.no_security_changes).toBe(false);
  });

  it('keeps an empty result when both git diff and hash comparison report no drift', async () => {
    vi.mocked(execa).mockResolvedValue({ stdout: '' } as never);

    mkdirSync(join(projectRoot, '.paqad', 'pentest', 'runs', 'run-4'), { recursive: true });
    mkdirSync(join(projectRoot, 'src'), { recursive: true });
    writeFileSync(join(projectRoot, 'src', 'auth.ts'), 'same auth content');

    writeFileSync(
      join(projectRoot, '.paqad', 'pentest', 'runs', 'run-4', 'progress.json'),
      JSON.stringify({
        git_commit: 'same-ref',
        file_hashes: {
          'src/auth.ts': createHash('sha256').update('same auth content').digest('hex'),
        },
      }),
    );

    const scanner = new IncrementalScanner(new FileCheckMapper(['laravel']));
    const result = await scanner.scan({
      projectRoot,
      lastRunId: 'run-4',
      frameworks: ['laravel'],
    });

    expect(result.changed_files).toEqual([]);
    expect(result.narrowed_scope.files_in_scope).toEqual([]);
    expect(result.no_security_changes).toBe(true);
  });

  it('returns no changes when both git and hash fallback data are unavailable', async () => {
    vi.mocked(execa).mockRejectedValue(new Error('git unavailable'));

    const scanner = new IncrementalScanner(new FileCheckMapper(['laravel']));
    const result = await scanner.scan({
      projectRoot,
      lastRunId: 'missing-run',
      frameworks: ['laravel'],
    });

    expect(result.changed_files).toEqual([]);
    expect(result.narrowed_scope.no_security_changes).toBe(true);
    expect(Array.from(result.narrowed_scope.checks_to_run)).toEqual([]);
  });
});
