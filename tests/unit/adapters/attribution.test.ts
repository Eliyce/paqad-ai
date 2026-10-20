import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import YAML from 'yaml';
import { describe, expect, it } from 'vitest';

import { AiderAdapter, ClaudeCodeAdapter, CodexCliAdapter, CursorAdapter } from '@/adapters';
import type { AdapterInterface } from '@/adapters/adapter.interface.js';

function makeProject(files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-attr-adapter-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
  }
  return root;
}

function generate(adapter: AdapterInterface, projectRoot: string) {
  return adapter.generateConfig({
    frameworkPath: '.paqad/framework-path.txt',
    rulesPath: 'docs/instructions/rules',
    projectRoot,
  });
}

async function fileAt(adapter: AdapterInterface, projectRoot: string, path: string) {
  const files = await generate(adapter, projectRoot);
  return files.find((file) => file.path === path);
}

const KEEP = { '.paqad/configs/.config.policy': 'ai_attribution=keep' };

describe('ClaudeCodeAdapter attribution', () => {
  const adapter = new ClaudeCodeAdapter();

  it('writes the attribution object that silences the commit trailer, the PR line and the session URL', async () => {
    const settings = await fileAt(adapter, makeProject(), '.claude/settings.json');
    expect(JSON.parse(settings?.content ?? '{}').attribution).toEqual({
      commit: '',
      pr: '',
      sessionUrl: false,
    });
  });

  it('never writes the deprecated includeCoAuthoredBy key', async () => {
    const settings = await fileAt(adapter, makeProject(), '.claude/settings.json');
    expect(settings?.content).not.toContain('includeCoAuthoredBy');
  });

  it('preserves an attribution value the team set by hand', async () => {
    const root = makeProject({
      '.claude/settings.json': JSON.stringify({ attribution: { commit: 'Built at Acme' } }),
    });
    const settings = await fileAt(adapter, root, '.claude/settings.json');
    const attribution = JSON.parse(settings?.content ?? '{}').attribution;
    expect(attribution.commit).toBe('Built at Acme');
    expect(attribution.pr).toBe('');
    expect(attribution.sessionUrl).toBe(false);
  });

  it('preserves an unknown key inside an existing attribution object', async () => {
    const root = makeProject({
      '.claude/settings.json': JSON.stringify({ attribution: { somethingNew: 'x' } }),
    });
    const settings = await fileAt(adapter, root, '.claude/settings.json');
    expect(JSON.parse(settings?.content ?? '{}').attribution.somethingNew).toBe('x');
  });

  it('writes no attribution key when the policy says keep', async () => {
    const settings = await fileAt(adapter, makeProject(KEEP), '.claude/settings.json');
    expect(JSON.parse(settings?.content ?? '{}').attribution).toBeUndefined();
  });

  it('still writes the entry-gate hooks alongside the attribution object', async () => {
    const settings = await fileAt(adapter, makeProject(), '.claude/settings.json');
    expect(JSON.parse(settings?.content ?? '{}').hooks).toBeDefined();
  });
});

describe('AiderAdapter attribution', () => {
  const adapter = new AiderAdapter();

  it('turns off the author, committer and co-authored-by attribution', async () => {
    const config = await fileAt(adapter, makeProject(), '.aider.conf.yml');
    expect(YAML.parse(config?.content ?? '')).toEqual({
      'attribute-author': false,
      'attribute-committer': false,
      'attribute-co-authored-by': false,
    });
  });

  it('preserves unrelated keys and a hand-set attribution value in an existing config', async () => {
    const root = makeProject({
      '.aider.conf.yml': YAML.stringify({ model: 'gpt-4o', 'attribute-author': true }),
    });
    const config = await fileAt(adapter, root, '.aider.conf.yml');
    expect(YAML.parse(config?.content ?? '')).toEqual({
      model: 'gpt-4o',
      'attribute-author': true,
      'attribute-committer': false,
      'attribute-co-authored-by': false,
    });
  });

  it("preserves the team's own comments and key order", async () => {
    const root = makeProject({
      '.aider.conf.yml': ['# our house model, do not change', 'model: gpt-4o', ''].join('\n'),
    });
    const config = await fileAt(adapter, root, '.aider.conf.yml');
    expect(config?.content).toContain('# our house model, do not change');
    expect(config?.content?.indexOf('model:')).toBeLessThan(
      config?.content?.indexOf('attribute-author') ?? -1,
    );
  });

  it('survives an unparseable existing config rather than throwing', async () => {
    const root = makeProject({ '.aider.conf.yml': '{{{ not yaml' });
    const config = await fileAt(adapter, root, '.aider.conf.yml');
    expect(YAML.parse(config?.content ?? '')['attribute-author']).toBe(false);
  });

  it('replaces a config whose top level is not a mapping', async () => {
    const root = makeProject({ '.aider.conf.yml': '- just\n- a list\n' });
    const config = await fileAt(adapter, root, '.aider.conf.yml');
    expect(YAML.parse(config?.content ?? '')).toEqual({
      'attribute-author': false,
      'attribute-committer': false,
      'attribute-co-authored-by': false,
    });
  });

  it('writes no config file at all when the policy says keep', async () => {
    const files = await generate(adapter, makeProject(KEEP));
    expect(files.map((file) => file.path)).not.toContain('.aider.conf.yml');
  });
});

describe('adapters with no project-level attribution knob', () => {
  it.each([
    ['Codex', new CodexCliAdapter()],
    ['Cursor', new CursorAdapter()],
  ])('%s writes no attribution config', async (_name, adapter) => {
    const files = await generate(adapter as AdapterInterface, makeProject());
    for (const file of files) {
      expect(file.content).not.toMatch(/attribut/i);
      expect(file.path).not.toMatch(/cli-config\.json|config\.toml/);
    }
  });
});
