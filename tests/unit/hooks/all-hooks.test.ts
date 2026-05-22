import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { execa } from 'execa';

describe('remaining hook scenarios', () => {
  it('writes a handoff snapshot during pre-compact preservation', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-compact-'));
    const output = join(root, '.paqad/session/handoff.md');

    const result = await execa(join(process.cwd(), 'runtime/hooks/pre-compact-preserve.mjs'), {
      reject: false,
      input: JSON.stringify({ output_path: output, handoff: '# handoff' }),
    });

    expect(result.exitCode).toBe(0);
    expect(existsSync(output)).toBe(true);
    expect(readFileSync(output, 'utf8')).toBe('# handoff');
    rmSync(root, { recursive: true, force: true });
  });

  it('tracks changed files as json', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-changed-files-'));
    const output = join(root, '.paqad/session/changed-files.json');

    const result = await execa(join(process.cwd(), 'runtime/hooks/track-file-changes.sh'), {
      reject: false,
      input: JSON.stringify({ output_path: output, files: ['a.ts', 'b.ts'] }),
    });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(readFileSync(output, 'utf8'))).toEqual(['a.ts', 'b.ts']);
    rmSync(root, { recursive: true, force: true });
  });

  it('detects stale canonical docs from a diff', async () => {
    const result = await execa(join(process.cwd(), 'runtime/hooks/stale-doc-detector.sh'), {
      reject: false,
      input: 'src/skills/frontmatter-parser.ts\nruntime/base/agents/router.md\n',
    });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([
      {
        target_path: 'docs/maintainers/architecture-map.md',
        ownership_kind: 'implementation-drift',
        owners: ['runtime/base/agents/router.md', 'src/skills/frontmatter-parser.ts'],
        reason:
          'Implementation change in src/skills/frontmatter-parser.ts can stale architecture ownership mappings. Implementation change in runtime/base/agents/router.md can stale architecture ownership mappings.',
      },
      {
        target_path: 'docs/modules/README.md',
        ownership_kind: 'implementation-drift',
        owners: ['runtime/base/agents/router.md', 'src/skills/frontmatter-parser.ts'],
        reason:
          'Implementation change in src/skills/frontmatter-parser.ts can stale module-level canonical summaries. Implementation change in runtime/base/agents/router.md can stale module-level canonical summaries.',
      },
    ]);
  });

  it('recommends compact-and-resume when context budget is tight', async () => {
    const result = await execa(join(process.cwd(), 'runtime/hooks/context-budget-check.sh'), {
      reject: false,
      input: JSON.stringify({
        current_hit_rate: 0.5,
        target_hit_rate: 0.7,
        tokens_used: 9200,
        max_tokens: 10000,
      }),
    });

    expect(result.exitCode).toBe(10);
    expect(JSON.parse(result.stdout)).toMatchObject({
      action: 'compact-and-resume',
      should_resume: true,
    });
  });

  it('appends approved destructive operations to the audit log', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-audit-'));
    const auditPath = join(root, '.paqad/audit.log');

    const result = await execa(join(process.cwd(), 'runtime/hooks/post-destructive-approved.sh'), {
      reject: false,
      input: JSON.stringify({
        audit_path: auditPath,
        operation: 'drop-table',
        approved_by: 'reviewer',
        actor: 'framework',
        command: 'DROP TABLE users',
      }),
    });

    expect(result.exitCode).toBe(0);
    expect(readFileSync(auditPath, 'utf8')).toContain('"operation":"drop-table"');
    rmSync(root, { recursive: true, force: true });
  });
});
