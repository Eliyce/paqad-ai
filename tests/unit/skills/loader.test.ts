import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PATHS } from '@/core/constants/paths.js';
import {
  SkillAuditBuffer,
  type SkillLoadFailedEvent,
  readSkillAuditEvents,
} from '@/skills/audit-events.js';
import { SkillLoader } from '@/skills/loader.js';

import { fixtureResolvedArtifact } from './shared.fixture.js';

/**
 * A malformed SKILL.md is now excluded (not thrown) and recorded as a
 * `skill.load_failed` audit event (PQD-194). This drives an injected buffer so
 * the assertion is deterministic and needs no disk.
 */
async function expectLoadFailure(skillFile: string, expectedCode: string): Promise<void> {
  const buffer = new SkillAuditBuffer();
  const skills = await new SkillLoader(buffer).load([fixtureResolvedArtifact(skillFile)]);

  expect(skills).toEqual([]);
  expect(buffer.snapshot()).toHaveLength(1);
  const [event] = buffer.snapshot() as SkillLoadFailedEvent[];
  expect(event.type).toBe('skill.load_failed');
  expect(event.path).toBe(skillFile);
  expect(event.skill_id).toBeNull();
  expect(event.validation_error_code).toBe(expectedCode);
  expect(event.message).toBeTruthy();
  expect(event.content_hash).toMatch(/^[a-f0-9]{64}$/u);
}

describe('SkillLoader', () => {
  it('parses valid SKILL.md frontmatter', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-skills-'));
    const skillFile = join(root, 'database-design-review.SKILL.md');
    writeFileSync(
      skillFile,
      `---
name: database-design-review
description: Reviews schema changes
model_tier: deep
triggers:
  - database_impact: [schema-change, data-migration]
cacheable: true
cache_key_inputs:
  - "database/migrations/**"
output_format: markdown
input_schema:
  schema_paths:
    type: path[]
    required: true
    description: Schema paths
on_complete:
  emit: review_ready
  triggers:
    - router
---

Review the schema docs before changes.
`,
    );

    const [skill] = await new SkillLoader().load([fixtureResolvedArtifact(skillFile)]);
    expect(skill?.name).toBe('database-design-review');
    expect(skill?.model_tier).toBe('reasoning');
    expect(skill?.cacheable).toBe(true);
    expect(skill?.output_format).toBe('markdown');
    expect(skill?.input_schema.schema_paths?.type).toBe('path[]');
    expect(skill?.on_complete?.emit).toBe('review_ready');
    expect(skill?.triggers).toEqual([{ database_impact: ['schema-change', 'data-migration'] }]);
  });

  it('rejects SKILL.md over 300 lines', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-skills-'));
    const skillFile = join(root, 'too-long.SKILL.md');
    const body = Array.from({ length: 299 }, (_, index) => `line ${index + 1}`).join('\n');
    writeFileSync(
      skillFile,
      `---
name: too-long
description: Too long
model_tier: medium
triggers:
  - workflow: [feature-development]
cacheable: false
cache_key_inputs:
  - "docs/**"
output_format: markdown
input_schema:
  request_text:
    type: string
    required: true
    description: Request text
---
${body}
`,
    );

    await expectLoadFailure(skillFile, 'SKILL_LINE_LIMIT_EXCEEDED');
  });

  it('rejects SKILL.md without model_tier', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-skills-'));
    const skillFile = join(root, 'missing-model.SKILL.md');
    writeFileSync(
      skillFile,
      `---
name: missing-model
description: Broken skill
triggers:
  - workflow: [feature-development]
cacheable: true
cache_key_inputs:
  - "docs/**"
output_format: markdown
input_schema:
  request_text:
    type: string
    required: true
    description: Request text
---

Broken.
`,
    );

    await expectLoadFailure(skillFile, 'SKILL_FIELD_INVALID:model_tier');
  });

  it('loads skills from resolved artifacts', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-skills-'));
    const firstSkill = join(root, 'alpha.SKILL.md');
    const secondSkill = join(root, 'beta.SKILL.md');

    writeFileSync(
      firstSkill,
      `---
name: alpha
description: Alpha skill
model_tier: fast
triggers:
  - workflow: [feature-development]
cacheable: false
cache_key_inputs:
  - "docs/**"
output_format: markdown
input_schema:
  request_text:
    type: string
    required: true
    description: Request text
---

Alpha body.
`,
    );

    writeFileSync(
      secondSkill,
      `---
name: beta
description: Beta skill
model_tier: medium
triggers:
  - domain: [coding]
cacheable: true
cache_key_inputs:
  - "src/**"
output_format: json
input_schema:
  changed_files:
    type: path[]
    required: true
    description: Changed files
---

Beta body.
`,
    );

    const skills = await new SkillLoader().load([
      fixtureResolvedArtifact(secondSkill),
      fixtureResolvedArtifact(firstSkill),
    ]);

    expect(skills.map((skill) => skill.name)).toEqual(['alpha', 'beta']);
  });

  it('excludes only the malformed file and still loads the valid skills', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-skills-'));
    const projectRoot = join(root, 'project');
    mkdirSync(projectRoot, { recursive: true });
    const validSkill = join(root, 'valid.SKILL.md');
    const brokenSkill = join(root, 'broken.SKILL.md');

    writeFileSync(
      validSkill,
      `---
name: valid
description: Valid skill
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
    description: Request text
---

Valid body.
`,
    );
    writeFileSync(brokenSkill, `---\nname: broken\n---\n\nNo required fields.\n`);

    const skills = await new SkillLoader().load(
      [fixtureResolvedArtifact(validSkill), fixtureResolvedArtifact(brokenSkill)],
      projectRoot,
    );

    expect(skills.map((skill) => skill.name)).toEqual(['valid']);

    const events = readSkillAuditEvents(projectRoot) as SkillLoadFailedEvent[];
    expect(events).toHaveLength(1);
    expect(events[0]?.path).toBe(brokenSkill);
    expect(events[0]?.type).toBe('skill.load_failed');
  });

  it('writes the failure event to disk when a projectRoot is supplied', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-skills-'));
    const projectRoot = join(root, 'project');
    mkdirSync(projectRoot, { recursive: true });
    const brokenSkill = join(root, 'broken.SKILL.md');
    writeFileSync(brokenSkill, `---\nname: broken\n---\n\nNo required fields.\n`);

    await new SkillLoader().load([fixtureResolvedArtifact(brokenSkill)], projectRoot);

    const logPath = join(projectRoot, PATHS.SKILL_AUDIT_EVENTS_LOG);
    const raw = readFileSync(logPath, 'utf8').trim();
    expect(raw.split('\n')).toHaveLength(1);
    expect(JSON.parse(raw)).toMatchObject({ type: 'skill.load_failed', path: brokenSkill });
  });

  it('produces a stable content hash for the same unchanged malformed file', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-skills-'));
    const brokenSkill = join(root, 'broken.SKILL.md');
    writeFileSync(brokenSkill, `---\nname: broken\n---\n\nNo required fields.\n`);

    const firstBuffer = new SkillAuditBuffer();
    await new SkillLoader(firstBuffer).load([fixtureResolvedArtifact(brokenSkill)]);
    const secondBuffer = new SkillAuditBuffer();
    await new SkillLoader(secondBuffer).load([fixtureResolvedArtifact(brokenSkill)]);

    const [first] = firstBuffer.snapshot() as SkillLoadFailedEvent[];
    const [second] = secondBuffer.snapshot() as SkillLoadFailedEvent[];
    expect(first.content_hash).toBe(second.content_hash);
  });

  it('re-emits no event and loads the skill after the malformed file is fixed', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-skills-'));
    const skillFile = join(root, 'will-be-fixed.SKILL.md');
    writeFileSync(skillFile, `---\nname: will-be-fixed\n---\n\nBroken first.\n`);

    const firstBuffer = new SkillAuditBuffer();
    const firstPass = await new SkillLoader(firstBuffer).load([fixtureResolvedArtifact(skillFile)]);
    expect(firstPass).toEqual([]);
    expect(firstBuffer.snapshot()).toHaveLength(1);

    writeFileSync(
      skillFile,
      `---
name: will-be-fixed
description: Now valid
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
    description: Request text
---

Fixed body.
`,
    );

    const secondBuffer = new SkillAuditBuffer();
    const secondPass = await new SkillLoader(secondBuffer).load([
      fixtureResolvedArtifact(skillFile),
    ]);
    expect(secondPass.map((skill) => skill.name)).toEqual(['will-be-fixed']);
    expect(secondBuffer.snapshot()).toEqual([]);
  });

  it('sorts same-name skills by file path as a tie-breaker', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-skills-'));
    const firstDir = join(root, 'a');
    const secondDir = join(root, 'b');
    const firstSkill = join(firstDir, 'SKILL.md');
    const secondSkill = join(secondDir, 'SKILL.md');

    mkdirSync(firstDir, { recursive: true });
    mkdirSync(secondDir, { recursive: true });

    const content = `---
name: shared
description: Shared skill
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
    description: Request text
---

Shared body.
`;

    writeFileSync(firstSkill, content);
    writeFileSync(secondSkill, content);

    const skills = await new SkillLoader().load([
      fixtureResolvedArtifact(secondSkill),
      fixtureResolvedArtifact(firstSkill),
    ]);

    expect(skills.map((skill) => skill.file)).toEqual([firstSkill, secondSkill]);
  });

  it('ignores bundled non-SKILL artifacts when loading definitions', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-skills-'));
    const skillDir = join(root, 'request-classifier');
    const skillFile = join(skillDir, 'SKILL.md');
    const referenceFile = join(skillDir, 'references', 'decision-rules.md');
    const agentFile = join(skillDir, 'agents', 'openai.yaml');

    mkdirSync(join(skillDir, 'references'), { recursive: true });
    mkdirSync(join(skillDir, 'agents'), { recursive: true });

    writeFileSync(
      skillFile,
      `---
name: request-classifier
description: Routes requests
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
    description: Request text
---

## What It Does

Routes work.
`,
    );
    writeFileSync(referenceFile, '# Decision Rules\n');
    writeFileSync(agentFile, 'interface:\n  display_name: "Request Classifier"\n');

    const skills = await new SkillLoader().load([
      fixtureResolvedArtifact(referenceFile),
      fixtureResolvedArtifact(skillFile),
      fixtureResolvedArtifact(agentFile),
    ]);

    expect(skills).toHaveLength(1);
    expect(skills[0]?.name).toBe('request-classifier');
  });

  it('normalizes legacy standard tier to medium', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-skills-'));
    const skillFile = join(root, 'legacy-standard.SKILL.md');

    writeFileSync(
      skillFile,
      `---
name: legacy-standard
description: Legacy standard tier
model_tier: standard
triggers:
  - workflow: [feature-development]
cacheable: false
cache_key_inputs: []
output_format: markdown
input_schema:
  request_text:
    type: string
    required: true
    description: Request text
---

Body.
`,
    );

    const [skill] = await new SkillLoader().load([fixtureResolvedArtifact(skillFile)]);
    expect(skill?.model_tier).toBe('medium');
  });

  it('rejects malformed input_schema field definitions', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-skills-'));
    const skillFile = join(root, 'bad-input-schema.SKILL.md');

    writeFileSync(
      skillFile,
      `---
name: bad-input-schema
description: Broken skill
model_tier: fast
triggers:
  - workflow: [feature-development]
cacheable: false
cache_key_inputs: []
output_format: markdown
input_schema:
  request_text: nope
---

Body.
`,
    );

    await expectLoadFailure(skillFile, 'SKILL_FIELD_INVALID:input_schema.request_text');
  });

  it('rejects invalid input_schema field types', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-skills-'));
    const skillFile = join(root, 'bad-input-type.SKILL.md');

    writeFileSync(
      skillFile,
      `---
name: bad-input-type
description: Broken skill
model_tier: fast
triggers:
  - workflow: [feature-development]
cacheable: false
cache_key_inputs: []
output_format: markdown
input_schema:
  request_text:
    type: invalid
    required: true
---

Body.
`,
    );

    await expectLoadFailure(skillFile, 'SKILL_FIELD_INVALID:input_schema.request_text.type');
  });

  it('rejects empty input_schema objects', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-skills-'));
    const skillFile = join(root, 'empty-input-schema.SKILL.md');

    writeFileSync(
      skillFile,
      `---
name: empty-input-schema
description: Broken skill
model_tier: fast
triggers:
  - workflow: [feature-development]
cacheable: false
cache_key_inputs: []
output_format: markdown
input_schema: {}
---

Body.
`,
    );

    await expectLoadFailure(skillFile, 'SKILL_FIELD_INVALID:input_schema');
  });

  it('rejects malformed on_complete blocks', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-skills-'));
    const skillFile = join(root, 'bad-on-complete.SKILL.md');

    writeFileSync(
      skillFile,
      `---
name: bad-on-complete
description: Broken skill
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
on_complete: nope
---

Body.
`,
    );

    await expectLoadFailure(skillFile, 'SKILL_FIELD_INVALID:on_complete');
  });
});
