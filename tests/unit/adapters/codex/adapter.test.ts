import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { CodexCliAdapter } from '@/adapters';

import { fixtureProfile, fixtureSkillBundleArtifacts } from '../shared.fixture';

describe('CodexCliAdapter', () => {
  const adapter = new CodexCliAdapter();

  it('generates AGENTS.md as a lean bootstrap stub', async () => {
    const files = await adapter.generateConfig({
      frameworkPath: '.paqad/framework-path.txt',
      rulesPath: 'docs/instructions/rules',
      projectRoot: '/tmp/project',
    });
    expect(files[0]?.path).toBe('AGENTS.md');
    const content = files[0]?.content ?? '';

    // Issue #229 — the entry file is now a lean stub: a one-line bootstrap pointer
    // (mentioning `.paqad/framework-path.txt` + `AGENT-BOOTSTRAP.md`), the
    // graceful-degradation fallback clause, and the `Adapter:` footer.
    expect(content).toContain('.paqad/framework-path.txt');
    expect(content).toContain('AGENT-BOOTSTRAP.md');
    expect(content).toContain(
      'proceed as a normal assistant with no paqad behavior. Do not block.',
    );
    expect(content).toContain('Adapter:');
    expect(content).toContain('codex-cli');

    // The stub carries ZERO `## ` headings and no longer inlines load steps,
    // instruction-doc paths, the documentation workflow prose, or either contract.
    expect(content).not.toMatch(/^## /m);
    expect(content).not.toContain('docs/instructions');
    expect(content).not.toContain('docs/modules');
    expect(content).not.toContain('create documentation');
    expect(content).not.toContain('Do not ask the user to choose a document type');
    expect(content).not.toContain('paqad in your chat');
    expect(content).not.toContain('Decision Pause Contract');
  });

  it('places skills in the Codex directory', async () => {
    const files = await adapter.generateSkills(fixtureSkillBundleArtifacts());
    expect(files.map((file) => file.path)).toEqual([
      '.codex/skills/sample-skill/SKILL.md',
      '.codex/skills/sample-skill/agents/openai.yaml',
      '.codex/skills/sample-skill/references/checklist.md',
    ]);
  });

  it('writes Dart MCP config for flutter', async () => {
    const files = await adapter.installMcp([], fixtureProfile('flutter'));
    expect(files[0]?.content).toContain('dart-mcp');
  });
});

describe('CodexCliAdapter — full hook chain (issue #566)', () => {
  const adapter = new CodexCliAdapter();
  const FIXED_HOME = '/fake/home/.paqad-ai/current';

  interface HookCmd { type: string; command: string }
  interface HookGroup { matcher?: string; hooks: HookCmd[] }
  interface Hooks { hooks: Record<string, HookGroup[]> }

  async function render(projectRoot: string): Promise<string> {
    const prior = process.env.PAQAD_FRAMEWORK_HOME;
    process.env.PAQAD_FRAMEWORK_HOME = FIXED_HOME;
    try {
      const files = await adapter.generateConfig({
        frameworkPath: '.paqad/framework-path.txt',
        rulesPath: 'docs/instructions/rules',
        projectRoot,
      });
      return files.find((f) => f.path === '.codex/hooks.json')!.content;
    } finally {
      if (prior === undefined) delete process.env.PAQAD_FRAMEWORK_HOME;
      else process.env.PAQAD_FRAMEWORK_HOME = prior;
    }
  }
  const cmds = (groups: HookGroup[]): string[] =>
    groups.flatMap((g) => g.hooks.map((h) => h.command));

  it('writes all four events with paqad commands in order, codex argv where host-aware (AC-1)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-codex-hooks-'));
    const json = JSON.parse(await render(root)) as Hooks;

    // PreToolUse: matcher ^apply_patch$, four hooks in order.
    const pre = json.hooks.PreToolUse;
    expect(pre.every((g) => g.matcher === '^apply_patch$')).toBe(true);
    expect(cmds(pre)).toEqual([
      'node "' + FIXED_HOME + '/hooks/agent-entry-gate.mjs"',
      'node "' + FIXED_HOME + '/hooks/stage-writer.mjs" codex-cli',
      'node "' + FIXED_HOME + '/hooks/decision-pause-gate.mjs"',
      'node "' + FIXED_HOME + '/hooks/capability-gate.mjs" pre-mutation codex-cli',
    ]);

    expect(cmds(json.hooks.UserPromptSubmit)).toEqual([
      'node "' + FIXED_HOME + '/hooks/agent-entry-prompt-gate.mjs" codex-cli',
      'node "' + FIXED_HOME + '/hooks/ticket-intake-prompt.mjs" codex-cli',
    ]);
    expect(cmds(json.hooks.SessionStart)).toEqual([
      'node "' + FIXED_HOME + '/hooks/agent-entry-session-start.mjs"',
      'node "' + FIXED_HOME + '/hooks/silent-update.mjs"',
    ]);
    expect(cmds(json.hooks.Stop)).toEqual([
      'node "' + FIXED_HOME + '/hooks/stage-marker-parse.mjs" codex-cli',
      'node "' + FIXED_HOME + '/hooks/verification-completion.mjs" codex-cli',
      'node "' + FIXED_HOME + '/hooks/capability-gate.mjs" completion codex-cli',
    ]);
    // The retired record-only hook is gone from Codex — it renders the blocking chain now.
    expect(await render(root)).not.toContain('verification-record.mjs');
  });

  it('a second onboard is byte-identical and a hand-added user hook survives (AC-2)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'paqad-codex-idem-'));
    const first = await render(root);
    // Seed the generated file plus a user's own Stop hook.
    const parsed = JSON.parse(first) as Hooks;
    parsed.hooks.Stop.push({ hooks: [{ type: 'command', command: 'echo my-own-hook' }] });
    const full = join(root, '.codex/hooks.json');
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, JSON.stringify(parsed, null, 2) + '\n');

    const second = await render(root);
    const secondJson = JSON.parse(second) as Hooks;
    // The user's hook is preserved…
    expect(cmds(secondJson.hooks.Stop)).toContain('echo my-own-hook');
    // …and paqad's own hooks are not duplicated.
    const paqadStop = cmds(secondJson.hooks.Stop).filter((c) => c.includes('verification-completion.mjs'));
    expect(paqadStop).toHaveLength(1);

    // A third onboard over the second's output is byte-identical (idempotent).
    writeFileSync(full, second);
    expect(await render(root)).toBe(second);
  });
});
