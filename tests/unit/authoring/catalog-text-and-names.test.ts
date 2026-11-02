import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { renderStageAgentFiles } from '@/stage-isolation/agent-writer.js';

const REPO = process.cwd();
const EM_DASH = '—';
const SKILL_PARENTS = ['runtime/base', 'runtime/claude-plugin', ...capabilityDirs()];

function capabilityDirs(): string[] {
  return readdirSync(join(REPO, 'runtime/capabilities')).map(
    (name) => `runtime/capabilities/${name}`,
  );
}

function filesUnder(rel: string): string[] {
  const abs = join(REPO, rel);
  if (statSync(abs).isFile()) return [rel];
  return readdirSync(abs).flatMap((name) => filesUnder(`${rel}/${name}`));
}

function skillFolders(): string[] {
  return SKILL_PARENTS.flatMap((parent) => {
    const dir = join(REPO, parent, 'skills');
    try {
      return readdirSync(dir).map((name) => `${parent}/skills/${name}`);
    } catch {
      return [];
    }
  });
}

function frontmatterName(text: string): string | null {
  const match = /^---\n([\s\S]*?)\n---/u.exec(text);
  if (!match) return null;
  const line = match[1]!.split('\n').find((entry) => entry.startsWith('name:'));
  return line === undefined
    ? null
    : line
        .slice('name:'.length)
        .trim()
        .replace(/^['"]|['"]$/gu, '');
}

interface NameEntry {
  path: string;
  folder: string;
  name: string | null;
}

function currentNames(): NameEntry[] {
  const entries: NameEntry[] = [];
  for (const folder of skillFolders()) {
    const path = `${folder}/SKILL.md`;
    try {
      entries.push({
        path,
        folder: folder.split('/').at(-1)!,
        name: frontmatterName(readFileSync(join(REPO, path), 'utf8')),
      });
    } catch {
      continue;
    }
  }
  for (const parent of SKILL_PARENTS) {
    const dir = join(REPO, parent, 'agents');
    let names: string[];
    try {
      names = readdirSync(dir).filter((name) => name.endsWith('.md'));
    } catch {
      continue;
    }
    for (const file of names) {
      const path = `${parent}/agents/${file}`;
      entries.push({
        path,
        folder: file.slice(0, -'.md'.length),
        name: frontmatterName(readFileSync(join(REPO, path), 'utf8')),
      });
    }
  }
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

describe('AC-7: no em dash in any skill folder, agent or stage-agent template', () => {
  it('scans every file in every skill folder, the plugin agents and both templates', () => {
    const files = [
      ...skillFolders().flatMap(filesUnder),
      ...filesUnder('runtime/claude-plugin/agents'),
      'runtime/templates/stage-agents/claude.md.hbs',
      'runtime/templates/stage-agents/codex.toml.hbs',
    ];
    expect(files.length).toBeGreaterThan(100);
    const withDash = files.filter((rel) => readFileSync(join(REPO, rel), 'utf8').includes(EM_DASH));
    expect(withDash).toEqual([]);
  });

  it('renders every stage and High Table agent on both hosts without an em dash', () => {
    for (const host of ['claude-code', 'codex-cli']) {
      for (const { name, content } of renderStageAgentFiles(host)) {
        expect(content.includes(EM_DASH), `${host} ${name}`).toBe(false);
      }
    }
  });
});

describe('AC-28: skill and agent names match the list captured from main', () => {
  it('keeps every folder and frontmatter name, sorted, identical', () => {
    const fixture = JSON.parse(
      readFileSync(join(REPO, 'tests/fixtures/authoring/skill-agent-names.json'), 'utf8'),
    ) as { items: NameEntry[] };
    const sorted = (entries: NameEntry[]) =>
      entries.map((entry) => `${entry.path}\t${entry.folder}\t${entry.name ?? ''}`).sort();
    expect(sorted(currentNames())).toEqual(sorted(fixture.items));
  });
});
