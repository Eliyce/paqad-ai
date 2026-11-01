import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { AGENT_PERMISSION_ALLOW, raiseAgentPermissionDecision } from '@/authoring/decisions.js';
import {
  AgentLintUsageError,
  agentHookScripts,
  bodyHeadingOrderProblem,
  lintAgentFile,
  lintAgentInProject,
  permissionApproval,
  readPermissionDecisionIds,
  projectMcpServers,
  type AgentLintOptions,
} from '@/authoring/lint/agent-lint.js';
import type { InstalledArtifact } from '@/authoring/overlap.js';
import { resolvePendingDecision } from '@/decisions/authoring.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-agent-lint-'));
  roots.push(root);
  return root;
}

function put(root: string, rel: string, text: string): string {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text, 'utf8');
  return rel;
}

const DESCRIPTION =
  'Use this agent when a change adds a database migration. For example "review this migration" or "is this migration safe to run".';

interface Front {
  [key: string]: string | undefined;
}

function agent(front: Front = {}, body = BODY): string {
  const fields: Front = {
    name: 'migration-reviewer',
    description: `'${DESCRIPTION}'`,
    tools: 'Read, Grep, Glob',
    model: 'haiku',
    effort: 'low',
    maxTurns: '20',
    ...front,
  };
  const lines = Object.entries(fields)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([key, value]) => `${key}: ${value}`);
  return `---\n${lines.join('\n')}\n---\n\n${body}`;
}

const BODY = `## Objective

Review the migration the caller names and say whether it is safe to run.

## Procedure

1. Read the migration file.
2. Check it against the schema.

## Report

Keep the report under 500 tokens.

Status: DONE, DONE_WITH_CONCERNS, NEEDS_CONTEXT or BLOCKED

## Stop when

The migration has been read and judged.

## Do not

- Do not edit any file.

## Example

Input: <migration path>. Output: Status: DONE.
`;

function lint(root: string, text: string, options: Partial<AgentLintOptions> = {}) {
  const rel = put(root, '.claude/agents/migration-reviewer.md', text);
  return lintAgentFile(rel, {
    projectRoot: root,
    installedAgents: [],
    installedSkills: [],
    mcpServers: [],
    neverWrite: {
      schema_version: '1',
      phrases: ['in order to'],
      framework_phrases: 1,
      project_phrases: 0,
    },
    ...options,
  });
}

function rules(result: { findings: { rule: string }[] }): string[] {
  return result.findings.map((finding) => finding.rule);
}

describe('lintAgentFile', () => {
  it('passes a well-formed agent with no findings', () => {
    const result = lint(project(), agent());
    expect(result.findings).toEqual([]);
    expect(result.agent).toBe('migration-reviewer');
    expect(result.powers).toEqual([]);
    expect(result.file_hash).toMatch(/^sha256:/u);
  });

  it('refuses a rendered Codex TOML and a missing file with a usage error', () => {
    const root = project();
    put(root, '.codex/agents/x.toml', 'name = "x"\n');
    expect(() => lintAgentFile('.codex/agents/x.toml', { projectRoot: root })).toThrow(
      AgentLintUsageError,
    );
    expect(() => lintAgentFile('.claude/agents/none.md', { projectRoot: root })).toThrow(
      'is not a file',
    );
  });

  it('AG-001 for a file with no frontmatter, a missing name or a colon in it', () => {
    const root = project();
    expect(rules(lint(root, '# just text\n'))).toEqual(['AG-001']);
    expect(rules(lint(root, agent({ name: undefined })))).toContain('AG-001');
    expect(rules(lint(root, agent({ name: 'my:reviewer' })))).toContain('AG-001');
  });

  it('AG-002 warns on a name that is not object-role', () => {
    const result = lint(project(), agent({ name: 'migrations' }));
    expect(result.findings.find((finding) => finding.rule === 'AG-002')?.severity).toBe('warn');
    expect(rules(lint(project(), agent({ name: 'security-specialist' })))).not.toContain('AG-002');
  });

  it('AC-31: AG-003 gives the token count over 300 and clears when the limit is raised', () => {
    const root = project();
    const long = `'Use this agent when ${'x'.repeat(1200)}'`;
    const over = lint(root, agent({ description: long }));
    const finding = over.findings.find((entry) => entry.rule === 'AG-003');
    expect(finding?.message).toContain('is 305 tokens, over the limit of 300');
    expect(
      rules(lint(root, agent({ description: long }), { limits: { descriptionMaxTokens: 400 } })),
    ).not.toContain('AG-003');
  });

  it('AG-003 at exactly 300 tokens passes and 301 fails', () => {
    const root = project();
    const exact = 'Use this agent when '.padEnd(1200, 'y');
    const plusOne = 'Use this agent when '.padEnd(1201, 'y');
    expect(rules(lint(root, agent({ description: `'${exact}'` })))).not.toContain('AG-003');
    expect(rules(lint(root, agent({ description: `'${plusOne}'` })))).toContain('AG-003');
  });

  it('AG-003 checks the opening for auto agents and the dispatcher for dispatched agents', () => {
    const root = project();
    const dispatched = "'Runs the checks stage. Dispatched by the paqad orchestrator only.'";
    expect(rules(lint(root, agent({ description: undefined })))).toContain('AG-003');
    expect(rules(lint(root, agent({ description: dispatched }), { invocation: 'auto' }))).toContain(
      'AG-003',
    );
    expect(rules(lint(root, agent(), { invocation: 'dispatched' }))).toContain('AG-003');
    expect(
      rules(lint(root, agent({ description: dispatched }), { invocation: 'dispatched' })),
    ).not.toContain('AG-003');
    expect(rules(lint(root, agent({ description: "'Reviews migrations.'" })))).toContain('AG-003');
  });

  it('AC-3: AG-004 names the agents by descending size when the catalog is over budget', () => {
    const installed: InstalledArtifact[] = [
      {
        kind: 'agent',
        name: 'small',
        description: 'a'.repeat(400),
        path: 's.md',
        scope: 'project',
      },
      { kind: 'agent', name: 'big', description: 'b'.repeat(4000), path: 'b.md', scope: 'project' },
    ];
    const result = lint(project(), agent(), {
      installedAgents: installed,
      limits: { catalogMaxTokens: 1000 },
    });
    const finding = result.findings.find((entry) => entry.rule === 'AG-004');
    expect(finding?.message).toMatch(
      /By size: big \(1000\), small \(100\), migration-reviewer \(\d+\)\./u,
    );
  });

  it('AC-4: AG-005 names a missing tool, skill or MCP server', () => {
    const result = lint(
      project(),
      agent({
        tools: 'Read, Telepathy, mcp__jira__search',
        skills: '[ghost-skill]',
        mcpServers: '[slack]',
      }),
      { installedSkills: ['expert-notes'], mcpServers: ['github'] },
    );
    const messages = result.findings
      .filter((entry) => entry.rule === 'AG-005')
      .map((entry) => entry.message);
    expect(messages).toEqual(
      expect.arrayContaining([
        'The tool Telepathy does not exist on the host.',
        'The tool mcp__jira__search names the MCP server jira, which is not configured.',
        'The skill ghost-skill is not installed.',
        'The MCP server slack is not configured.',
      ]),
    );
    expect(
      rules(
        lint(project(), agent({ skills: '[expert-notes]' }), { installedSkills: ['expert-notes'] }),
      ),
    ).not.toContain('AG-005');
  });

  it('reads the MCP servers from the project .mcp.json', () => {
    const root = project();
    expect(projectMcpServers(root)).toEqual([]);
    put(root, '.mcp.json', JSON.stringify({ mcpServers: { github: {}, jira: {} } }));
    expect(projectMcpServers(root)).toEqual(['github', 'jira']);
    put(root, '.mcp.json', '{not json');
    expect(projectMcpServers(root)).toEqual([]);
  });

  it('AG-006 for a model or effort the host does not know', () => {
    const root = project();
    expect(rules(lint(root, agent({ model: 'gpt-4' })))).toContain('AG-006');
    expect(rules(lint(root, agent({ effort: 'turbo' })))).toContain('AG-006');
    expect(rules(lint(root, agent({ model: 'claude-opus-5-5', effort: 'max' })))).not.toContain(
      'AG-006',
    );
  });

  it('AC-2: AG-007 and AG-008 name the missing field', () => {
    const root = project();
    const noTurns = lint(root, agent({ maxTurns: undefined }));
    expect(noTurns.findings.find((entry) => entry.rule === 'AG-007')?.message).toContain(
      'maxTurns is missing',
    );
    const noMax = lint(
      root,
      agent({}, BODY.replace('Keep the report under 500 tokens.', 'Keep it short.')),
    );
    expect(noMax.findings.find((entry) => entry.rule === 'AG-008')?.message).toBe(
      'The ## Report section states no maximum length in tokens.',
    );
    const noStatus = lint(
      root,
      agent(
        {},
        BODY.replace(
          'Status: DONE, DONE_WITH_CONCERNS, NEEDS_CONTEXT or BLOCKED',
          'Say how it went.',
        ),
      ),
    );
    expect(noStatus.findings.find((entry) => entry.rule === 'AG-008')?.message).toContain(
      'no Status line',
    );
    const noReport = lint(root, agent({}, BODY.replace('## Report', '## Output')));
    expect(noReport.findings.find((entry) => entry.rule === 'AG-008')?.message).toBe(
      'The body has no ## Report section.',
    );
    expect(rules(lint(root, agent({ maxTurns: '0' })))).toContain('AG-007');
  });

  it('AG-009 for more than 32 skills', () => {
    const skills = Array.from({ length: 33 }, (_, index) => `s${index}`);
    expect(
      rules(
        lint(project(), agent({ skills: `[${skills.join(', ')}]` }), { installedSkills: skills }),
      ),
    ).toContain('AG-009');
  });

  it('AG-010 for a MEMORY.md over the line limit', () => {
    const root = project();
    const memory = put(
      root,
      '.claude/agent-memory/migration-reviewer/MEMORY.md',
      'line\n'.repeat(201),
    );
    expect(rules(lint(root, agent(), { memoryFile: memory }))).toContain('AG-010');
    put(root, memory, 'line\n'.repeat(200));
    expect(rules(lint(root, agent(), { memoryFile: memory }))).not.toContain('AG-010');
    expect(rules(lint(root, agent(), { memoryFile: 'missing/MEMORY.md' }))).not.toContain('AG-010');
  });

  it('AG-011 for a missing hook script, an untested one, an inline command or a path outside the project', () => {
    const root = project();
    const hooks = (command: string) =>
      `\n  PreToolUse:\n    - matcher: Bash\n      hooks:\n        - type: command\n          command: ${command}`;
    const missing = lint(root, agent({ hooks: hooks('node .claude/hooks/guard.mjs') }));
    expect(missing.findings.map((entry) => entry.message)).toContain(
      'The hook script .claude/hooks/guard.mjs does not exist.',
    );
    put(root, '.claude/hooks/guard.mjs', 'process.exit(0);\n');
    const untested = lint(root, agent({ hooks: hooks('node .claude/hooks/guard.mjs') }));
    expect(untested.findings.find((entry) => entry.rule === 'AG-011')?.message).toContain(
      'has no test under tests/agents/migration-reviewer',
    );
    put(root, 'tests/agents/migration-reviewer/guard.test.mjs', 'test\n');
    expect(
      rules(lint(root, agent({ hooks: hooks('node .claude/hooks/guard.mjs') }))),
    ).not.toContain('AG-011');
    expect(rules(lint(root, agent({ hooks: hooks('"echo hi && rm -rf x"') })))).toContain('AG-011');
    expect(rules(lint(root, agent({ hooks: hooks('node ../outside.mjs') })))).toContain('AG-011');
    put(root, '.claude/hooks/plain.sh', 'exit 0\n');
    chmodSync(join(root, '.claude/hooks/plain.sh'), 0o644);
    put(root, 'tests/agents/migration-reviewer/plain.test.sh', 'x\n');
    const notExec = lint(root, agent({ hooks: hooks('.claude/hooks/plain.sh') }));
    expect(notExec.findings.find((entry) => entry.rule === 'AG-011')?.message).toContain(
      'is not executable',
    );
  });

  it('agentHookScripts resolves project-relative scripts and the project dir variable', () => {
    const root = project();
    const result = agentHookScripts(root, {
      PreToolUse: [
        {
          matcher: 'Bash',
          hooks: [{ type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/a.mjs"' }],
        },
        { hooks: [{ type: 'command', command: 'php hooks/b.php' }, { type: 'prompt' }] },
      ],
      Stop: 'not a list',
    });
    expect(result.scripts).toEqual(['.claude/hooks/a.mjs', 'hooks/b.php']);
    expect(result.problems).toEqual([]);
    expect(agentHookScripts(root, null).scripts).toEqual([]);
    expect(
      agentHookScripts(root, { Stop: [{ hooks: [{ command: 'node --version' }] }] }).problems,
    ).toHaveLength(1);
  });

  it('AC-33: AG-012 blocks a secret in the agent file or its brief template, masked', () => {
    const root = project();
    const brief = put(
      root,
      '.paqad/tmp/authoring/agents/migration-reviewer/brief-template.md',
      'token AKIAIOSFODNN7EXAMPLE\n',
    );
    const result = lint(root, agent(), { extraScanFiles: [brief] });
    const finding = result.findings.find((entry) => entry.rule === 'AG-012');
    expect(finding?.file).toBe(brief);
    expect(finding?.message).not.toContain('AKIAIOSFODNN7EXAMPLE');
  });

  it('AG-013 for an em dash in the file or its brief template', () => {
    const root = project();
    const brief = put(root, 'brief.md', 'one — two\n');
    expect(rules(lint(root, agent({}, `${BODY}\nA — B\n`)))).toContain('AG-013');
    expect(
      lint(root, agent(), { emDashFiles: [brief] }).findings.map((entry) => entry.file),
    ).toContain(brief);
  });

  it('AG-014 for a body over the prompt limit', () => {
    const result = lint(project(), agent({}, `${BODY}\n${'word '.repeat(2500)}\n`));
    expect(result.findings.find((entry) => entry.rule === 'AG-014')?.message).toMatch(
      /over the limit of 3000/u,
    );
  });

  it('AG-016 for the same name in another scope and AG-017 for a colliding description', () => {
    const installed: InstalledArtifact[] = [
      {
        kind: 'agent',
        name: 'migration-reviewer',
        description: 'other',
        path: '~/.claude/agents/migration-reviewer.md',
        scope: 'user',
      },
      {
        kind: 'agent',
        name: 'schema-reviewer',
        description: DESCRIPTION,
        path: '.claude/agents/schema-reviewer.md',
        scope: 'project',
      },
      {
        kind: 'agent',
        name: 'migration-reviewer',
        description: DESCRIPTION,
        path: '.claude/agents/migration-reviewer.md',
        scope: 'project',
      },
    ];
    const result = lint(project(), agent(), { installedAgents: installed });
    expect(result.findings.find((entry) => entry.rule === 'AG-016')?.message).toContain(
      'The name migration-reviewer is taken in another scope',
    );
    expect(result.findings.find((entry) => entry.rule === 'AG-017')?.message).toContain(
      'collides with schema-reviewer',
    );
  });

  it('AC-39: AG-018 names 11 tools and the definition token count', () => {
    const tools =
      'Read, Grep, Glob, Edit, Write, TodoWrite, LSP, Monitor, Skill, ToolSearch, NotebookEdit';
    const result = lint(project(), agent({ tools }));
    const finding = result.findings.find((entry) => entry.rule === 'AG-018');
    expect(finding?.message).toContain(
      `lists 11 tools (${tools}), about 5500 tokens of tool definitions (estimate)`,
    );
    expect(result.powers).toEqual(['tool-limit']);
  });

  it('AC-38 and AC-60: AG-019 fires on dynamic content with the line, not on a semver, an issue number or a field value', () => {
    const root = project();
    const ids = readFileSync(
      join(import.meta.dirname, '__fixtures__', 'agent-body-ids.md'),
      'utf8',
    );
    const clean = lint(root, agent({}, `${BODY}\n${ids}`));
    expect(rules(clean)).not.toContain('AG-019');
    for (const dynamic of [
      'On 2026-11-01 run it.',
      'At 10:30 run it.',
      'This is run #4.',
      'Use id 8f3a2b1c9d4e7f60.',
    ]) {
      const result = lint(root, agent({}, `${BODY}\n${dynamic}\n`));
      const finding = result.findings.find((entry) => entry.rule === 'AG-019');
      expect(finding, dynamic).toBeDefined();
      expect(finding!.line).toBe(
        agent({}, `${BODY}\n${dynamic}\n`).split('\n').indexOf(dynamic) + 1,
      );
    }
  });

  it('AG-020 for a never-write phrase or shouted words', () => {
    const root = project();
    expect(rules(lint(root, agent({}, `${BODY}\nRead it in order to judge it.\n`)))).toContain(
      'AG-020',
    );
    expect(rules(lint(root, agent({}, `${BODY}\nYou MUST read it.\n`)))).toContain('AG-020');
  });

  it('AG-021 warns on a Do not item no tool restriction or hook enforces', () => {
    const result = lint(
      project(),
      agent({}, BODY.replace('- Do not edit any file.', '- Do not guess the schema.')),
    );
    expect(result.findings.find((entry) => entry.rule === 'AG-021')?.severity).toBe('warn');
    const denied = lint(
      project(),
      agent(
        { tools: 'Read, Bash(npm test:*)', disallowedTools: 'WebFetch' },
        BODY.replace('- Do not edit any file.', '- Do not use WebFetch.'),
      ),
    );
    expect(rules(denied)).not.toContain('AG-021');
  });

  it('AC-33: AG-022 names WebFetch, an open Bash and install or delete commands', () => {
    const root = project();
    const result = lint(
      root,
      agent({ tools: 'Read, WebFetch, Bash, Bash(pnpm install:*), Bash(rm -rf dist:*)' }),
    );
    const messages = result.findings
      .filter((entry) => entry.rule === 'AG-022')
      .map((entry) => entry.message);
    expect(messages.join('\n')).toContain('The tool WebFetch gives the risky power WebFetch.');
    expect(messages.join('\n')).toContain('The tool Bash gives the risky power Bash.');
    expect(messages.join('\n')).toContain('gives the risky power install');
    expect(messages.join('\n')).toContain('gives the risky power delete');
    expect(rules(lint(root, agent({ tools: 'Read, Bash(*)' })))).toContain('AG-022');
    expect(rules(lint(root, agent({ tools: 'Read, Bash(npx foo)' })))).toContain('AG-022');
    expect(rules(lint(root, agent({ tools: 'Read, Bash(npm test:*)' })))).not.toContain('AG-022');
    expect(rules(lint(root, agent({ tools: undefined })))).toContain('AG-022');
  });

  it('an open Bash guarded by a blocking PreToolUse hook is not a risky power', () => {
    const root = project();
    put(root, '.claude/hooks/guard.mjs', 'x\n');
    put(root, 'tests/agents/migration-reviewer/guard.test.mjs', 'x\n');
    const hooks =
      '\n  PreToolUse:\n    - matcher: "Bash|Edit"\n      hooks:\n        - type: command\n          command: node .claude/hooks/guard.mjs';
    expect(rules(lint(root, agent({ tools: 'Read, Bash', hooks })))).not.toContain('AG-022');
  });

  it('AC-5: AG-015 blocks bypassPermissions until a resolved packet for the same powers and file is recorded', () => {
    const root = project();
    const text = agent({ permissionMode: 'bypassPermissions' });
    const before = lint(root, text);
    expect(rules(before)).toContain('AG-015');
    const id = raiseAgentPermissionDecision(root, {
      agent: 'migration-reviewer',
      powers: before.powers,
      fileHash: before.file_hash,
    });
    expect(rules(lint(root, text, { permissionDecisions: [id] }))).toContain('AG-015');
    resolvePendingDecision(root, id, AGENT_PERMISSION_ALLOW, 'needed');
    expect(rules(lint(root, text, { permissionDecisions: [id] }))).not.toContain('AG-015');
    const edited = lint(root, `${text}\nOne more line.\n`, { permissionDecisions: [id] });
    expect(edited.findings.find((entry) => entry.rule === 'AG-015')?.message).toContain(
      'approved an earlier version of the agent file',
    );
  });

  it('AC-68: a packet approved on the draft copy still approves the released file, and an edit to a hook script invalidates it', () => {
    const root = project();
    put(root, '.claude/hooks/guard.mjs', 'x\n');
    put(root, 'tests/agents/migration-reviewer/guard.test.mjs', 'x\n');
    const hooks =
      '\n  PreToolUse:\n    - matcher: "Edit"\n      hooks:\n        - type: command\n          command: node .claude/hooks/guard.mjs';
    const text = agent({ permissionMode: 'bypassPermissions', hooks });
    const draft = put(
      root,
      '.paqad/tmp/authoring/agents/migration-reviewer/draft/migration-reviewer.md',
      text,
    );
    const options = {
      projectRoot: root,
      installedAgents: [],
      installedSkills: [],
      mcpServers: [],
    };
    const drafted = lintAgentFile(draft, options);
    const id = raiseAgentPermissionDecision(root, {
      agent: 'migration-reviewer',
      powers: drafted.powers,
      fileHash: drafted.file_hash,
    });
    resolvePendingDecision(root, id, AGENT_PERMISSION_ALLOW, 'needed');
    const released = lint(root, text, { permissionDecisions: [id] });
    expect(released.file_hash).toBe(drafted.file_hash);
    expect(rules(released)).not.toContain('AG-015');
    put(root, '.claude/hooks/guard.mjs', 'y\n');
    expect(rules(lint(root, text, { permissionDecisions: [id] }))).toContain('AG-015');
  });
});

describe('permissionApproval', () => {
  it('AC-68: an expired, unanswered, wrong-category or other-powers packet is not an approval', () => {
    const root = project();
    expect(permissionApproval(root, ['D-NONE'], ['Bash'], 'h', new Date()).reason).toContain(
      'is not in the decision ledger',
    );
    const id = raiseAgentPermissionDecision(root, { agent: 'a', powers: ['Bash'], fileHash: 'h' });
    expect(permissionApproval(root, [id], ['Bash'], 'h', new Date()).reason).toContain(
      'is not resolved with Allow these powers',
    );
    resolvePendingDecision(root, id, AGENT_PERMISSION_ALLOW, '');
    const now = new Date();
    expect(permissionApproval(root, [id], ['Bash'], 'h', now)).toEqual({
      approved: true,
      decision: id,
      reason: `approved by ${id}`,
    });
    expect(permissionApproval(root, [id], ['Bash', 'WebFetch'], 'h', now).reason).toContain(
      'lists other powers',
    );
    const later = new Date(now.getTime() + 31 * 86_400_000);
    expect(permissionApproval(root, [id], ['Bash'], 'h', later).reason).toBe(
      `decision ${id} expired after 30 days`,
    );
    expect(permissionApproval(root, [], ['Bash'], 'h', now).approved).toBe(false);
  });
});

describe('bodyHeadingOrderProblem', () => {
  it('names missing headings and a wrong order', () => {
    expect(bodyHeadingOrderProblem(BODY)).toBeNull();
    expect(bodyHeadingOrderProblem('## Objective\n## Report\n')).toContain('missing ## Procedure');
    const swapped = BODY.replace('## Objective', '## TEMP')
      .replace('## Procedure', '## Objective')
      .replace('## TEMP', '## Procedure');
    expect(bodyHeadingOrderProblem(swapped)).toContain('must come in the order');
  });
});

describe('readPermissionDecisionIds and lintAgentInProject', () => {
  it('reads packet ids from the workspace and the tracked evidence, skipping bad JSON', () => {
    const root = project();
    expect(readPermissionDecisionIds(root, 'db-reader')).toEqual([]);
    put(root, '.paqad/tmp/authoring/agents/db-reader/permissions.json', JSON.stringify(['D-1', 2]));
    put(
      root,
      '.paqad/authoring/agents/db-reader/evidence.json',
      JSON.stringify({ permission_decisions: ['D-2', 'D-1'] }),
    );
    expect(readPermissionDecisionIds(root, 'db-reader')).toEqual(['D-1', 'D-2']);
    put(root, '.paqad/authoring/agents/db-reader/evidence.json', '{bad');
    expect(readPermissionDecisionIds(root, 'db-reader')).toEqual(['D-1']);
  });

  it('lints with the configured limits and tolerates a file stem that is no agent name', () => {
    const root = project();
    put(root, '.paqad/.config', 'agent_prompt_max_tokens=10\n');
    const rel = put(root, '.claude/agents/Bad_Name.md', agent());
    const result = lintAgentInProject(root, rel, {
      installedAgents: [],
      installedSkills: [],
      mcpServers: [],
    });
    expect(rules(result)).toContain('AG-014');
  });
});
