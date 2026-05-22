import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { appendAuditLog, appendAuditLogFailure } from '@/update/audit.js';
import { VERSION } from '@/index.js';
import { FrameworkUpdater } from '@/update/index.js';

describe('audit log helpers', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'paqad-audit-'));
    mkdirSync(join(root, '.paqad'), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('appendAuditLog writes an INFO line', () => {
    appendAuditLog(root, '1.0.0', '1.1.0');
    const content = readFileSync(join(root, '.paqad/audit.log'), 'utf8');
    expect(content).toMatch(/INFO silent-update previous=1\.0\.0 updated=1\.1\.0/);
    expect(content).toMatch(/^\[\d{4}-\d{2}-\d{2}T/);
  });

  it('appendAuditLogFailure writes a WARN line', () => {
    appendAuditLogFailure(root, '1.0.0', '1.1.0', 'network error');
    const content = readFileSync(join(root, '.paqad/audit.log'), 'utf8');
    expect(content).toMatch(/WARN silent-update-failed previous=1\.0\.0 target=1\.1\.0/);
    expect(content).toMatch(/error="network error"/);
  });

  it('appends multiple lines without overwriting', () => {
    appendAuditLog(root, '1.0.0', '1.1.0');
    appendAuditLog(root, '1.1.0', '1.2.0');
    const lines = readFileSync(join(root, '.paqad/audit.log'), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
  });

  it('creates the .paqad directory if missing', () => {
    const bare = mkdtempSync(join(tmpdir(), 'paqad-bare-'));
    try {
      appendAuditLog(bare, null, '1.0.0');
      expect(existsSync(join(bare, '.paqad/audit.log'))).toBe(true);
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });

  it('uses "unknown" when previous version is null', () => {
    appendAuditLog(root, null, '1.0.0');
    const content = readFileSync(join(root, '.paqad/audit.log'), 'utf8');
    expect(content).toContain('previous=unknown');
  });
});

describe('FrameworkUpdater — version file format', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-updater-'));
    mkdirSync(join(projectRoot, '.paqad'), { recursive: true });
    // Write old single-line format to ensure backward-compat parsing
    writeFileSync(join(projectRoot, '.paqad/framework-version.txt'), '0.0.1\n');
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('reads old single-line version format as previous_version', async () => {
    const updater = new FrameworkUpdater({
      generateCandidates: async () => [],
    });
    const report = await updater.run(projectRoot);
    expect(report.previous_version).toBe('0.0.1');
  });

  it('writes new key=value version format after update', async () => {
    const updater = new FrameworkUpdater({
      generateCandidates: async () => [],
    });
    await updater.run(projectRoot);
    const content = readFileSync(join(projectRoot, '.paqad/framework-version.txt'), 'utf8');
    expect(content).toMatch(/^version=/m);
    expect(content).toContain(`version=${VERSION}`);
    expect(content).toMatch(/^updated_at=/m);
  });

  it('reads new key=value version format as previous_version', async () => {
    writeFileSync(
      join(projectRoot, '.paqad/framework-version.txt'),
      `version=0.5.0\nupdated_at=2024-01-01T00:00:00.000Z\n`,
    );
    const updater = new FrameworkUpdater({
      generateCandidates: async () => [],
    });
    const report = await updater.run(projectRoot);
    expect(report.previous_version).toBe('0.5.0');
  });
});
