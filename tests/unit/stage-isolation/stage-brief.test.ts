import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { PAQAD_STAGE_HELPER_MATCHER } from '@/adapters/shared/paqad-hooks.js';
import { featureFilePath } from '@/feature-evidence/paths.js';
import {
  closeActiveFeature,
  openFeatureChange,
  appendFeatureStageRow,
} from '@/feature-evidence/stage-ledger.js';
import { persistLedgerSessionId, resolveHookSession } from '@/rag-ledger/session.js';
import {
  buildStageBrief,
  isSafeSessionId,
  resolveBriefSession,
  seedStageAgent,
  STAGE_BRIEF_ENTRY_LINE,
  STAGE_BRIEF_MAX_CHARS,
  STAGE_BRIEF_NO_CHANGE_LINE,
  stageBriefHookOutput,
  stageBriefMoreLine,
  stageHelperStage,
} from '@/stage-isolation/stage-brief.js';
import { defaultFeatureDevelopmentPolicy } from '@/pipeline/feature-development-policy.js';
import { stageFromAgentType } from '@/stage-isolation/subagent-completion.js';
import { STAGE_AGENT_STAGES } from '@/stage-isolation/stage-agents.js';

const SESSION = 'ses_orch';
const REPO_TEAM_DIR = join(process.cwd(), '.paqad/configs/feature-development');

const roots: string[] = [];
function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-stage-brief-'));
  roots.push(root);
  return root;
}
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function teamDir(root: string): string {
  const dir = join(root, '.paqad/configs/feature-development');
  mkdirSync(dir, { recursive: true });
  return dir;
}

function withRepoPolicy(root: string): string {
  cpSync(REPO_TEAM_DIR, teamDir(root), { recursive: true });
  return root;
}

function activeChange(root: string, lane?: 'fast' | 'graduated' | 'full'): string {
  const dir = openFeatureChange(root, SESSION, {
    adapter: 'claude-code',
    title: 'Stage brief',
    issue: '12',
    ulid: '01JABCDEFGHJKMNPQRSTVWXYZ0',
    ...(lane ? { lane } : {}),
  });
  persistLedgerSessionId(root, SESSION);
  return dir;
}

function writeBundleFile(root: string, dir: string, file: 'plan' | 'specification'): string {
  const path = featureFilePath(dir, file);
  writeFileSync(join(root, path), '{"ok":true}\n', 'utf8');
  return path;
}

describe('buildStageBrief', () => {
  it.each([...STAGE_AGENT_STAGES])(
    'stays under the cap for %s on the repo policy and on a minimal fixture',
    (stage) => {
      const repo = withRepoPolicy(tempRoot());
      activeChange(repo);
      const minimal = tempRoot();
      for (const root of [repo, minimal]) {
        const brief = buildStageBrief(stage, root, SESSION);
        expect(brief.length).toBeLessThanOrEqual(STAGE_BRIEF_MAX_CHARS);
        expect(brief).toContain(`You are the paqad **${stage}** stage agent`);
        expect(brief).toContain(`SE_SESSION=${SESSION} paqad-ai stage start ${stage}`);
        expect(brief).toContain(`SE_SESSION=${SESSION} paqad-ai stage end ${stage} --artifact`);
        expect(brief).toContain(STAGE_BRIEF_ENTRY_LINE);
        expect(brief).not.toMatch(/already recorded/i);
        expect(brief).not.toContain('This brief was shortened.');
      }
    },
  );

  function overflowingDevelopment(root: string): void {
    const lines = Array.from(
      { length: 40 },
      (_, index) => `      - "Overflow instruction ${index} ${'x'.repeat(400)}"`,
    );
    writeFileSync(
      join(teamDir(root), 'workflow.yaml'),
      ['stages:', '  development:', '    instructions:', ...lines, ''].join('\n'),
      'utf8',
    );
  }

  it('drops instruction lines from the end and ends with the --full line when it overflows', () => {
    const root = tempRoot();
    overflowingDevelopment(root);
    const brief = buildStageBrief('development', root, SESSION);
    expect(brief.length).toBeLessThanOrEqual(STAGE_BRIEF_MAX_CHARS);
    expect(brief).toContain(
      'This brief was shortened. Run `paqad-ai stage brief development --full` to see every instruction for this stage.',
    );
    expect(brief).not.toContain('docs/instructions/workflows/feature-development.yaml');
    expect(brief).toContain('Overflow instruction 0 ');
    expect(brief).not.toContain('Overflow instruction 39 ');
    expect(brief).toContain(`SE_SESSION=${SESSION} paqad-ai stage end development --artifact`);
  });

  it('prints every instruction and no shortened line with full', () => {
    const root = tempRoot();
    overflowingDevelopment(root);
    const brief = buildStageBrief('development', root, SESSION, { full: true });
    expect(brief.length).toBeGreaterThan(STAGE_BRIEF_MAX_CHARS);
    expect(brief).toContain('Overflow instruction 0 ');
    expect(brief).toContain('Overflow instruction 39 ');
    expect(brief).not.toContain('This brief was shortened.');
    expect(brief).toContain(`SE_SESSION=${SESSION} paqad-ai stage end development --artifact`);
  });

  it('prints the same short brief with or without full', () => {
    const root = tempRoot();
    expect(buildStageBrief('review', root, SESSION, { full: true })).toBe(
      buildStageBrief('review', root, SESSION),
    );
  });

  it('shows no shortened line on a brief of exactly the cap', () => {
    const root = tempRoot();
    const base = buildStageBrief('review', root, SESSION);
    const extra = '- Pad '.length;
    const pad = 'p'.repeat(STAGE_BRIEF_MAX_CHARS - base.length - extra - 1);
    writeFileSync(
      join(teamDir(root), 'workflow.yaml'),
      `stages:\n  review:\n    instructions:\n      - "Pad ${pad}"\n`,
      'utf8',
    );
    const brief = buildStageBrief('review', root, SESSION);
    expect(brief.length).toBe(STAGE_BRIEF_MAX_CHARS);
    expect(brief).not.toContain('This brief was shortened.');
  });

  it('names the real stage in the shortened line', () => {
    expect(stageBriefMoreLine('review')).toBe(
      'This brief was shortened. Run `paqad-ai stage brief review --full` to see every instruction for this stage.',
    );
  });

  it('drops read entries once no instruction line is left to drop', () => {
    const root = tempRoot();
    const reads = Array.from(
      { length: 40 },
      (_, index) => `      - "docs/${index}/${'r'.repeat(300)}"`,
    );
    writeFileSync(
      join(teamDir(root), 'workflow.yaml'),
      ['stages:', '  review:', '    read:', ...reads, ''].join('\n'),
      'utf8',
    );
    const brief = buildStageBrief('review', root, SESSION);
    expect(brief.length).toBeLessThanOrEqual(STAGE_BRIEF_MAX_CHARS);
    expect(brief).toContain(stageBriefMoreLine('review'));
    expect(brief).toContain('No extra instructions for this stage.');
  });

  it('AC-55: puts team read and instructions after paqad own', () => {
    const root = tempRoot();
    writeFileSync(
      join(teamDir(root), 'workflow.yaml'),
      'stages:\n  review:\n    read: [docs/team/**]\n    instructions:\n      - Team review rule.\n',
      'utf8',
    );
    const brief = buildStageBrief('review', root, SESSION);
    const own = defaultFeatureDevelopmentPolicy().stages.review.instructions[0]!;
    expect(brief.indexOf('Team review rule.')).toBeGreaterThan(brief.indexOf(own));
    expect(brief).toContain('docs/team/**');
  });

  it('prints the module attribution setting in the planning brief', () => {
    const root = tempRoot();
    expect(buildStageBrief('planning', root, SESSION)).toContain('Module attribution: defer');
    writeFileSync(
      join(teamDir(root), 'workflow.yaml'),
      'stages:\n  planning:\n    module_attribution: stop\n',
      'utf8',
    );
    expect(buildStageBrief('planning', root, SESSION)).toContain('Module attribution: stop');
    expect(buildStageBrief('review', root, SESSION)).not.toContain('Module attribution:');
  });

  it('says no active change was found when the session has none', () => {
    const brief = buildStageBrief('development', tempRoot(), SESSION);
    expect(brief).toContain(STAGE_BRIEF_NO_CHANGE_LINE);
    expect(brief).not.toContain('- Lane:');
  });

  it('lists only the pillar files that exist, with the recorded lane', () => {
    const root = tempRoot();
    const dir = activeChange(root, 'graduated');
    const plan = writeBundleFile(root, dir, 'plan');
    const development = buildStageBrief('development', root, SESSION);
    expect(development).toContain(`- Change: \`${dir}\``);
    expect(development).toContain('- Lane: graduated');
    expect(development).toContain(`  - \`${plan}\``);
    expect(development).not.toContain('specification.json');
    expect(buildStageBrief('review', root, SESSION)).toContain('- Previous pillar files: none');
    expect(buildStageBrief('planning', root, SESSION)).toContain('- Previous pillar files: none');
    const spec = writeBundleFile(root, dir, 'specification');
    expect(buildStageBrief('development', root, SESSION)).toContain(`  - \`${spec}\``);
  });

  it('shows the lane as full when it is unresolved', () => {
    const root = tempRoot();
    activeChange(root);
    expect(buildStageBrief('checks', root, SESSION)).toContain('- Lane: full');
  });

  it('treats a closed change as no active change', () => {
    const root = tempRoot();
    const dir = activeChange(root);
    writeBundleFile(root, dir, 'plan');
    appendFeatureStageRow(root, SESSION, dir, { kind: 'open' });
    closeActiveFeature(root, SESSION);
    const brief = buildStageBrief('specification', root, SESSION);
    expect(brief).toContain(STAGE_BRIEF_NO_CHANGE_LINE);
    expect(brief).not.toContain('plan.json');
  });

  it('asks only the development stage to load the rules', () => {
    const root = tempRoot();
    for (const stage of STAGE_AGENT_STAGES) {
      const brief = buildStageBrief(stage, root, SESSION);
      expect(brief.includes(`SE_SESSION=${SESSION} paqad-ai rules load`)).toBe(
        stage === 'development',
      );
    }
  });

  it('puts SE_AGENT_ID on every command line when an agent id is known', () => {
    const root = tempRoot();
    activeChange(root);
    const brief = buildStageBrief('planning', root, SESSION, { agentId: 'agent-a1' });
    const prefix = `SE_SESSION=${SESSION} SE_AGENT_ID=agent-a1 paqad-ai`;
    expect(brief).toContain(`\`${prefix} stage start planning\``);
    expect(brief).toContain(`\`${prefix} stage end planning --artifact`);
    expect(brief).toContain('**Export `SE_AGENT_ID=agent-a1`**');
    expect(brief.match(/SE_SESSION=\S+ paqad-ai/g)).toBeNull();
  });

  it('leaves SE_AGENT_ID out for a missing, empty or unsafe agent id', () => {
    const root = tempRoot();
    activeChange(root);
    const plain = buildStageBrief('planning', root, SESSION);
    for (const agentId of [undefined, null, '', '  ', 'a b', '$(id)', 42]) {
      expect(buildStageBrief('planning', root, SESSION, { agentId })).toBe(plain);
    }
    expect(plain).not.toContain('SE_AGENT_ID');
  });

  it('words the head for a resumed agent without the started-and-return lines', () => {
    const root = tempRoot();
    activeChange(root);
    const fresh = buildStageBrief('specification', root, SESSION);
    const resumed = buildStageBrief('specification', root, SESSION, { resumed: true });
    expect(fresh).toContain('added this stage brief to your context when you started');
    expect(fresh).toContain('in your own isolated context and then return');
    expect(resumed).toContain('resumed for the same feature-development change');
    expect(resumed).toContain(STAGE_BRIEF_ENTRY_LINE);
    expect(resumed).not.toContain('when you started');
    expect(resumed).not.toContain('and then return');
    expect(resumed.slice(resumed.indexOf('## Your change'))).toBe(
      fresh.slice(fresh.indexOf('## Your change')),
    );
  });

  describe('the planning read list', () => {
    const SHARED = ['docs/instructions/stack/**', 'docs/instructions/design-system/**'];

    function readSection(brief: string): string[] {
      const start = brief.indexOf('## Read first');
      const end = brief.indexOf('## Stage instructions');
      return brief
        .slice(start, end)
        .split('\n')
        .filter((line) => line.startsWith('- '))
        .map((line) => line.slice(2));
    }

    function changeTitled(root: string, title: string): void {
      openFeatureChange(root, SESSION, {
        adapter: 'claude-code',
        title,
        issue: '12',
        ulid: '01JABCDEFGHJKMNPQRSTVWXYZ0',
      });
      persistLedgerSessionId(root, SESSION);
    }

    it('reads the three shared folders and the index query instruction when no module is named', () => {
      const root = withRepoPolicy(tempRoot());
      mkdirSync(join(root, 'docs/modules/billing'), { recursive: true });
      changeTitled(root, 'Speed up the stage brief');
      const brief = buildStageBrief('planning', root, SESSION);
      expect(readSection(brief)).toEqual(SHARED);
      expect(brief).toContain('paqad-ai index query');
    });

    it('adds docs/modules/<module>/** for each module the attribution names', () => {
      const root = withRepoPolicy(tempRoot());
      for (const slug of ['billing', 'auth']) {
        mkdirSync(join(root, `docs/modules/${slug}`), { recursive: true });
      }
      changeTitled(root, 'Fix rounding in the billing module');
      expect(readSection(buildStageBrief('planning', root, SESSION))).toEqual([
        ...SHARED,
        'docs/modules/billing/**',
      ]);
    });

    it('skips a named module with no docs/modules folder and keeps the shared folders', () => {
      const root = withRepoPolicy(tempRoot());
      mkdirSync(join(root, 'docs/modules/auth'), { recursive: true });
      changeTitled(root, 'Fix rounding in the billing module');
      expect(readSection(buildStageBrief('planning', root, SESSION))).toEqual(SHARED);
    });

    it('reads the module from request.md when the title names none', () => {
      const root = withRepoPolicy(tempRoot());
      mkdirSync(join(root, 'docs/modules/billing'), { recursive: true });
      changeTitled(root, 'Rounding fix');
      const dir = openFeatureChange(root, SESSION, {
        adapter: 'claude-code',
        title: 'Rounding fix',
        issue: '12',
        ulid: '01JABCDEFGHJKMNPQRSTVWXYZ0',
      });
      writeFileSync(join(root, featureFilePath(dir, 'request')), 'Module: billing\n', 'utf8');
      expect(readSection(buildStageBrief('planning', root, SESSION))).toContain(
        'docs/modules/billing/**',
      );
      expect(readSection(buildStageBrief('specification', root, SESSION))).not.toContain(
        'docs/modules/billing/**',
      );
    });
  });

  it('AC-45: tells the specification stage to run spec pipeline start in the foreground', () => {
    const root = withRepoPolicy(tempRoot());
    activeChange(root);
    const line =
      'Run `spec pipeline start` in the foreground. It returns within 20 seconds. Never background it and never poll `status`.';
    for (const resumed of [false, true]) {
      expect(buildStageBrief('specification', root, SESSION, { resumed })).toContain(line);
    }
    expect(buildStageBrief('planning', root, SESSION)).not.toContain(line);
  });

  it('throws on an unknown stage or an unsafe session id', () => {
    const root = tempRoot();
    expect(() => buildStageBrief('delivery', root, SESSION)).toThrow(/unknown stage/);
    expect(() => buildStageBrief('development', root, 'x; rm -rf ~')).toThrow(/unsafe session id/);
    expect(() => buildStageBrief('development', root, '')).toThrow(/unsafe session id/);
  });
});

describe('isSafeSessionId', () => {
  it('accepts host ids and rejects shell or path characters', () => {
    expect(isSafeSessionId('36416bc0-b415-43e8-943d-22b4b74f241f')).toBe(true);
    expect(isSafeSessionId('ses_orch.1')).toBe(true);
    expect(isSafeSessionId('a'.repeat(129))).toBe(false);
    expect(isSafeSessionId('$(whoami)')).toBe(false);
    expect(isSafeSessionId('../x')).toBe(false);
  });
});

describe('stageBriefHookOutput', () => {
  it('wraps the brief as SubagentStart additional context', () => {
    expect(stageBriefHookOutput('brief text')).toBe(
      JSON.stringify({
        hookSpecificOutput: { hookEventName: 'SubagentStart', additionalContext: 'brief text' },
      }),
    );
  });
});

describe('stageHelperStage', () => {
  const helpers: Array<[string, string]> = [
    ['paqad-planning', 'planning'],
    ['paqad-specification', 'specification'],
    ['paqad-development', 'development'],
    ['paqad-review', 'review'],
    ['paqad-checks', 'checks'],
    ['paqad-documentation-sync', 'documentation_sync'],
  ];

  it.each(
    helpers.flatMap(([name, stage]) => [
      [name, stage],
      [`paqad:${name}`, stage],
    ]),
  )('maps %s to %s, agreeing with the matcher and stageFromAgentType', (agentType, stage) => {
    expect(stageHelperStage(agentType)).toBe(stage);
    expect(new RegExp(PAQAD_STAGE_HELPER_MATCHER).test(agentType)).toBe(true);
    expect(stageFromAgentType(agentType)).toBe(stage);
  });

  it.each([
    'paqad-expert',
    'paqad:paqad-chief-architect',
    'paqad-foo',
    'paqad-documentation_sync',
    'xpaqad-planning',
  ])('returns null for %s, agreeing with the matcher and stageFromAgentType', (agentType) => {
    expect(stageHelperStage(agentType)).toBeNull();
    expect(new RegExp(PAQAD_STAGE_HELPER_MATCHER).test(agentType)).toBe(false);
    expect(stageFromAgentType(agentType)).toBeNull();
  });

  it('returns null for a non-string agent type', () => {
    expect(stageHelperStage(undefined)).toBeNull();
    expect(stageHelperStage(42)).toBeNull();
  });
});

describe('resolveBriefSession and seedStageAgent', () => {
  it('refuses an unsafe payload, SE_SESSION or CLAUDE_SESSION_ID value', () => {
    const root = tempRoot();
    expect(() => resolveBriefSession(root, { session_id: 'a b' }, {})).toThrow(/unsafe/);
    expect(() => resolveBriefSession(root, {}, { SE_SESSION: '$(id)' })).toThrow(/unsafe/);
    expect(() => resolveBriefSession(root, {}, { CLAUDE_SESSION_ID: '../x' })).toThrow(/unsafe/);
  });

  it('resolves the in-flight session the completion hook resolves', () => {
    const root = tempRoot();
    activeChange(root);
    const payload = { session_id: 'sub_other' };
    expect(resolveBriefSession(root, payload, { SE_SESSION: 'env_other' })).toBe(
      resolveHookSession(root, payload, { SE_SESSION: 'env_other' }),
    );
    expect(resolveBriefSession(root, payload, {})).toBe(SESSION);
  });

  it('returns the hook output for a seeded stage and leaves the session cache as it was', () => {
    const root = tempRoot();
    activeChange(root);
    const cache = join(root, '.paqad/session/ledger-session-id');
    writeFileSync(cache, 'someone_else', 'utf8');
    const output = JSON.parse(seedStageAgent('review', root, { session_id: 'sub_x' }, {}));
    expect(output.hookSpecificOutput.hookEventName).toBe('SubagentStart');
    expect(output.hookSpecificOutput.additionalContext).toContain('stage start review');
    expect(readFileSync(cache, 'utf8')).toBe('someone_else');
  });

  it('writes the SubagentStart agent_id on the brief command lines', () => {
    const root = tempRoot();
    activeChange(root);
    const output = JSON.parse(
      seedStageAgent('planning', root, { session_id: SESSION, agent_id: 'agent-p1' }, {}),
    );
    expect(output.hookSpecificOutput.additionalContext).toBe(
      buildStageBrief('planning', root, SESSION, { agentId: 'agent-p1' }),
    );
    expect(output.hookSpecificOutput.additionalContext).toContain(
      `SE_SESSION=${SESSION} SE_AGENT_ID=agent-p1 paqad-ai stage start planning`,
    );
  });
});
