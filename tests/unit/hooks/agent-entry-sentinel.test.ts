import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { sentinelPath, sentinelState } from '../../../runtime/hooks/lib/agent-entry-sentinel.mjs';

const SESSION = 'session-a';

describe('agent-entry sentinel staleness walk', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'paqad-sentinel-'));
    mkdirSync(join(projectRoot, '.paqad'), { recursive: true });
    mkdirSync(join(projectRoot, 'docs/instructions/tech-debt'), { recursive: true });
    mkdirSync(join(projectRoot, 'docs/instructions/rules'), { recursive: true });
    writeFileSync(join(projectRoot, 'CLAUDE.md'), '# entry');
    writeFileSync(join(projectRoot, '.paqad/framework-path.txt'), '~/.paqad-ai/current\n');
    const past = new Date(Date.now() - 120_000);
    utimesSync(join(projectRoot, 'CLAUDE.md'), past, past);
    utimesSync(join(projectRoot, '.paqad/framework-path.txt'), past, past);
    const sentinel = sentinelPath(projectRoot, SESSION);
    mkdirSync(join(sentinel, '..'), { recursive: true });
    writeFileSync(sentinel, '{}');
    const loaded = new Date(Date.now() - 60_000);
    utimesSync(sentinel, loaded, loaded);
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('stays fresh when a tech-debt item is written after the load', () => {
    writeFileSync(
      join(projectRoot, 'docs/instructions/tech-debt/TD-01M5CCWX6FTKY8C6EJKMR9EH3D.md'),
      '---\nid: "TD-01M5CCWX6FTKY8C6EJKMR9EH3D"\n---\n',
    );
    writeFileSync(join(projectRoot, 'docs/instructions/tech-debt/overview.md'), '# Tech debt\n');

    expect(sentinelState(projectRoot, {}, undefined, SESSION)).toBe('fresh');
  });

  it('goes stale when a rules file under docs/instructions changes', () => {
    writeFileSync(join(projectRoot, 'docs/instructions/rules/x.md'), '# rule');

    expect(sentinelState(projectRoot, {}, undefined, SESSION)).toBe('stale:docs-instructions');
  });

  it('goes stale for a folder that only shares the tech-debt name prefix', () => {
    mkdirSync(join(projectRoot, 'docs/instructions/tech-debt-notes'), { recursive: true });
    writeFileSync(join(projectRoot, 'docs/instructions/tech-debt-notes/a.md'), '# a');

    expect(sentinelState(projectRoot, {}, undefined, SESSION)).toBe('stale:docs-instructions');
  });
});
