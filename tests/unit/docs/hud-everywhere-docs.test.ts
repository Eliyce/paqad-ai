import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO = resolve(__dirname, '../../..');

function markdownUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return markdownUnder(path);
    return name.endsWith('.md') ? [path] : [];
  });
}

describe('AC-35: the docs agree with the HUD everywhere change', () => {
  it('no doc says a cloud session loads no plugin', () => {
    const files = [...markdownUnder(join(REPO, 'docs')), join(REPO, 'README.md')];
    const stale = files.filter((file) =>
      /a (?:Claude Code )?cloud session loads no\s+plugin/u.test(readFileSync(file, 'utf8')),
    );
    expect(stale).toEqual([]);
  });

  it('the discovery plugin docs name it paqad-discovery', () => {
    for (const file of ['plugins/discovery/README.md', 'plugins/discovery/publish/claude/README.md']) {
      const text = readFileSync(join(REPO, file), 'utf8');
      expect(text, file).toContain('/paqad-discovery:start');
      expect(text, file).not.toMatch(/manifest name `paqad`/u);
    }
  });
});
