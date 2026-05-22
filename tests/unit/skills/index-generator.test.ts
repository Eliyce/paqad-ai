import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { writeSkillIndexFromArtifacts } from '@/skills/index.js';
import { buildSkillIndex, generateSkillIndex, selectModelForTier } from '@/skills/index.js';

describe('skill index generation', () => {
  it('maps model tiers to project models in the generated index', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-skill-index-'));
    const skillDir = join(root, 'request-classifier');
    const skillFile = join(skillDir, 'SKILL.md');

    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      skillFile,
      `---
name: request-classifier
description: Routes requests
model_tier: deep
triggers:
  - workflow: [feature-development]
cacheable: true
cache_key_inputs:
  - request_text
output_format: yaml
input_schema:
  request_text:
    type: string
    required: true
    description: Request text
---

Body.
`,
    );

    const [entry] = await buildSkillIndex(
      {
        model_routing: {
          default_model: 'gpt-5',
          reasoning_model: 'gpt-5.1',
          fast_model: 'gpt-5-mini',
        },
      },
      [skillFile],
      root,
    );

    expect(entry).toMatchObject({
      name: 'request-classifier',
      model_tier: 'reasoning',
      resolved_model: 'gpt-5.1',
      output_format: 'yaml',
      file: 'request-classifier/SKILL.md',
    });
  });

  it('discovers skills from roots with generateSkillIndex', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-skill-index-root-'));
    const alphaDir = join(root, 'alpha');
    const betaDir = join(root, 'beta');

    mkdirSync(alphaDir, { recursive: true });
    mkdirSync(betaDir, { recursive: true });

    writeFileSync(
      join(alphaDir, 'SKILL.md'),
      `---
name: alpha
description: Alpha
model_tier: fast
triggers:
  - workflow: [feature-development]
cacheable: true
cache_key_inputs: [request_text]
output_format: markdown
input_schema:
  request_text:
    type: string
    required: true
    description: Request
---

Body.
`,
    );

    writeFileSync(
      join(betaDir, 'SKILL.md'),
      `---
name: beta
description: Beta
model_tier: medium
triggers:
  - workflow: [feature-development]
cacheable: false
cache_key_inputs: []
output_format: json
input_schema:
  changed_files:
    type: path[]
    required: true
    description: Files
---

Body.
`,
    );

    const index = await generateSkillIndex(
      {
        model_routing: {
          default_model: 'default-model',
          reasoning_model: 'reasoning-model',
          fast_model: 'fast-model',
        },
      },
      [root],
      root,
    );

    expect(index.map((entry) => entry.name)).toEqual(['alpha', 'beta']);
    expect(index[0]?.resolved_model).toBe('fast-model');
    expect(index[1]?.resolved_model).toBe('default-model');
  });

  it('writes the skill index from resolved artifacts', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-skill-index-write-'));
    const skillDir = join(root, 'gamma');
    mkdirSync(join(root, '.paqad'), { recursive: true });
    mkdirSync(skillDir, { recursive: true });

    const skillFile = join(skillDir, 'SKILL.md');
    writeFileSync(
      skillFile,
      `---
name: gamma
description: Gamma
model_tier: reasoning
triggers:
  - risk: [high]
cacheable: false
cache_key_inputs: []
output_format: markdown
input_schema:
  request_text:
    type: string
    required: true
    description: Request
---

Body.
`,
    );

    const path = await writeSkillIndexFromArtifacts(
      root,
      {
        model_routing: {
          default_model: 'default-model',
          reasoning_model: 'reasoning-model',
          fast_model: 'fast-model',
        },
      },
      [
        {
          path: skillFile,
          level: 1,
          source: 'gamma/SKILL.md',
        },
      ],
    );

    expect(path).toBe('.paqad/skill-index.json');
    expect(existsSync(join(root, path))).toBe(true);
    expect(JSON.parse(readFileSync(join(root, path), 'utf8'))).toMatchObject([
      {
        name: 'gamma',
        resolved_model: 'reasoning-model',
      },
    ]);
  });
});

describe('selectModelForTier', () => {
  const profile = {
    model_routing: {
      default_model: 'default-model',
      reasoning_model: 'reasoning-model',
      fast_model: 'fast-model',
    },
  };

  it('returns the fast model for fast skills', () => {
    expect(selectModelForTier(profile, 'fast')).toBe('fast-model');
  });

  it('returns the default model for medium skills', () => {
    expect(selectModelForTier(profile, 'medium')).toBe('default-model');
  });

  it('returns the reasoning model for reasoning skills', () => {
    expect(selectModelForTier(profile, 'reasoning')).toBe('reasoning-model');
  });
});
