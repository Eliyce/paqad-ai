import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  buildPluginManifest,
  PLUGIN_ICON,
  renderClaudePluginStageAgents,
  serializePluginHooksJson,
  serializePluginManifest,
} from '@/plugin/manifest-build.js';
import { PLUGIN_MARKETPLACE_REPO } from '@/install/plugin-migration.js';

import { PLUGIN_MARKETPLACE, PLUGIN_REPO } from '../../../scripts/assemble-plugin.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function read(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

describe('plugin manifest and marketplace', () => {
  it('ships a committed plugin.json consistent with the generator', () => {
    const manifest = JSON.parse(read('.claude-plugin/plugin.json')) as { version: string };
    expect(manifest).toEqual(buildPluginManifest(manifest.version));
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(read('.claude-plugin/plugin.json')).toBe(serializePluginManifest(manifest.version));
  });

  it('AC-3 carries the listing data the plugin directory reads', () => {
    const manifest = buildPluginManifest('1.0.0');
    expect(manifest).toMatchObject({
      displayName: 'paqad',
      author: { name: 'Eliyce', email: 'hello@eliyce.com', url: 'https://eliyce.com' },
      homepage: 'https://paqad.ai',
      repository: 'https://github.com/Eliyce/paqad-claude-plugin',
      license: 'MIT',
      keywords: ['governance', 'code-review', 'evidence', 'rules', 'quality-gates', 'compliance'],
      icon: PLUGIN_ICON,
      documentationUrl: 'https://paqad.ai/docs/',
      supportUrl: 'https://paqad.ai/support/',
      privacyPolicyUrl: 'https://paqad.ai/privacy/',
      termsOfServiceUrl: 'https://paqad.ai/terms/',
    });
    for (const key of ['documentationUrl', 'supportUrl', 'privacyPolicyUrl', 'termsOfServiceUrl']) {
      expect(manifest[key]).toMatch(/^https:\/\//);
    }
    expect(PLUGIN_ICON).toBe('./assets/icon.png');
    const icon = readFileSync(join(repoRoot, PLUGIN_ICON));
    expect(icon.subarray(1, 4).toString('latin1')).toBe('PNG');
    expect(icon.readUInt32BE(16)).toBe(512);
    expect(icon.readUInt32BE(20)).toBe(512);
  });

  it('keeps the directory listing fields out of the marketplace entry', () => {
    const [entry] = PLUGIN_MARKETPLACE.plugins as Record<string, unknown>[];
    expect(entry).toMatchObject({ displayName: 'paqad', homepage: 'https://paqad.ai' });
    for (const key of [
      'icon',
      'documentationUrl',
      'supportUrl',
      'privacyPolicyUrl',
      'termsOfServiceUrl',
      'version',
    ]) {
      expect(entry).not.toHaveProperty(key);
    }
  });

  it('ships the listing icon and the security policy in the npm package', () => {
    const files = (JSON.parse(read('package.json')) as { files: string[] }).files;
    expect(files).toContain('assets/icon.png');
    expect(files).toContain('SECURITY.md');
    expect(read('SECURITY.md')).toContain('security@eliyce.com');
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

  it('keeps no marketplace in this repository and names the plugin repo for the eliyce marketplace', () => {
    expect(existsSync(join(repoRoot, '.claude-plugin', 'marketplace.json'))).toBe(false);
    expect(PLUGIN_MARKETPLACE_REPO).toBe('Eliyce/paqad-claude-plugin');
    expect(PLUGIN_REPO).toBe(PLUGIN_MARKETPLACE_REPO);
    expect(PLUGIN_MARKETPLACE.name).toBe('eliyce');
    expect(PLUGIN_MARKETPLACE.plugins.map((plugin) => [plugin.name, plugin.source])).toEqual([
      ['paqad', './'],
    ]);
  });

  it('ships .claude-plugin/plugin.json but not the marketplace in the npm package', () => {
    const files = (JSON.parse(read('package.json')) as { files: string[] }).files;
    expect(files).toContain('.claude-plugin/plugin.json');
    expect(files).not.toContain('.claude-plugin');
    expect(files).not.toContain('.claude-plugin/marketplace.json');
  });
});
