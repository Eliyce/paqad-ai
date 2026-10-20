import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  buildPluginManifest,
  renderClaudePluginStageAgents,
  serializePluginHooksJson,
} from '@/plugin/manifest-build.js';
import { PLUGIN_MARKETPLACE_REPO } from '@/install/plugin-migration.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function read(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

describe('plugin manifest + marketplace', () => {
  it('ships a committed plugin.json consistent with the generator', () => {
    const manifest = JSON.parse(read('.claude-plugin/plugin.json')) as { version: string };
    expect(manifest).toEqual(buildPluginManifest(manifest.version));
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('names the HUD mod contract and declares no userConfig, so install prints no warning', () => {
    const manifest = JSON.parse(read('.claude-plugin/plugin.json')) as Record<string, unknown>;
    expect(manifest.types).toBe('./runtime/claude-plugin/mod/types/index.d.ts');
    expect(read(manifest.types as string)).toContain('interface PluginState');
    expect(manifest).not.toHaveProperty('userConfig');
    expect(buildPluginManifest('1.0.0')).not.toHaveProperty('userConfig');
  });

  it('ships the mod but not its tests in the npm package', () => {
    const files = (JSON.parse(read('package.json')) as { files: string[] }).files;
    expect(files).toContain('runtime');
    expect(files).toContain('!runtime/claude-plugin/mod/**/*.test.ts');
    expect(files).toContain('!runtime/claude-plugin/mod/test');
  });

  it('keeps hooks.json in sync with the plugin hook chain', () => {
    expect(read('runtime/claude-plugin/hooks.json')).toBe(serializePluginHooksJson());
  });

  it('keeps every bundled stage agent in sync with the template', () => {
    for (const agent of renderClaudePluginStageAgents()) {
      expect(read(`runtime/claude-plugin/agents/${agent.name}`)).toBe(agent.content);
    }
  });

  it('ships the onboard, join, and dashboard skills under the declared skills dir', () => {
    const manifest = JSON.parse(read('.claude-plugin/plugin.json')) as { skills: string };
    expect(manifest.skills).toBe('./runtime/claude-plugin/skills');
    for (const name of ['onboard', 'join', 'dashboard']) {
      const skill = read(`runtime/claude-plugin/skills/${name}/SKILL.md`);
      expect(skill).toContain(`name: ${name}`);
    }
  });

  it('declares the eliyce marketplace with the paqad plugin from the Eliyce/paqad-plugin repo', () => {
    const marketplace = JSON.parse(read('.claude-plugin/marketplace.json')) as {
      name: string;
      plugins: { name: string; source: unknown; category?: string }[];
    };
    expect(marketplace.name).toBe('eliyce');
    expect(marketplace.plugins).toHaveLength(1);
    expect(marketplace.plugins[0].name).toBe('paqad');
    expect(marketplace.plugins[0].source).toEqual({
      source: 'github',
      repo: 'Eliyce/paqad-plugin',
    });
    expect(PLUGIN_MARKETPLACE_REPO).toBe('Eliyce/paqad-ai');
  });

  it('ships .claude-plugin/plugin.json but not the marketplace in the npm package', () => {
    const files = (JSON.parse(read('package.json')) as { files: string[] }).files;
    expect(files).toContain('.claude-plugin/plugin.json');
    expect(files).not.toContain('.claude-plugin');
    expect(files).not.toContain('.claude-plugin/marketplace.json');
  });
});
