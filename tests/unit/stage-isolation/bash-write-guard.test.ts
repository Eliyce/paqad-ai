import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildHostHookChain, buildPluginHookChain } from '@/adapters/shared/paqad-hooks.js';
import { runCapabilityGate } from '@/kernel/gate.js';
import {
  bashWrites,
  formatStageAgentWriteSummary,
  stageAgentWriteDecision,
} from '@/stage-isolation/bash-write-guard.js';

const GUARD = join(process.cwd(), 'runtime/hooks/stage-agent-write-guard.mjs');

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'paqad-write-guard-'));
  mkdirSync(join(root, '.paqad'), { recursive: true });
  writeFileSync(join(root, '.paqad', 'onboarding-manifest.json'), '{"adapter":"claude-code"}\n');
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function bash(agentType: string, command: string) {
  return stageAgentWriteDecision({ projectRoot: root, agentType, toolName: 'Bash', command });
}

async function hook(agentType: string, command: string) {
  return execa('node', [GUARD], {
    reject: false,
    input: JSON.stringify({
      session_id: 's',
      cwd: root,
      agent_type: agentType,
      tool_name: 'Bash',
      tool_input: { command },
    }),
    env: { PAQAD_HOOK_ROUTE: '', CLAUDE_PLUGIN_ROOT: '' },
  });
}

describe('AC-26: a read-only stage agent cannot write project files through Bash; the expert seat writes its note under .paqad/tmp/high-table/', () => {
  it('blocks a Bash write to a project file from every read-only stage agent', () => {
    for (const agent of [
      'paqad-planning',
      'paqad:paqad-specification',
      'paqad-review',
      'paqad:paqad-checks',
    ]) {
      expect(bash(agent, 'echo hi > src/index.ts').blocked).toBe(true);
      expect(bash(agent, "sed -i 's/a/b/' src/a.ts").blocked).toBe(true);
      expect(bash(agent, 'cat <<EOF | tee docs/x.md\nbody\nEOF').blocked).toBe(true);
      expect(bash(agent, 'rm -rf src').blocked).toBe(true);
      expect(bash(agent, 'git checkout -- src/a.ts').blocked).toBe(true);
    }
  });

  it('allows the expert seat to write its note under .paqad/tmp/high-table/ and nowhere else', () => {
    const note = 'cat > .paqad/tmp/high-table/security.json <<\'EOF\'\n{"a": "x > y"}\nEOF';
    expect(bash('paqad:paqad-expert', note).blocked).toBe(false);
    expect(bash('paqad-chief-architect', note).blocked).toBe(false);
    expect(bash('paqad-expert', 'echo {} > .paqad/tmp/other.json').blocked).toBe(true);
    expect(bash('paqad-expert', 'echo {} > /tmp/note.json').blocked).toBe(true);
    expect(bash('paqad-chief-architect', 'echo x > src/a.ts').blocked).toBe(true);
  });

  it('the hook blocks the read-only write and allows the High Table note', async () => {
    const blocked = await hook('paqad:paqad-review', 'echo x >> README.md');
    expect(blocked.exitCode).toBe(2);
    expect(blocked.stderr).toContain('write blocked: `paqad-review` is read-only');
    const allowed = await hook(
      'paqad:paqad-expert',
      "mkdir -p .paqad/tmp/high-table && cat > .paqad/tmp/high-table/a.json <<'EOF'\n{}\nEOF",
    );
    expect(allowed.exitCode).toBe(0);
  });
});

describe('the read-only write guard leaves every other case alone', () => {
  it('lets read-only agents run reads, paqad-ai verbs, scratch writes and fd redirects', () => {
    for (const command of [
      'git status && git diff -- src | head -50',
      'paqad-ai plan compile --input .paqad/tmp/plan.json',
      "cat > .paqad/tmp/796-spec.md <<'EOF'\n> quoted line > with arrows\nEOF",
      'pnpm vitest run tests/unit/a.test.ts 2>&1 | tail -5',
      'node dist/cli/index.js skill lint --all > /dev/null 2>&1',
      'grep -rn "a > b" src',
      'echo "x" > /tmp/scratch.txt',
      '[ -f package.json ] && cat package.json',
      'cd .paqad/tmp && echo x > note.md',
    ]) {
      expect({ command, blocked: bash('paqad-planning', command).blocked }).toEqual({
        command,
        blocked: false,
      });
    }
  });

  it('fails closed on a write whose target it cannot resolve', () => {
    expect(bash('paqad-review', 'echo x > "$OUT"').blocked).toBe(true);
    expect(bash('paqad-review', 'find . -name a | xargs rm').blocked).toBe(true);
    expect(bash('paqad-review', 'cd "$DIR" && echo x > a.md').blocked).toBe(true);
    expect(
      stageAgentWriteDecision({ projectRoot: root, agentType: 'paqad-review', toolName: 'Bash' })
        .blocked,
    ).toBe(true);
  });

  it('denies Bash writes from a paqad agent no stage matches', () => {
    expect(bash('paqad-mystery', 'echo x > .paqad/tmp/a.md').blocked).toBe(true);
  });

  it('never blocks the writing stages, the main thread or other agents', () => {
    for (const agent of ['paqad-development', 'paqad:paqad-documentation-sync', 'my-helper', '']) {
      expect(bash(agent, 'echo x > src/index.ts').blocked).toBe(false);
    }
    expect(
      stageAgentWriteDecision({
        projectRoot: root,
        agentType: undefined,
        toolName: 'Bash',
        command: 'rm -rf src',
      }).blocked,
    ).toBe(false);
  });

  it('names each write target it finds', () => {
    expect(
      bashWrites('tee a.md b.md < in.txt; cp x y/z; dd if=a of=b.img; echo 1 2>err.log', root).map(
        (write) => write.target,
      ),
    ).toEqual(['a.md', 'b.md', 'y/z', 'b.img', 'err.log']);
  });

  it('says where the agent may write', () => {
    expect(
      formatStageAgentWriteSummary({ blocked: true, agent: 'paqad-expert', target: 'src/a.ts' }),
    ).toContain('`.paqad/tmp/high-table/`');
  });
});

describe('the kernel blocks Edit and Write from a read-only paqad agent before the tool runs', () => {
  it('denies a High Table Write outside .paqad/tmp/high-table/ and allows one inside', async () => {
    const outside = await runCapabilityGate({
      projectRoot: root,
      seam: 'pre-mutation',
      env: { PAQAD_STAGES_MODE: 'off' },
      payload: {
        toolName: 'Write',
        targetPath: join(root, 'src', 'a.ts'),
        agentType: 'paqad:paqad-expert',
      },
    });
    expect(outside.block).toBe(true);
    expect(outside.summary).toContain('write blocked: `paqad-expert` is read-only');
    const inside = await runCapabilityGate({
      projectRoot: root,
      seam: 'pre-mutation',
      env: { PAQAD_STAGES_MODE: 'off' },
      payload: {
        toolName: 'Write',
        targetPath: join(root, '.paqad', 'tmp', 'high-table', 'a.json'),
        agentType: 'paqad:paqad-expert',
      },
    });
    expect(inside.summary).not.toContain('write blocked');
  });
});

describe('the write guard is wired on Bash beside the existing hooks', () => {
  it('runs once per Bash call in the plugin and the settings chains', () => {
    for (const chain of [buildPluginHookChain(), buildHostHookChain('claude-code')]) {
      const guards = chain.filter((hook) => hook.command.includes('stage-agent-write-guard.mjs'));
      expect(guards).toHaveLength(1);
      expect(guards[0]).toMatchObject({ nativeEvent: 'PreToolUse', matcher: 'Bash' });
    }
    expect(
      buildHostHookChain('codex-cli').some((hook) =>
        hook.command.includes('stage-agent-write-guard.mjs'),
      ),
    ).toBe(false);
  });
});
