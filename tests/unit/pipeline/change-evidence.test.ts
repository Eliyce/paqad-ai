import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

function makeGitRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-git-'));
  execSync('git init', { cwd: root });
  execSync('git config user.email "test@test.com"', { cwd: root });
  execSync('git config user.name "Test"', { cwd: root });
  return root;
}

import {
  detectStaleDocTargets,
  isCodeFile,
  isDocumentationFile,
  isTestFile,
  loadChangeEvidence,
} from '@/pipeline/change-evidence.js';

function makeTmpRoot(): string {
  return mkdtempSync(join(tmpdir(), 'paqad-change-evidence-'));
}

function writeChangedFiles(root: string, files: string[]): void {
  const dir = join(root, '.paqad', 'session');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'changed-files.json'), JSON.stringify(files));
}

describe('isDocumentationFile', () => {
  it('matches README.md', () => {
    expect(isDocumentationFile('README.md')).toBe(true);
  });

  it('matches docs/ paths', () => {
    expect(isDocumentationFile('docs/modules/foo/api/endpoints.md')).toBe(true);
  });

  it('matches website/ paths', () => {
    expect(isDocumentationFile('website/index.html')).toBe(true);
  });

  it('does not match src/ paths', () => {
    expect(isDocumentationFile('src/service.ts')).toBe(false);
  });
});

describe('isTestFile', () => {
  it('matches tests/ directory', () => {
    expect(isTestFile('tests/unit/foo.test.ts')).toBe(true);
  });

  it('matches /__tests__/ paths', () => {
    expect(isTestFile('src/__tests__/bar.ts')).toBe(true);
  });

  it('matches .test.ts extension', () => {
    expect(isTestFile('src/foo.test.ts')).toBe(true);
  });

  it('matches .spec.mts extension', () => {
    expect(isTestFile('src/foo.spec.mts')).toBe(true);
  });

  it('does not match plain src/ files', () => {
    expect(isTestFile('src/service.ts')).toBe(false);
  });
});

describe('isCodeFile', () => {
  it('matches src/ files', () => {
    expect(isCodeFile('src/pipeline/runner.ts')).toBe(true);
  });

  it('matches package.json', () => {
    expect(isCodeFile('package.json')).toBe(true);
  });

  it('matches tsconfig.json', () => {
    expect(isCodeFile('tsconfig.json')).toBe(true);
  });

  it('matches .sh scripts', () => {
    expect(isCodeFile('scripts/deploy.sh')).toBe(true);
  });

  it('matches loose .tsx files not under src/', () => {
    expect(isCodeFile('lib/component.tsx')).toBe(true);
  });

  it('matches loose .js files not under src/', () => {
    expect(isCodeFile('lib/util.js')).toBe(true);
  });

  it('matches loose .jsx files not under src/', () => {
    expect(isCodeFile('lib/comp.jsx')).toBe(true);
  });

  it('matches loose .mjs files not under src/', () => {
    expect(isCodeFile('lib/util.mjs')).toBe(true);
  });

  it('matches loose .cjs files not under src/', () => {
    expect(isCodeFile('lib/util.cjs')).toBe(true);
  });

  it('matches loose .sh files not under scripts/ or bin/', () => {
    expect(isCodeFile('custom/run.sh')).toBe(true);
  });

  it('does not match docs/ paths', () => {
    expect(isCodeFile('docs/modules/foo.md')).toBe(false);
  });

  it('does not match test files', () => {
    expect(isCodeFile('tests/unit/foo.test.ts')).toBe(false);
  });
});

describe('loadChangeEvidence', () => {
  it('returns session-artifact when changed-files.json exists with content', async () => {
    const root = makeTmpRoot();
    writeChangedFiles(root, ['src/foo.ts', 'tests/unit/foo.test.ts']);

    const result = await loadChangeEvidence(root);

    expect(result.source).toBe('session-artifact');
    expect(result.files).toContain('src/foo.ts');
    expect(result.files).toContain('tests/unit/foo.test.ts');

    rmSync(root, { recursive: true, force: true });
  });

  it('falls back to git-status when no session artifact exists', async () => {
    const root = makeTmpRoot();

    const result = await loadChangeEvidence(root);

    expect(['git-status', 'none']).toContain(result.source);
    expect(Array.isArray(result.files)).toBe(true);

    rmSync(root, { recursive: true, force: true });
  });

  it('returns none when session artifact is empty and git has no changes', async () => {
    const root = makeTmpRoot();
    writeChangedFiles(root, []);

    const result = await loadChangeEvidence(root);

    expect(['none', 'git-status']).toContain(result.source);

    rmSync(root, { recursive: true, force: true });
  });

  it('handles malformed changed-files.json gracefully', async () => {
    const root = makeTmpRoot();
    const dir = join(root, '.paqad', 'session');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'changed-files.json'), 'NOT_JSON');

    const result = await loadChangeEvidence(root);

    expect(['git-status', 'none']).toContain(result.source);

    rmSync(root, { recursive: true, force: true });
  });

  it('handles non-array changed-files.json gracefully', async () => {
    const root = makeTmpRoot();
    const dir = join(root, '.paqad', 'session');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'changed-files.json'), JSON.stringify({ files: ['src/foo.ts'] }));

    const result = await loadChangeEvidence(root);

    expect(['git-status', 'none']).toContain(result.source);

    rmSync(root, { recursive: true, force: true });
  });

  it('deduplicates and sorts files from session artifact', async () => {
    const root = makeTmpRoot();
    writeChangedFiles(root, ['src/b.ts', 'src/a.ts', 'src/a.ts']);

    const result = await loadChangeEvidence(root);

    expect(result.files).toEqual(['src/a.ts', 'src/b.ts']);

    rmSync(root, { recursive: true, force: true });
  });
});

describe('loadChangeEvidence (git-status path)', () => {
  it('returns git-status source when no session artifact but git has modified files', async () => {
    const root = makeGitRoot();
    writeFileSync(join(root, 'src.ts'), 'export const x = 1;');

    const result = await loadChangeEvidence(root);

    expect(result.source).toBe('git-status');
    expect(result.files.length).toBeGreaterThan(0);

    rmSync(root, { recursive: true, force: true });
  });

  it('returns none when git repo is clean and no session artifact', async () => {
    const root = makeGitRoot();
    writeFileSync(join(root, 'init.ts'), 'export const x = 1;');
    execSync('git add .', { cwd: root });
    execSync('git commit -m "init"', { cwd: root });

    const result = await loadChangeEvidence(root);

    expect(result.source).toBe('none');
    expect(result.files).toEqual([]);

    rmSync(root, { recursive: true, force: true });
  });

  it('parses renamed file paths from git status', async () => {
    const root = makeGitRoot();
    writeFileSync(join(root, 'old.ts'), 'export const x = 1;');
    execSync('git add .', { cwd: root });
    execSync('git commit -m "init"', { cwd: root });
    execSync('git mv old.ts new.ts', { cwd: root });

    const result = await loadChangeEvidence(root);

    expect(result.source).toBe('git-status');
    expect(result.files).toContain('new.ts');

    rmSync(root, { recursive: true, force: true });
  });
});

describe('detectStaleDocTargets', () => {
  it('returns empty array when no code files are in the changed list', async () => {
    const root = makeTmpRoot();
    const result = await detectStaleDocTargets(root, ['docs/foo.md', 'README.md']);
    expect(result).toEqual([]);
    rmSync(root, { recursive: true, force: true });
  });

  it('returns empty array when detector script is absent', async () => {
    const root = makeTmpRoot();
    const result = await detectStaleDocTargets(root, ['src/service.ts']);
    expect(Array.isArray(result)).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  it('returns stale doc targets from detector when script is present', async () => {
    const root = makeTmpRoot();
    const hooksDir = join(root, 'runtime', 'hooks');
    mkdirSync(hooksDir, { recursive: true });
    const detectorPath = join(hooksDir, 'stale-doc-detector.sh');
    writeFileSync(
      detectorPath,
      `#!/usr/bin/env bash
echo '[{"target_path":"docs/modules/README.md","ownership_kind":"implementation-drift","owners":["src/service.ts"],"reason":"Service code changed."}]'
`,
      {
        mode: 0o755,
      },
    );

    const result = await detectStaleDocTargets(root, ['src/service.ts']);

    expect(result).toEqual([
      {
        target_path: 'docs/modules/README.md',
        ownership_kind: 'implementation-drift',
        owners: ['src/service.ts'],
        reason: 'Service code changed.',
      },
    ]);

    rmSync(root, { recursive: true, force: true });
  });

  it('returns empty array when detector exits non-zero', async () => {
    const root = makeTmpRoot();
    const hooksDir = join(root, 'runtime', 'hooks');
    mkdirSync(hooksDir, { recursive: true });
    const detectorPath = join(hooksDir, 'stale-doc-detector.sh');
    writeFileSync(detectorPath, '#!/usr/bin/env bash\nexit 1\n', { mode: 0o755 });

    const result = await detectStaleDocTargets(root, ['src/service.ts']);

    expect(result).toEqual([]);

    rmSync(root, { recursive: true, force: true });
  });

  it('returns empty array when detector outputs non-array JSON', async () => {
    const root = makeTmpRoot();
    const hooksDir = join(root, 'runtime', 'hooks');
    mkdirSync(hooksDir, { recursive: true });
    const detectorPath = join(hooksDir, 'stale-doc-detector.sh');
    writeFileSync(detectorPath, '#!/usr/bin/env bash\necho \'{"stale": []}\'\n', { mode: 0o755 });

    const result = await detectStaleDocTargets(root, ['src/service.ts']);

    expect(result).toEqual([]);

    rmSync(root, { recursive: true, force: true });
  });

  it('normalizes legacy string detector output into ownership records', async () => {
    const root = makeTmpRoot();
    const hooksDir = join(root, 'runtime', 'hooks');
    mkdirSync(hooksDir, { recursive: true });
    const detectorPath = join(hooksDir, 'stale-doc-detector.sh');
    writeFileSync(detectorPath, '#!/usr/bin/env bash\necho \'["docs/modules/README.md"]\'\n', {
      mode: 0o755,
    });

    const result = await detectStaleDocTargets(root, ['src/service.ts']);

    expect(result).toEqual([
      {
        target_path: 'docs/modules/README.md',
        ownership_kind: 'implementation-drift',
        owners: [],
        reason: 'Detector marked this canonical doc as stale for the current diff.',
      },
    ]);

    rmSync(root, { recursive: true, force: true });
  });

  it('treats legacy string detector output as a direct doc edit when the doc changed in the diff', async () => {
    const root = makeTmpRoot();
    const hooksDir = join(root, 'runtime', 'hooks');
    mkdirSync(hooksDir, { recursive: true });
    const detectorPath = join(hooksDir, 'stale-doc-detector.sh');
    writeFileSync(
      detectorPath,
      '#!/usr/bin/env bash\necho \'["docs/modules/core/api/endpoints.md"]\'\n',
      {
        mode: 0o755,
      },
    );

    const result = await detectStaleDocTargets(root, ['docs/modules/core/api/endpoints.md']);

    expect(result).toEqual([
      {
        target_path: 'docs/modules/core/api/endpoints.md',
        ownership_kind: 'direct-doc-edit',
        owners: ['docs/modules/core/api/endpoints.md'],
        reason: 'Canonical doc changed directly in the diff.',
      },
    ]);

    rmSync(root, { recursive: true, force: true });
  });

  it('keeps docs/instructions and docs/maintainers targets and deduplicates repeated reasons', async () => {
    const root = makeTmpRoot();
    const hooksDir = join(root, 'runtime', 'hooks');
    mkdirSync(hooksDir, { recursive: true });
    const detectorPath = join(hooksDir, 'stale-doc-detector.sh');
    writeFileSync(
      detectorPath,
      `#!/usr/bin/env bash
cat <<'JSON'
[
  {
    "target_path": "docs/instructions/rules/testing.md",
    "owners": ["src/service.ts"],
    "reason": "Rules drifted. "
  },
  {
    "target_path": "docs/instructions/rules/testing.md",
    "owners": ["src/other.ts"],
    "reason": "Rules drifted."
  },
  "docs/maintainers/architecture-map.md"
]
JSON
`,
      { mode: 0o755 },
    );

    const result = await detectStaleDocTargets(root, ['src/service.ts']);

    expect(result).toEqual([
      {
        target_path: 'docs/instructions/rules/testing.md',
        ownership_kind: 'implementation-drift',
        owners: ['src/other.ts', 'src/service.ts'],
        reason: 'Rules drifted.',
      },
      {
        target_path: 'docs/maintainers/architecture-map.md',
        ownership_kind: 'implementation-drift',
        owners: [],
        reason: 'Detector marked this canonical doc as stale for the current diff.',
      },
    ]);

    rmSync(root, { recursive: true, force: true });
  });

  it('elevates duplicate ownership to direct-doc-edit when any duplicate entry is a direct edit', async () => {
    const root = makeTmpRoot();
    const hooksDir = join(root, 'runtime', 'hooks');
    mkdirSync(hooksDir, { recursive: true });
    const detectorPath = join(hooksDir, 'stale-doc-detector.sh');
    writeFileSync(
      detectorPath,
      `#!/usr/bin/env bash
cat <<'JSON'
[
  {
    "target_path": "docs/modules/core/api/endpoints.md",
    "owners": ["src/service.ts"],
    "reason": "Implementation drift."
  },
  "docs/modules/core/api/endpoints.md"
]
JSON
`,
      { mode: 0o755 },
    );

    const result = await detectStaleDocTargets(root, ['docs/modules/core/api/endpoints.md']);

    expect(result).toEqual([
      {
        target_path: 'docs/modules/core/api/endpoints.md',
        ownership_kind: 'direct-doc-edit',
        owners: ['docs/modules/core/api/endpoints.md', 'src/service.ts'],
        reason: 'Implementation drift. Canonical doc changed directly in the diff.',
      },
    ]);

    rmSync(root, { recursive: true, force: true });
  });

  it('falls back to changed_files and a direct-edit reason for object detector entries', async () => {
    const root = makeTmpRoot();
    const hooksDir = join(root, 'runtime', 'hooks');
    mkdirSync(hooksDir, { recursive: true });
    const detectorPath = join(hooksDir, 'stale-doc-detector.sh');
    writeFileSync(
      detectorPath,
      `#!/usr/bin/env bash
cat <<'JSON'
[
  {
    "target_path": "docs/modules/core/api/endpoints.md",
    "changed_files": ["src/service.ts", "docs/modules/core/api/endpoints.md"]
  }
]
JSON
`,
      { mode: 0o755 },
    );

    const result = await detectStaleDocTargets(root, ['docs/modules/core/api/endpoints.md']);

    expect(result).toEqual([
      {
        target_path: 'docs/modules/core/api/endpoints.md',
        ownership_kind: 'direct-doc-edit',
        owners: ['docs/modules/core/api/endpoints.md', 'src/service.ts'],
        reason: 'Canonical doc changed directly in the diff.',
      },
    ]);

    rmSync(root, { recursive: true, force: true });
  });

  it('falls back to an implementation-drift reason for object detector entries without a reason', async () => {
    const root = makeTmpRoot();
    const hooksDir = join(root, 'runtime', 'hooks');
    mkdirSync(hooksDir, { recursive: true });
    const detectorPath = join(hooksDir, 'stale-doc-detector.sh');
    writeFileSync(
      detectorPath,
      `#!/usr/bin/env bash
cat <<'JSON'
[
  {
    "target_path": "docs/modules/core/api/endpoints.md",
    "changed_files": ["src/service.ts"]
  }
]
JSON
`,
      { mode: 0o755 },
    );

    const result = await detectStaleDocTargets(root, ['src/service.ts']);

    expect(result).toEqual([
      {
        target_path: 'docs/modules/core/api/endpoints.md',
        ownership_kind: 'implementation-drift',
        owners: ['src/service.ts'],
        reason: 'Detector marked this canonical doc as stale for the current diff.',
      },
    ]);

    rmSync(root, { recursive: true, force: true });
  });

  it('ignores malformed detector entries and falls back to empty owners when changed_files is not an array', async () => {
    const root = makeTmpRoot();
    const hooksDir = join(root, 'runtime', 'hooks');
    mkdirSync(hooksDir, { recursive: true });
    const detectorPath = join(hooksDir, 'stale-doc-detector.sh');
    writeFileSync(
      detectorPath,
      `#!/usr/bin/env bash
cat <<'JSON'
[
  null,
  42,
  {},
  { "target_path": "   " },
  {
    "target_path": "docs/modules/core/api/endpoints.md",
    "changed_files": "src/service.ts",
    "reason": "Kept."
  }
]
JSON
`,
      { mode: 0o755 },
    );

    const result = await detectStaleDocTargets(root, ['src/service.ts']);

    expect(result).toEqual([
      {
        target_path: 'docs/modules/core/api/endpoints.md',
        ownership_kind: 'implementation-drift',
        owners: [],
        reason: 'Kept.',
      },
    ]);

    rmSync(root, { recursive: true, force: true });
  });

  it('accepts direct canonical doc edits as ownership targets', async () => {
    const root = makeTmpRoot();
    const hooksDir = join(root, 'runtime', 'hooks');
    mkdirSync(hooksDir, { recursive: true });
    const detectorPath = join(hooksDir, 'stale-doc-detector.sh');
    writeFileSync(
      detectorPath,
      `#!/usr/bin/env bash
echo '[{"target_path":"docs/modules/core/api/endpoints.md","owners":["docs/modules/core/api/endpoints.md"],"reason":"Doc changed directly."}]'
`,
      { mode: 0o755 },
    );

    const result = await detectStaleDocTargets(root, ['docs/modules/core/api/endpoints.md']);

    expect(result).toEqual([
      {
        target_path: 'docs/modules/core/api/endpoints.md',
        ownership_kind: 'direct-doc-edit',
        owners: ['docs/modules/core/api/endpoints.md'],
        reason: 'Doc changed directly.',
      },
    ]);

    rmSync(root, { recursive: true, force: true });
  });
});
