import { execa } from 'execa';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const script = join(process.cwd(), 'runtime/hooks/skill-index-gen.mjs');
const META = 'triggers:\n  - workflow: [feature-development]\n';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-skill-index-gen-'));
  write(
    '.paqad/project-profile.yaml',
    'model_routing:\n  fast_model: f\n  reasoning_model: r\n  default_model: d\n',
  );
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(rel: string, content: string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}

function skill(name: string, ref: string): string {
  return `---\nname: ${name}\ndescription: ${name}.\nmetadata:\n  paqad-meta: ${ref}\n---\nBody\n`;
}

async function run(): Promise<{ index: { name: string; triggers: unknown }[]; stderr: string }> {
  const out = join(root, 'index.json');
  const result = await execa('node', [script, out, root], { reject: false });
  expect(result.exitCode).toBe(0);
  return { index: JSON.parse(readFileSync(out, 'utf8')), stderr: result.stderr };
}

describe('skill-index-gen.mjs resolves skill metadata like the parser', () => {
  it('reads triggers from skill.meta.yaml', async () => {
    write('.claude/skills/good/SKILL.md', skill('good', 'skill.meta.yaml'));
    write('.claude/skills/good/skill.meta.yaml', META);
    const { index, stderr } = await run();
    expect(index).toEqual([
      expect.objectContaining({ name: 'good', triggers: [{ workflow: ['feature-development'] }] }),
    ]);
    expect(stderr).toBe('');
  });

  it('leaves out a skill whose skill.meta.yaml is missing or malformed, naming the skill and file', async () => {
    write('.claude/skills/missing/SKILL.md', skill('missing', 'skill.meta.yaml'));
    write('.claude/skills/broken/SKILL.md', skill('broken', 'skill.meta.yaml'));
    write('.claude/skills/broken/skill.meta.yaml', 'triggers: [unclosed\n');
    const { index, stderr } = await run();
    expect(index).toEqual([]);
    expect(stderr).toContain(
      'Skill "missing": skill.meta.yaml named by metadata.paqad-meta is missing.',
    );
    expect(stderr).toContain('Skill "broken": skill.meta.yaml is not valid YAML');
  });

  it('refuses a paqad-meta that leads through a symlinked directory outside the skill folder', async () => {
    write('outside/skill.meta.yaml', META);
    write('.claude/skills/linked/SKILL.md', skill('linked', 'sub/skill.meta.yaml'));
    symlinkSync(join(root, 'outside'), join(root, '.claude/skills/linked/sub'));
    const { index, stderr } = await run();
    expect(index).toEqual([]);
    expect(stderr).toContain(
      'Skill "linked": sub/skill.meta.yaml leads through a symlink outside the skill folder.',
    );
  });

  it('writes one deprecation line for a skill with old top-level keys, once across runs', async () => {
    write(
      '.claude/skills/old/SKILL.md',
      '---\nname: old\ndescription: Old.\nmodel_tier: fast\ntriggers:\n  - workflow: [feature-development]\n---\nBody\n',
    );
    const line =
      'Skill "old": top-level model_tier, triggers are deprecated and stop working in 1.117.0; move them under metadata (or skill.meta.yaml).';
    const first = await run();
    expect(first.index).toHaveLength(1);
    expect(first.stderr).toBe(`paqad: ${line}`);
    const second = await run();
    expect(second.stderr).toBe('');
    const events = readFileSync(join(root, '.paqad/skills/events.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((row) => JSON.parse(row) as { type: string; message: string });
    expect(events).toEqual([
      expect.objectContaining({ type: 'skill.metadata_deprecated', message: line }),
    ]);
  });
});
