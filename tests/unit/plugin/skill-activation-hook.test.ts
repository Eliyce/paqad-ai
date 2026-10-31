import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  activationFromPayload,
  pruneActivationText,
  skillNameFromToolInput,
} from '../../../runtime/hooks/lib/skill-activation-core.mjs';
import { serializePluginHooksJson } from '@/plugin/manifest-build.js';

const REPO = resolve(import.meta.dirname, '../../..');
const HOOK = join(REPO, 'runtime/hooks/skill-activation.mjs');
const LEDGER = '.paqad/ledger/authoring/activations.jsonl';

const PRE_EXISTING_ENTRIES: Record<string, string[]> = {
  PreToolUse: [
    'agent-entry-gate.mjs',
    'stage-writer.mjs',
    'decision-pause-gate.mjs',
    'capability-gate.mjs pre-mutation',
  ],
  UserPromptSubmit: ['agent-entry-prompt-gate.mjs', 'ticket-intake-prompt.mjs'],
  SessionStart: ['plugin-session-start.mjs', 'agent-entry-session-start.mjs'],
  Stop: ['stage-marker-parse.mjs', 'verification-completion.mjs', 'capability-gate.mjs completion'],
  SubagentStart: ['stage-agent-start.mjs'],
  SubagentStop: ['stage-agent-completion.mjs'],
};

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function project(config = ''): string {
  const root = mkdtempSync(join(tmpdir(), 'paqad-skill-hook-'));
  roots.push(root);
  mkdirSync(join(root, '.paqad'), { recursive: true });
  writeFileSync(join(root, '.paqad/framework-path.txt'), '/framework\n');
  writeFileSync(join(root, '.paqad/.config'), config);
  return root;
}

function runHook(
  root: string,
  payload: unknown,
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [HOOK], {
    input:
      typeof payload === 'string' ? payload : JSON.stringify({ cwd: root, ...(payload as object) }),
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: root, USERPROFILE: root },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function ledger(root: string): Array<Record<string, unknown>> {
  if (!existsSync(join(root, LEDGER))) return [];
  return readFileSync(join(root, LEDGER), 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function commandsOf(hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>) {
  return Object.fromEntries(
    Object.entries(hooks).map(([event, groups]) => [
      event,
      groups.map((group) =>
        group.hooks
          .map((hook) => hook.command.replace(/^.*\/hooks\//u, '').replaceAll('"', ''))
          .join(','),
      ),
    ]),
  );
}

describe('the plugin hooks.json', () => {
  it('AC-39, INV-12: keeps every existing entry identical and in order, adding only the PostToolUse entry', () => {
    const committed = JSON.parse(
      readFileSync(join(REPO, 'runtime/claude-plugin/hooks.json'), 'utf8'),
    );
    expect(readFileSync(join(REPO, 'runtime/claude-plugin/hooks.json'), 'utf8')).toBe(
      serializePluginHooksJson(),
    );
    const commands = commandsOf(committed.hooks);
    expect(Object.keys(commands)).toEqual([...Object.keys(PRE_EXISTING_ENTRIES), 'PostToolUse']);
    for (const [event, entries] of Object.entries(PRE_EXISTING_ENTRIES)) {
      expect(commands[event]).toEqual(entries);
    }
    expect(committed.hooks.PostToolUse).toEqual([
      {
        matcher: 'Skill|Read',
        hooks: [
          {
            type: 'command',
            command: 'node "${CLAUDE_PLUGIN_ROOT}/runtime/hooks/skill-activation.mjs"',
          },
        ],
      },
    ]);
  });
});

describe('the activation core', () => {
  it('AC-60: takes the name from the tool input only, stripping a plugin prefix', () => {
    expect(
      skillNameFromToolInput({
        tool_name: 'Skill',
        tool_input: { skill: 'paqad:processing-invoices' },
      }),
    ).toBe('processing-invoices');
    expect(
      skillNameFromToolInput({
        tool_name: 'Read',
        tool_input: { file_path: '/repo/.claude/skills/processing-invoices/SKILL.md' },
      }),
    ).toBe('processing-invoices');
    expect(
      activationFromPayload({ tool_name: 'Read', tool_input: { file_path: 'src/a.ts' } }),
    ).toBeNull();
    expect(
      activationFromPayload({ tool_name: 'Skill', tool_input: { skill: '../evil name' } }),
    ).toBeNull();
  });

  it('FR-48: drops lines older than twice the dark window', () => {
    const now = new Date('2026-10-31T00:00:00.000Z');
    const text = [
      JSON.stringify({ skill: 'a', at: '2026-10-30T00:00:00.000Z' }),
      JSON.stringify({ skill: 'b', at: '2026-08-01T00:00:00.000Z' }),
      'not json',
    ].join('\n');
    expect(pruneActivationText(text, now, 30)).toBe(
      `${JSON.stringify({ skill: 'a', at: '2026-10-30T00:00:00.000Z' })}\n`,
    );
  });
});

describe('runtime/hooks/skill-activation.mjs', () => {
  it('prunes with authoring_dark_window_days from the project config', () => {
    const root = project('authoring_dark_window_days=5\n');
    const old = new Date(Date.now() - 12 * 86_400_000).toISOString();
    const line = JSON.stringify({
      skill: 'old-skill',
      request_id: 'r',
      session_id: 's',
      at: old,
      source: 'Skill',
    });
    mkdirSync(join(root, '.paqad/ledger/authoring'), { recursive: true });
    writeFileSync(join(root, LEDGER), `${line}\n`.repeat(Math.ceil(1_000_001 / (line.length + 1))));
    runHook(root, {
      tool_name: 'Skill',
      tool_input: { skill: 'fresh-skill' },
      session_id: 'ses-1',
    });
    expect(ledger(root).map((entry) => entry.skill)).toEqual(['fresh-skill']);
    expect(readdirSync(join(root, '.paqad/ledger/authoring'))).toEqual(['activations.jsonl']);
  });

  it('leaves a ledger at or under the prune threshold untouched', () => {
    const root = project('authoring_dark_window_days=5\n');
    const old = JSON.stringify({
      skill: 'old-skill',
      request_id: 'r',
      session_id: 's',
      at: new Date(Date.now() - 12 * 86_400_000).toISOString(),
      source: 'Skill',
    });
    mkdirSync(join(root, '.paqad/ledger/authoring'), { recursive: true });
    writeFileSync(join(root, LEDGER), `${old}\n`);
    expect(runHook(root, { tool_name: 'Skill', tool_input: { skill: 'fresh-skill' } }).status).toBe(
      0,
    );
    expect(ledger(root).map((entry) => entry.skill)).toEqual(['old-skill', 'fresh-skill']);
  });

  it('AC-15, AC-60: logs the Skill tool and a SKILL.md read by name with only five fields, and prints nothing', () => {
    const root = project();
    const skill = runHook(root, {
      tool_name: 'Skill',
      tool_input: { skill: 'paqad:processing-invoices', args: 'secret prompt text' },
      tool_response: 'I used processing-invoices-v2 to answer',
      session_id: 'ses-1',
      tool_use_id: 'tu-1',
    });
    const read = runHook(root, {
      tool_name: 'Read',
      tool_input: { file_path: join(root, '.claude/skills/processing-invoices/SKILL.md') },
      session_id: 'ses-1',
    });
    expect([skill, read].map((result) => [result.status, result.stdout, result.stderr])).toEqual([
      [0, '', ''],
      [0, '', ''],
    ]);
    const rows = ledger(root);
    expect(rows.map((row) => [row.skill, row.source])).toEqual([
      ['processing-invoices', 'Skill-tool'],
      ['processing-invoices', 'SKILL.md-read'],
    ]);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual([
        'at',
        'request_id',
        'session_id',
        'skill',
        'source',
      ]);
    }
    expect(readFileSync(join(root, LEDGER), 'utf8')).not.toContain('secret prompt text');
  });

  it('AC-39: a Read of a non-SKILL.md file logs nothing and creates no ledger', () => {
    const root = project();
    expect(
      runHook(root, { tool_name: 'Read', tool_input: { file_path: join(root, 'src/a.ts') } })
        .status,
    ).toBe(0);
    expect(existsSync(join(root, LEDGER))).toBe(false);
  });

  it('AC-39: a broken payload or an unwritable ledger never blocks the tool call', () => {
    const root = project();
    expect(runHook(root, '{not json')).toEqual({ status: 0, stdout: '', stderr: '' });
    mkdirSync(join(root, '.paqad/ledger'), { recursive: true });
    writeFileSync(join(root, '.paqad/ledger/authoring'), 'a file where a folder should be');
    expect(runHook(root, { tool_name: 'Skill', tool_input: { skill: 'x' } })).toEqual({
      status: 0,
      stdout: '',
      stderr: '',
    });
  });

  it('AC-42: records nothing while paqad or the Skill Orchestrator is off, or the repo is not onboarded', () => {
    for (const config of ['paqad_enable=false\n', 'skill_orchestrator_enabled=false\n']) {
      const root = project(config);
      runHook(root, { tool_name: 'Skill', tool_input: { skill: 'x' } });
      expect(ledger(root)).toEqual([]);
    }
    const root = project();
    rmSync(join(root, '.paqad/framework-path.txt'));
    runHook(root, { tool_name: 'Skill', tool_input: { skill: 'x' } });
    expect(ledger(root)).toEqual([]);
  });
});
