import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
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

const PLUGIN_SKILLS = [
  'onboard',
  'join',
  'dashboard',
  'start',
  'discover',
  'ask',
  'get-connected',
  'understand-idea',
  'ground-in-project',
  'shape-idea',
  'decide-together',
  'write-tickets',
  'check-tickets',
  'post-tickets',
  'refine-ticket',
  'size-work',
  'plan-sprint',
];

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

  it('names the HUD mod contract', () => {
    const manifest = JSON.parse(read('.claude-plugin/plugin.json')) as Record<string, unknown>;
    expect(manifest.types).toBe('./runtime/claude-plugin/mod/types/index.d.ts');
    expect(read(manifest.types as string)).toContain('interface PluginState');
  });

  it('declares the two optional API keys as sensitive plugin options', () => {
    const userConfig = buildPluginManifest('1.0.0').userConfig as Record<
      string,
      Record<string, unknown>
    >;
    expect(Object.keys(userConfig).sort()).toEqual(['cohere_api_key', 'openai_api_key']);
    for (const option of Object.values(userConfig)) {
      expect(option).toMatchObject({ type: 'string', sensitive: true, required: false });
      expect(typeof option.title).toBe('string');
      expect(typeof option.description).toBe('string');
      expect(Object.keys(option).sort()).toEqual([
        'description',
        'required',
        'sensitive',
        'title',
        'type',
      ]);
    }
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

  it('AC-3: ships exactly the 17 plugin skills under the declared skills dir', () => {
    const manifest = JSON.parse(read('.claude-plugin/plugin.json')) as { skills: string };
    expect(manifest.skills).toBe('./runtime/claude-plugin/skills');
    const folders = readdirSync(join(repoRoot, 'runtime', 'claude-plugin', 'skills')).sort();
    expect(folders).toEqual([...PLUGIN_SKILLS].sort());
    for (const name of folders) {
      expect(name.startsWith('paqad')).toBe(false);
      const skill = read(`runtime/claude-plugin/skills/${name}/SKILL.md`);
      expect(skill.match(/^name: (.+)$/m)?.[1]).toBe(name);
    }
  });

  it('AC-16: the npm package carries onboard, join and dashboard but no discovery skill', () => {
    const out = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
      cwd: repoRoot,
      encoding: 'utf8',
      shell: process.platform === 'win32',
    });
    expect(out.status).toBe(0);
    const [pack] = JSON.parse(out.stdout) as { files: { path: string }[] }[];
    const shipped = new Set(
      pack!.files
        .map((file) => file.path.replace(/\\/g, '/'))
        .filter((path) => path.startsWith('runtime/claude-plugin/skills/'))
        .map((path) => path.split('/')[3]),
    );
    expect([...shipped].sort()).toEqual(['dashboard', 'join', 'onboard']);
  }, 60_000);

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
