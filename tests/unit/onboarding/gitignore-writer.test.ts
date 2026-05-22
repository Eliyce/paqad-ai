import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import { writeGitignore } from '@/onboarding/gitignore-writer';

describe('writeGitignore', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-gitignore-'));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('creates .gitignore from scratch when no file exists', () => {
    writeGitignore(projectRoot);

    expect(existsSync(join(projectRoot, '.gitignore'))).toBe(true);
    const content = readFileSync(join(projectRoot, '.gitignore'), 'utf8');
    expect(content).toContain('# paqad-ai');
    expect(content).toContain('.paqad/framework-path.txt');
    expect(content).toContain('.paqad/cache/');
    expect(content).toContain('.paqad/session/');
    expect(content).toContain('.paqad/context/');
    expect(content).toContain('.paqad/vectors/');
    expect(content).toContain('.paqad/secrets.env');
    expect(content).toContain('.paqad/workflows/');
    expect(content).toContain('.paqad/indexes/');
    expect(content).toContain('.paqad/pentest/');
    expect(content).toContain('.paqad/theme/');
  });

  it('appends paqad section to an existing .gitignore', () => {
    const existing = 'node_modules/\ndist/\n';
    writeFileSync(join(projectRoot, '.gitignore'), existing);

    writeGitignore(projectRoot);

    const content = readFileSync(join(projectRoot, '.gitignore'), 'utf8');
    expect(content).toContain('node_modules/');
    expect(content).toContain('dist/');
    expect(content).toContain('# paqad-ai');
    expect(content).toContain('.paqad/framework-path.txt');
    expect(content).toContain('.paqad/cache/');
  });

  it('is idempotent — does not append duplicate entries on re-run', () => {
    writeGitignore(projectRoot);
    writeGitignore(projectRoot);

    const content = readFileSync(join(projectRoot, '.gitignore'), 'utf8');
    const markerCount = (content.match(/# paqad-ai/g) ?? []).length;
    expect(markerCount).toBe(1);
  });

  it('does not corrupt existing .gitignore content on re-run', () => {
    const existing = 'node_modules/\n.env\n';
    writeFileSync(join(projectRoot, '.gitignore'), existing);

    writeGitignore(projectRoot);
    writeGitignore(projectRoot);

    const content = readFileSync(join(projectRoot, '.gitignore'), 'utf8');
    expect(content).toContain('node_modules/');
    expect(content).toContain('.env');
  });

  it('handles existing .gitignore with no trailing newline', () => {
    writeFileSync(join(projectRoot, '.gitignore'), 'node_modules/');

    writeGitignore(projectRoot);

    const content = readFileSync(join(projectRoot, '.gitignore'), 'utf8');
    expect(content).toContain('node_modules/');
    expect(content).toContain('# paqad-ai');
  });
});
