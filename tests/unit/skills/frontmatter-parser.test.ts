import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ValidationError } from '@/core/errors/index.js';
import {
  clearSkillMetadataDeprecations,
  SkillFrontmatterParser,
  skillDeclaresRequestRouting,
  skillMetadataDeprecations,
} from '@/skills/frontmatter-parser.js';

describe('SkillFrontmatterParser', () => {
  const parser = new SkillFrontmatterParser();

  it('rejects files without opening frontmatter', () => {
    expect(() => parser.parse('name: nope')).toThrowError(ValidationError);
  });

  it('rejects files without a closing frontmatter boundary', () => {
    expect(() =>
      parser.parse(`---
name: broken
description: Broken
`),
    ).toThrowError(ValidationError);
  });

  it('rejects non-object YAML frontmatter', () => {
    expect(() =>
      parser.parse(`---
- one
- two
---
body
`),
    ).toThrowError(ValidationError);
  });

  it('rejects invalid output_format values', () => {
    expect(() =>
      parser.parse(`---
name: broken
description: Broken
model_tier: fast
triggers:
  - workflow: [feature-development]
cacheable: false
cache_key_inputs: []
output_format: xml
input_schema:
  request_text:
    type: string
    required: true
---
body
`),
    ).toThrowError(ValidationError);
  });

  it('rejects non-object input_schema values', () => {
    expect(() =>
      parser.parse(`---
name: broken
description: Broken
model_tier: fast
triggers:
  - workflow: [feature-development]
cacheable: false
cache_key_inputs: []
output_format: markdown
input_schema: nope
---
body
`),
    ).toThrowError(ValidationError);
  });

  it('rejects malformed completion triggers', () => {
    expect(() =>
      parser.parse(`---
name: broken
description: Broken
model_tier: fast
triggers:
  - workflow: [feature-development]
cacheable: false
cache_key_inputs: []
output_format: markdown
input_schema:
  request_text:
    type: string
    required: true
on_complete:
  emit: done
  triggers: nope
---
body
`),
    ).toThrowError(ValidationError);
  });

  it('trims string fields and preserves optional description omission', () => {
    const parsed = parser.parse(`---
name: trimmed-skill
description:   Trimmed description   
model_tier: reasoning
triggers:
  - workflow: [feature-development]
cacheable: false
cache_key_inputs: []
output_format: markdown
input_schema:
  request_text:
    type: string
    required: true
---
Body.
`);

    expect(parsed.frontmatter.name).toBe('trimmed-skill');
    expect(parsed.frontmatter.description).toBe('Trimmed description');
    expect(parsed.frontmatter.input_schema.request_text?.description).toBeUndefined();
  });

  it('accepts request_routing without triggers for pre-routing skills', () => {
    const parsed = parser.parse(`---
name: workflow-router
description: Route requests
model_tier: fast
request_routing:
  - priority: 100
    target_workflow: documentation-update
    patterns:
      - create documentation
cacheable: true
cache_key_inputs: [request_text]
output_format: yaml
input_schema:
  request_text:
    type: string
    required: true
---
Body.
`);

    expect(parsed.frontmatter.triggers).toEqual([]);
    expect(parsed.frontmatter.request_routing).toEqual([
      {
        priority: 100,
        target_workflow: 'documentation-update',
        patterns: ['create documentation'],
      },
    ]);
  });
});

describe('SkillFrontmatterParser metadata placement', () => {
  const parser = new SkillFrontmatterParser();
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    clearSkillMetadataDeprecations();
  });

  const OLD = `---
name: drafting-notes
description: Drafts notes.
model_tier: fast
cacheable: true
output_format: markdown
triggers:
  - workflow: [feature-development]
input_schema:
  request:
    type: string
    required: true
---
Body
`;

  const NEW = `---
name: drafting-notes
description: Drafts notes.
metadata:
  model_tier: fast
  cacheable: 'true'
  output_format: markdown
  paqad-meta: skill.meta.yaml
---
Body
`;

  const META = `triggers:
  - workflow: [feature-development]
input_schema:
  request:
    type: string
    required: true
`;

  function folder(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), 'paqad-skill-meta-'));
    dirs.push(dir);
    for (const [rel, content] of Object.entries(files)) writeFileSync(join(dir, rel), content);
    return dir;
  }

  it('AC-4: resolves the new placement to the same object as the old top-level keys', () => {
    const old = parser.parse(OLD, folder({}));
    const moved = parser.parse(NEW, folder({ 'skill.meta.yaml': META }));
    expect(moved.frontmatter).toEqual(old.frontmatter);
    expect(moved.frontmatter.cacheable).toBe(true);
  });

  it('AC-34: still parses a user skill with the old top-level keys, recording one deprecation per key', () => {
    parser.parse(OLD, folder({}));
    parser.parse(OLD, folder({}));
    const lines = skillMetadataDeprecations();
    expect(lines.filter((line) => line.includes('"model_tier"'))).toHaveLength(1);
    expect(lines.every((line) => line.startsWith('Skill "drafting-notes"'))).toBe(true);
  });

  it('AC-5: a disagreeing top-level key loses to metadata with one deprecation line', () => {
    const both = NEW.replace('metadata:\n', 'model_tier: reasoning\nmetadata:\n');
    const parsed = parser.parse(both, folder({ 'skill.meta.yaml': META }));
    expect(parsed.frontmatter.model_tier).toBe('fast');
    const lines = skillMetadataDeprecations().filter((line) => line.includes('disagrees'));
    expect(lines).toEqual([
      'Skill "drafting-notes": top-level "model_tier" disagrees with its metadata value; the metadata value wins. Remove the top-level key.',
    ]);
  });

  it('AC-5: a missing or malformed skill.meta.yaml fails naming the skill and the file', () => {
    expect(() => parser.parse(NEW, folder({}))).toThrowError(
      /Skill "drafting-notes": skill\.meta\.yaml named by metadata\.paqad-meta is missing/u,
    );
    expect(() => parser.parse(NEW, folder({ 'skill.meta.yaml': 'triggers: [\n' }))).toThrowError(
      /Skill "drafting-notes": skill\.meta\.yaml is not valid YAML/u,
    );
    expect(() => parser.parse(NEW, folder({ 'skill.meta.yaml': '- a\n' }))).toThrowError(
      /Skill "drafting-notes": skill\.meta\.yaml must be a YAML object/u,
    );
  });

  it('AC-6: refuses an absolute, parent or outside-symlink paqad-meta', () => {
    const outside = folder({ 'skill.meta.yaml': META });
    for (const ref of ['/etc/skill.meta.yaml', '../skill.meta.yaml', 'a/../../x.yaml']) {
      expect(() => parser.parse(NEW.replace('skill.meta.yaml', ref), outside)).toThrowError(
        /Skill "drafting-notes": .*inside the skill folder/u,
      );
    }
    const dir = folder({});
    symlinkSync(join(outside, 'skill.meta.yaml'), join(dir, 'skill.meta.yaml'));
    expect(() => parser.parse(NEW, dir)).toThrowError(
      /Skill "drafting-notes": skill\.meta\.yaml is a symlink that leads outside the skill folder/u,
    );
  });

  it('sees request_routing in the sidecar for the workflow router', () => {
    const routed =
      'request_routing:\n  - priority: 1\n    patterns: [hello]\n    target_workflow: feature-development\n';
    expect(skillDeclaresRequestRouting(NEW, folder({ 'skill.meta.yaml': routed }))).toBe(true);
    expect(skillDeclaresRequestRouting(NEW, folder({ 'skill.meta.yaml': META }))).toBe(false);
    expect(skillDeclaresRequestRouting(`---\nname: x\nrequest_routing: []\n---\n`)).toBe(true);
  });
});
