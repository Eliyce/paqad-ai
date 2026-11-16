import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ALREADY_ONBOARDED_TEXT,
  ONBOARD_TRAY_TEXT,
  runPaqadCommand,
} from '../../../runtime/claude-plugin/mod/commands.ts';
import {
  NONE_TICKED_WORDS,
  initialTray,
  startBlockedText,
  toggleTray,
  trayRows,
  traySubmitText,
} from '../../../runtime/claude-plugin/mod/onboard-tray.tsx';

const base = { snapshot: null, receipt: null, now: 0 };

describe('/paqad onboard and its tray', () => {
  it('FR-2: dispatches onboard before the stand-down, only for a project never onboarded', () => {
    expect(runPaqadCommand({ ...base, args: 'onboard', standDown: 'not-onboarded' })).toEqual({
      text: ONBOARD_TRAY_TEXT,
      onboard: true,
    });
    expect(
      runPaqadCommand({ ...base, args: 'onboard', standDown: 'remote' }).onboard,
    ).toBeUndefined();
    expect(runPaqadCommand({ ...base, args: 'onboard', standDown: null }).text).toBe(
      ALREADY_ONBOARDED_TEXT,
    );
    expect(
      runPaqadCommand({ ...base, args: 'status', standDown: 'not-onboarded' }).onboard,
    ).toBeUndefined();
  });

  it('FR-2: Claude Code and the allow list start ticked, and every row starts with its text', () => {
    const rows = trayRows(initialTray(true));
    expect(rows.find((row) => row.key === 'claude-code')?.ticked).toBe(true);
    expect(rows.find((row) => row.key === 'allow-list')?.ticked).toBe(true);
    expect(rows.filter((row) => row.ticked).map((row) => row.key)).toEqual([
      'claude-code',
      'allow-list',
    ]);
    for (const row of rows) expect(row.text.length).toBeGreaterThan(0);
  });

  it('AC-15: with no tool ticked Start shows "Tick at least one AI tool"', () => {
    const none = toggleTray(initialTray(true), 'claude-code');
    expect(startBlockedText(none)).toBe(NONE_TICKED_WORDS);
    expect(traySubmitText(none, 's-1')).toBeNull();
  });

  it('AC-15: a tool that needs npm is marked and announced as unavailable, and cannot be ticked', () => {
    const state = initialTray(false);
    const codex = trayRows(state).find((row) => row.key === 'codex-cli');
    expect(codex?.available).toBe(false);
    expect(codex?.text).toBe('– Codex · needs npm');
    expect(codex?.label).toBe('Codex, unavailable: needs npm');
    expect(toggleTray(state, 'codex-cli')).toEqual(state);
  });

  it('FR-2 FR-7: submits the tray answer with the session and the allow list', () => {
    const state = toggleTray(initialTray(true), 'codex-cli');
    expect(traySubmitText(state, 's-1')).toBe(
      '/paqad:onboard claude-code,codex-cli --session s-1 --allow-list yes',
    );
    expect(traySubmitText(toggleTray(state, 'allow-list'), 's-1')).toContain('--allow-list no');
  });

  it('NFR-4: the onboard skill asks one question, never the stack, and hands off to the journey loop', () => {
    const text = readFileSync(
      join(process.cwd(), 'runtime/claude-plugin/skills/onboard/SKILL.md'),
      'utf8',
    );
    expect(text).toContain('Never ask for the stack');
    expect(text).toContain('paqad-ai onboarding resume');
    expect(text).toContain('`onboarding-journey` skill');
    expect(text).not.toContain('paqad-ai onboarding stage start');
  });
});
