import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { renderVerdictText } from '@/cli/commands/status.js';
import { hudVerdictPath } from '@/hud/files.js';
import * as receipt from '@/hud/receipt-file.js';
import { buildHudSnapshot } from '@/hud/snapshot.js';

import { cleanupScopeFixtures, openChangeHere, repoRoot, runStage } from '../hud/scope-fixtures.js';
import {
  checkVerdictAgreement,
  decideVerdictAgreement,
  finalMessageFromStdin,
  lastAssistantText,
  verdictWordIn,
} from '../../../runtime/hooks/lib/verdict-agreement.mjs';

const FIXTURE = join(process.cwd(), 'tests/fixtures/hud/closed-run/verdict.json');
const SESSION = 'ses-closed-run';
const WORDS = receipt.HUD_VERDICT_WORDS;
const { NO_VERDICT_RECORD } = receipt;
let root: string;
let logged: string[];

const api = {
  HUD_VERDICT_WORDS: receipt.HUD_VERDICT_WORDS,
  verdictSessionId: receipt.verdictSessionId,
  readHudVerdict: receipt.readHudVerdict,
  readVerdictAgreement: receipt.readVerdictAgreement,
  writeVerdictAgreement: receipt.writeVerdictAgreement,
};

function stop(message: string, extra: Record<string, unknown> = {}) {
  return checkVerdictAgreement({
    api,
    projectRoot: root,
    stdin: JSON.stringify({
      session_id: SESSION,
      hook_event_name: 'Stop',
      last_assistant_message: message,
      ...extra,
    }),
    hostSessionId: SESSION,
    loopActive: extra.stop_hook_active === true,
    log: (note: string) => logged.push(note),
  });
}

function installVerdict(): void {
  const path = hudVerdictPath(root, SESSION);
  mkdirSync(dirname(path), { recursive: true });
  copyFileSync(FIXTURE, path);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'verdict-agreement-'));
  logged = [];
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  cleanupScopeFixtures();
});

describe('AC-6: the closing message and the verdict record tell one story', () => {
  it("the receipt's first word comes from status --verdict, which reads the file", () => {
    installVerdict();
    const word = renderVerdictText(receipt.readHudVerdict(root, SESSION)).split('\n')[0];
    expect(word).toBe(JSON.parse(readFileSync(FIXTURE, 'utf8')).word);
    expect(word).toBe('Inconclusive');
  });

  it('a main-thread "Safe to merge" is held once, naming Inconclusive and its reasons', () => {
    installVerdict();
    const held = stop('Safe to merge. All six stages ran.');
    expect(held).toMatchObject({ decision: 'block' });
    expect(held!.reason).toContain('Inconclusive');
    expect(held!.reason).toContain('code-tests-lint: No checks report on record');
    expect(held!.reason).toContain('paqad-ai status --verdict');
    expect(stop('Safe to merge. All six stages ran.')).toBeNull();
    expect(stop('Safe to merge again.', { stop_hook_active: false })).toBeNull();
  });

  it('a message that carries the matching word is never held', () => {
    installVerdict();
    expect(stop('Inconclusive. No checks report on record.')).toBeNull();
    expect(stop('Safe to merge.')).toMatchObject({ decision: 'block' });
  });

  it('a stop while the hook loop is already active is let through', () => {
    installVerdict();
    expect(stop('Safe to merge.', { stop_hook_active: true })).toBeNull();
  });

  it('a stage helper stop is never checked', () => {
    installVerdict();
    expect(stop('Safe to merge.', { agent_id: 'agent-checks' })).toBeNull();
    expect(stop('Safe to merge.', { hook_event_name: 'SubagentStop' })).toBeNull();
    expect(stop('Safe to merge.')).toMatchObject({ decision: 'block' });
  });

  it('a message with no verdict word is never held', () => {
    installVerdict();
    expect(stop('I updated the docs.')).toBeNull();
  });
});

describe('AC-16: a missing or unreadable verdict record lets the stop through', () => {
  it('lets a missing record through, logs why, and the band shows no verdict record', () => {
    expect(stop('Safe to merge.')).toBeNull();
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain('no verdict record at');
    expect(receipt.readVerdictAgreement(root, SESSION).no_record).not.toBeNull();
  });

  it('lets an unreadable record through and logs why', () => {
    const path = hudVerdictPath(root, SESSION);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, '{broken', 'utf8');
    expect(stop('Safe to merge.')).toBeNull();
    expect(logged[0]).toContain('not valid JSON');
  });

  it('a record that appears later clears the no-record note', () => {
    stop('Safe to merge.');
    installVerdict();
    expect(stop('Inconclusive.')).toBeNull();
    expect(receipt.readVerdictAgreement(root, SESSION).no_record).toBeNull();
  });

  it('the band shows no verdict record once the stop is let through', () => {
    const repo = repoRoot();
    openChangeHere(repo, SESSION);
    runStage(repo, SESSION, 'planning');
    expect(buildHudSnapshot(repo, SESSION).record_gaps ?? []).not.toContain(NO_VERDICT_RECORD);
    root = repo;
    stop('Safe to merge.');
    expect(existsSync(hudVerdictPath(repo, SESSION))).toBe(false);
    const snapshot = buildHudSnapshot(repo, SESSION);
    expect(snapshot.verdict).toBeNull();
    expect(snapshot.record_gaps).toContain(NO_VERDICT_RECORD);
  });
});

describe('the verdict word and the final message', () => {
  it('finds the earliest verdict word as a whole phrase', () => {
    expect(verdictWordIn('Inconclusive, not Safe to merge', WORDS)).toBe('Inconclusive');
    expect(verdictWordIn('**Safe to merge**', WORDS)).toBe('Safe to merge');
    expect(verdictWordIn('nothing here', WORDS)).toBeNull();
    expect(verdictWordIn('Inconclusively', WORDS)).toBeNull();
  });

  it('reads the final message from the payload or the last assistant line of the transcript', () => {
    expect(finalMessageFromStdin(JSON.stringify({ last_assistant_message: 'hi' }))).toBe('hi');
    const transcript = [
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'one' }] } }),
      JSON.stringify({ type: 'user', message: { content: 'go' } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'two' }] } }),
    ].join('\n');
    expect(lastAssistantText(transcript)).toBe('two');
    const path = join(root, 't.jsonl');
    writeFileSync(path, transcript, 'utf8');
    expect(finalMessageFromStdin(JSON.stringify({ transcript_path: path }))).toBe('two');
    expect(finalMessageFromStdin('not json')).toBe('');
  });

  it('decides without touching the disk', () => {
    const reading = { status: 'missing', path: 'x', why: 'no verdict record at x' } as const;
    const state = { blocked_changes: [], no_record: null };
    const base = { subagent: false, loopActive: false, words: WORDS, reading, state };
    expect(decideVerdictAgreement({ ...base, message: 'Safe to merge' }).kind).toBe('no-record');
    expect(decideVerdictAgreement({ ...base, message: 'done' }).kind).toBe('skip');
  });
});
