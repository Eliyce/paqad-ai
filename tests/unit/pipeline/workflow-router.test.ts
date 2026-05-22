import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { WorkflowRouterService } from '@/pipeline/workflow-router.js';

function writeSkill(root: string, relativePath: string, frontmatter: string): void {
  const target = join(root, relativePath);
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, `---\n${frontmatter}\n---\nBody.\n`);
}

describe('WorkflowRouterService', () => {
  it('matches built-in documentation routes with typo tolerance', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'paqad-workflow-router-'));
    const runtimeRoot = mkdtempSync(join(tmpdir(), 'paqad-runtime-'));
    writeSkill(
      runtimeRoot,
      'base/skills/workflow-router/SKILL.md',
      `name: workflow-router
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
    required: true`,
    );

    const result = await new WorkflowRouterService({ projectRoot, runtimeRoot }).resolve(
      'lets created documenation for this app',
    );

    expect(result.workflow).toBe('documentation-update');
    expect(result.workflow_source).toBe('routing-skill');
    expect(result.matched_rule).toBe('create documentation');
  });

  it('prefers more specific pentest-retest rules over generic pentest rules', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'paqad-workflow-router-'));
    const runtimeRoot = mkdtempSync(join(tmpdir(), 'paqad-runtime-'));
    writeSkill(
      runtimeRoot,
      'base/skills/workflow-router/SKILL.md',
      `name: workflow-router
description: Route requests
model_tier: fast
request_routing:
  - priority: 100
    target_workflow: pentest
    patterns:
      - pentest
  - priority: 100
    target_workflow: pentest-retest
    patterns:
      - pentest retest
cacheable: true
cache_key_inputs: [request_text]
output_format: yaml
input_schema:
  request_text:
    type: string
    required: true`,
    );

    const result = await new WorkflowRouterService({ projectRoot, runtimeRoot }).resolve(
      'please run a pentest retest for billing',
    );

    expect(result.workflow).toBe('pentest-retest');
    expect(result.matched_rule).toBe('pentest retest');
  });

  it('lets project-owned workflow-router skills override framework defaults', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'paqad-workflow-router-'));
    const runtimeRoot = mkdtempSync(join(tmpdir(), 'paqad-runtime-'));
    writeSkill(
      runtimeRoot,
      'base/skills/workflow-router/SKILL.md',
      `name: workflow-router
description: Route requests
model_tier: fast
request_routing:
  - priority: 100
    target_workflow: feature-development
    patterns:
      - build dashboard
cacheable: true
cache_key_inputs: [request_text]
output_format: yaml
input_schema:
  request_text:
    type: string
    required: true`,
    );
    writeSkill(
      projectRoot,
      '.codex/skills/workflow-router/SKILL.md',
      `name: workflow-router
description: Route requests
model_tier: fast
request_routing:
  - priority: 100
    target_workflow: documentation-update
    patterns:
      - build dashboard
cacheable: true
cache_key_inputs: [request_text]
output_format: yaml
input_schema:
  request_text:
    type: string
    required: true`,
    );

    const result = await new WorkflowRouterService({ projectRoot, runtimeRoot }).resolve(
      'build dashboard',
    );

    expect(result.workflow).toBe('documentation-update');
  });

  it('returns an explicit no-match result when no rule matches', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'paqad-workflow-router-'));
    const runtimeRoot = mkdtempSync(join(tmpdir(), 'paqad-runtime-'));
    writeSkill(
      runtimeRoot,
      'base/skills/workflow-router/SKILL.md',
      `name: workflow-router
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
    required: true`,
    );

    const result = await new WorkflowRouterService({ projectRoot, runtimeRoot }).resolve(
      'something unrelated and unmatched',
    );

    expect(result.workflow).toBeNull();
    expect(result.workflow_source).toBe('none');
  });

  it('rejects invalid workflow targets from routing skills', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'paqad-workflow-router-'));
    const runtimeRoot = mkdtempSync(join(tmpdir(), 'paqad-runtime-'));
    writeSkill(
      runtimeRoot,
      'base/skills/workflow-router/SKILL.md',
      `name: workflow-router
description: Route requests
model_tier: fast
request_routing:
  - priority: 100
    target_workflow: documentaiton-update
    patterns:
      - create documentation
cacheable: true
cache_key_inputs: [request_text]
output_format: yaml
input_schema:
  request_text:
    type: string
    required: true`,
    );

    await expect(
      new WorkflowRouterService({ projectRoot, runtimeRoot }).resolve('create documentation'),
    ).rejects.toThrow('target_workflow');
  });

  it('skips skills without request_routing without fully parsing them', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'paqad-workflow-router-'));
    const runtimeRoot = mkdtempSync(join(tmpdir(), 'paqad-runtime-'));

    // Write a routing skill
    writeSkill(
      runtimeRoot,
      'base/skills/workflow-router/SKILL.md',
      `name: workflow-router
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
    required: true`,
    );

    // Write a non-routing skill (no request_routing field)
    writeSkill(
      runtimeRoot,
      'base/skills/scope-check/SKILL.md',
      `name: scope-check
description: Scope check
model_tier: fast
triggers:
  - workflow: [feature-development]
cacheable: false
cache_key_inputs: []
output_format: markdown
input_schema:
  request_text:
    type: string
    required: true`,
    );

    const result = await new WorkflowRouterService({ projectRoot, runtimeRoot }).resolve(
      'create documentation',
    );

    expect(result.workflow).toBe('documentation-update');
  });

  it('skips skills with no frontmatter boundary when checking for routing', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'paqad-workflow-router-'));
    const runtimeRoot = mkdtempSync(join(tmpdir(), 'paqad-runtime-'));

    // A routing skill that works
    writeSkill(
      runtimeRoot,
      'base/skills/workflow-router/SKILL.md',
      `name: workflow-router
description: Route requests
model_tier: fast
request_routing:
  - priority: 100
    target_workflow: feature-development
    patterns:
      - build feature
cacheable: true
cache_key_inputs: [request_text]
output_format: yaml
input_schema:
  request_text:
    type: string
    required: true`,
    );

    // A malformed file with no frontmatter (not starting with ---)
    const malformedPath = join(runtimeRoot, 'base/skills/broken/SKILL.md');
    mkdirSync(join(runtimeRoot, 'base/skills/broken'), { recursive: true });
    writeFileSync(malformedPath, '# No frontmatter here\nSome content.\n');

    const result = await new WorkflowRouterService({ projectRoot, runtimeRoot }).resolve(
      'build feature',
    );

    // The malformed file is skipped gracefully (no routing field found)
    expect(result.workflow).toBe('feature-development');
  });

  it('skips skills with unclosed frontmatter when checking for routing', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'paqad-workflow-router-'));
    const runtimeRoot = mkdtempSync(join(tmpdir(), 'paqad-runtime-'));

    writeSkill(
      runtimeRoot,
      'base/skills/workflow-router/SKILL.md',
      `name: workflow-router
description: Route requests
model_tier: fast
request_routing:
  - priority: 100
    target_workflow: feature-development
    patterns:
      - build feature
cacheable: true
cache_key_inputs: [request_text]
output_format: yaml
input_schema:
  request_text:
    type: string
    required: true`,
    );

    // A file that starts with --- but has no closing ---
    const unclosedPath = join(runtimeRoot, 'base/skills/unclosed/SKILL.md');
    mkdirSync(join(runtimeRoot, 'base/skills/unclosed'), { recursive: true });
    writeFileSync(unclosedPath, '---\nname: unclosed\nno closing boundary\n');

    const result = await new WorkflowRouterService({ projectRoot, runtimeRoot }).resolve(
      'build feature',
    );

    // The unclosed-frontmatter file is skipped gracefully
    expect(result.workflow).toBe('feature-development');
  });

  it('does not parse the full skill body when request_routing is absent from frontmatter', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'paqad-workflow-router-'));
    const runtimeRoot = mkdtempSync(join(tmpdir(), 'paqad-runtime-'));

    writeSkill(
      runtimeRoot,
      'base/skills/workflow-router/SKILL.md',
      `name: workflow-router
description: Route requests
model_tier: fast
request_routing:
  - priority: 100
    target_workflow: documentation-update
    patterns:
      - write docs
cacheable: true
cache_key_inputs: [request_text]
output_format: yaml
input_schema:
  request_text:
    type: string
    required: true`,
    );

    // A skill without request_routing - even if its body were malformed, routing should still work
    const noRoutingPath = join(runtimeRoot, 'base/skills/no-routing/SKILL.md');
    mkdirSync(join(runtimeRoot, 'base/skills/no-routing'), { recursive: true });
    writeFileSync(
      noRoutingPath,
      `---
name: no-routing
description: A skill without routing
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
---
Body content.
`,
    );

    const result = await new WorkflowRouterService({ projectRoot, runtimeRoot }).resolve(
      'write docs',
    );

    expect(result.workflow).toBe('documentation-update');
    expect(result.workflow_source).toBe('routing-skill');
  });
});
