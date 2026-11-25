import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { isTeamLauncherCommand } from '@/adapters/claude/team-settings.js';
import { PLUGIN_MARKETPLACE_REPO, pluginSettingsKeys } from '@/install/plugin-settings-keys.js';

const REPO = process.cwd();
const SKIP = new Set(['node_modules', 'dist', '.git']);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(ts|mjs|cjs|js)$/u.test(name)) out.push(path);
  }
  return out;
}

const SHIPPED = [...sourceFiles(join(REPO, 'src')), ...sourceFiles(join(REPO, 'runtime'))];

describe('the launcher and its clone route are gone (FR-36, FR-37, INV-14)', () => {
  it('AC-36: no shipped code clones the plugin repo, and the launcher template is gone', () => {
    expect(existsSync(join(REPO, 'runtime/templates/team-bootstrap/hook.mjs'))).toBe(false);
    for (const path of SHIPPED) {
      const text = readFileSync(path, 'utf8');
      const clones = /['"]clone['"]|git clone/u.test(text);
      expect(clones && text.includes(PLUGIN_MARKETPLACE_REPO), path).toBe(false);
      expect(text.includes('paqad-claude-plugin.git'), path).toBe(false);
    }
  });

  it('AC-37: nothing references the launcher renderer or the refresh route, and old launcher lines are still recognised', () => {
    for (const path of SHIPPED) {
      const text = readFileSync(path, 'utf8');
      for (const name of [
        'renderTeamLauncher',
        'maybeStartRefresh',
        'REFRESH_AGE_MS',
        'cloneInto',
      ]) {
        expect(text.includes(name), `${path} names ${name}`).toBe(false);
      }
    }
    expect(
      isTeamLauncherCommand('node "$CLAUDE_PROJECT_DIR/.paqad/hook.mjs" agent-entry-gate.mjs'),
    ).toBe(true);
    expect(
      isTeamLauncherCommand(
        'node "%CLAUDE_PROJECT_DIR%\\.paqad\\hook.mjs" stage-writer.mjs'.replace(/\\/gu, '/'),
      ),
    ).toBe(true);
    expect(isTeamLauncherCommand('node scripts/team-guard.mjs')).toBe(false);
  });

  it('AC-32: the marketplace source carries no ref, so no install waits on a tag, and the release tags the plugin repo with the exact version', () => {
    const source = (
      pluginSettingsKeys(true).extraKnownMarketplaces.eliyce as { source: Record<string, string> }
    ).source;
    expect(source).not.toHaveProperty('ref');
    const workflow = readFileSync(join(REPO, '.github/workflows/release.yml'), 'utf8');
    const publish = workflow.indexOf('publish: pnpm run release');
    const pluginTag = workflow.indexOf('git tag "v${VERSION}"');
    expect(publish).toBeGreaterThan(-1);
    expect(pluginTag).toBeGreaterThan(-1);
    expect(workflow).toContain('refs/tags/v${VERSION}');
  });
});
