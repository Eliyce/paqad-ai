import { describe, expect, it } from 'vitest';

import { ValidationError } from '@/core/errors/index.js';
import { SkillFrontmatterParser } from '@/skills/frontmatter-parser.js';

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
