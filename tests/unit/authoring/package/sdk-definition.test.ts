import { describe, expect, it } from 'vitest';

import { parseAgentSource, renderProducedAgent } from '@/authoring/package/agent-render.js';
import {
  SDK_DEFINITION_FIELDS,
  buildAgentDefinition,
  sdkRunOptions,
  uncarriedRules,
} from '@/authoring/package/sdk-definition.js';
import { splitSkillFrontmatter } from '@/skills/frontmatter-parser.js';

const SOURCE = `---
name: test-runner
description: Dispatched by the development stage to run the project tests and report failures.
tools: Read, Bash
disallowedTools: Write
model: sonnet
effort: medium
maxTurns: 15
skills: [expert-notes]
memory: project
isolation: worktree
hooks:
  PreToolUse:
    - matcher: Bash
      hooks:
        - type: command
          command: node .claude/hooks/no-push.mjs
---

## Objective

Run the tests.
`;

describe('buildAgentDefinition', () => {
  it('AC-36: carries only the SDK fields and never maxBudgetUsd, hooks or isolation', () => {
    const definition = buildAgentDefinition(parseAgentSource(SOURCE));
    expect(
      Object.keys(definition).every((key) =>
        (SDK_DEFINITION_FIELDS as readonly string[]).includes(key),
      ),
    ).toBe(true);
    expect(definition).toEqual({
      description:
        'Dispatched by the development stage to run the project tests and report failures.',
      prompt: '## Objective\n\nRun the tests.\n',
      tools: ['Read', 'Bash'],
      disallowedTools: ['Write'],
      model: 'sonnet',
      skills: ['expert-notes'],
      memory: 'project',
      maxTurns: 15,
      effort: 'medium',
    });
    expect(JSON.stringify(definition)).not.toContain('maxBudgetUsd');
  });

  it('leaves out fields the source does not set', () => {
    expect(
      buildAgentDefinition(parseAgentSource('---\nname: a\ndescription: d\n---\nP\n')),
    ).toEqual({ description: 'd', prompt: 'P\n' });
  });
});

describe('sdkRunOptions', () => {
  it('puts the spend cap in the run options', () => {
    expect(sdkRunOptions({ authoring_run_max_cost_usd: 5 })).toEqual({ maxBudgetUsd: 5 });
  });
});

describe('uncarriedRules', () => {
  it('AC-36: lists every rule enforced only by a hook or isolation', () => {
    expect(uncarriedRules(parseAgentSource(SOURCE))).toEqual([
      'hook PreToolUse (Bash): node .claude/hooks/no-push.mjs is enforced by a hook the SDK form cannot carry',
      'isolation: worktree cannot travel in the SDK form',
    ]);
  });

  it('skips malformed hook entries and names a permission mode', () => {
    const source = parseAgentSource(
      '---\nname: a\ndescription: d\npermissionMode: acceptEdits\nhooks:\n  Stop: nope\n  PreToolUse:\n    - hooks:\n        - type: command\n          command: node x.mjs\n        - type: prompt\n---\nP\n',
    );
    expect(uncarriedRules(source)).toEqual([
      'hook PreToolUse (*): node x.mjs is enforced by a hook the SDK form cannot carry',
      'permissionMode: acceptEdits cannot travel in the SDK form',
    ]);
  });
});

describe('the three forms of one agent', () => {
  it('AC-62: Claude Code, Codex and the AgentDefinition carry the same tools, model and prompt or a recorded omission', () => {
    const source = parseAgentSource(SOURCE);
    const claude = renderProducedAgent(source, 'claude-code');
    const codex = renderProducedAgent(source, 'codex-cli');
    const definition = buildAgentDefinition(source);
    const split = splitSkillFrontmatter(claude.content);
    expect(split.ok).toBe(true);
    if (!split.ok) return;
    expect(String(split.data.tools).split(', ')).toEqual(definition.tools);
    expect(split.data.model).toBe(definition.model);
    expect(split.body.replace(/^\n/u, '')).toBe(definition.prompt);
    expect(codex.host_notes).toContain(
      'model omitted: sonnet is a Claude Code model, so the Codex agent inherits the parent model',
    );
    expect(codex.content).toContain(definition.prompt);
    expect(codex.host_notes).toContain('tools omitted: Codex has no documented field for it');
  });
});
