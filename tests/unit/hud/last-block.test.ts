import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { hudLastBlockPath } from '@/hud/files.js';
import {
  clearRuleStopRecord,
  LAST_BLOCK_DIFF_MAX_BYTES,
  markRuleStopAllowedOnce,
  parseRuleStopRecord,
  readRuleStopRecord,
  shortDiff,
  takeAllowedOnce,
  truncateUtf8,
  writeRuleStopRecord,
} from '@/hud/last-block.js';

const NOW = () => new Date('2026-10-20T10:00:00.000Z');
const roots: string[] = [];
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function root(): string {
  const dir = mkdtempSync(join(tmpdir(), 'paqad-last-block-'));
  roots.push(dir);
  return dir;
}

describe('shortDiff', () => {
  it('renders an Edit as removed then added lines', () => {
    expect(shortDiff({ old_string: 'a\nb', new_string: 'c' })).toBe('- a\n- b\n+ c');
  });

  it('renders every edit of a multi-edit', () => {
    expect(
      shortDiff({
        edits: [
          { old_string: 'a', new_string: 'b' },
          { old_string: 'c', new_string: 'd' },
        ],
      }),
    ).toBe('- a\n+ b\n- c\n+ d');
  });

  it('renders a Write and a notebook edit as added lines', () => {
    expect(shortDiff({ content: 'x\r\ny' })).toBe('+ x\n+ y');
    expect(shortDiff({ new_source: 'print(1)' })).toBe('+ print(1)');
  });

  it('is empty for a missing or odd tool input', () => {
    expect(shortDiff(undefined)).toBe('');
    expect(shortDiff('text')).toBe('');
    expect(shortDiff({ edits: [null, 3] })).toBe('');
  });

  it('caps the diff at 2 KB without splitting a character', () => {
    const diff = shortDiff({ content: 'é'.repeat(5000) });
    expect(Buffer.byteLength(diff, 'utf8')).toBeLessThanOrEqual(LAST_BLOCK_DIFF_MAX_BYTES);
    expect(diff.endsWith('�')).toBe(false);
    expect(truncateUtf8('abc', 10)).toBe('abc');
    expect(truncateUtf8('aéb', 2)).toBe('a');
  });
});

describe('rule-stop record', () => {
  it('AC-12: writes, reads back and marks the token used and allowed once', () => {
    const dir = root();
    const record = writeRuleStopRecord({
      projectRoot: dir,
      sessionId: 's1',
      rule: 'RL-1',
      title: 'No comments',
      file: 'src/x.ts',
      toolUseId: 'tu_1',
      managed: true,
      sole: true,
      toolInput: { content: 'x' },
      now: NOW,
    });
    expect(record).toMatchObject({
      rule: 'RL-1',
      title: 'No comments',
      file: 'src/x.ts',
      tool_use_id: 'tu_1',
      managed: true,
      sole: true,
      at: '2026-10-20T10:00:00.000Z',
      diff: '+ x',
      used: false,
      allowed_once: false,
      session: 's1',
    });
    expect(record.token).toMatch(/^[0-9a-f]{32}$/);
    expect(readRuleStopRecord(dir, 's1')).toEqual(record);
    markRuleStopAllowedOnce(dir, record);
    expect(readRuleStopRecord(dir, 's1')).toEqual({ ...record, used: true, allowed_once: true });
    clearRuleStopRecord(dir, 's1');
    expect(existsSync(hudLastBlockPath(dir, 's1'))).toBe(false);
    expect(readRuleStopRecord(dir, 's1')).toBeNull();
  });

  it('mints a fresh token for every stop', () => {
    const dir = root();
    const input = { projectRoot: dir, sessionId: 's', rule: 'R', file: 'f', managed: false };
    expect(writeRuleStopRecord(input).token).not.toBe(writeRuleStopRecord(input).token);
    expect(writeRuleStopRecord(input).sole).toBe(false);
  });

  it('ignores a record that belongs to another session or does not parse', () => {
    const dir = root();
    const path = hudLastBlockPath(dir, 's2');
    mkdirSync(join(dir, '.paqad/session/hud'), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({ rule: 'R', file: 'f', at: 'x', token: 't', session: 'other' }),
    );
    expect(readRuleStopRecord(dir, 's2')).toBeNull();
    writeFileSync(path, '{not json');
    expect(readRuleStopRecord(dir, 's2')).toBeNull();
  });

  it('parses only a complete record and defaults the optional fields', () => {
    expect(parseRuleStopRecord(null)).toBeNull();
    expect(parseRuleStopRecord({ rule: 'R', file: 'f', at: 'x', token: 't' })).toBeNull();
    expect(
      parseRuleStopRecord({ rule: 'R', file: 'f', at: 'x', token: 't', session: 's', diff: 3 }),
    ).toEqual({
      rule: 'R',
      title: null,
      file: 'f',
      tool_use_id: null,
      managed: false,
      sole: false,
      at: 'x',
      diff: '',
      token: 't',
      used: false,
      allowed_once: false,
      session: 's',
    });
  });

  it('AC-9: reads a record written before allowed_once existed as not allowed', () => {
    expect(
      parseRuleStopRecord({ rule: 'R', file: 'f', at: 'x', token: 't', session: 's', used: true })
        ?.allowed_once,
    ).toBe(false);
  });
});

describe('takeAllowedOnce', () => {
  const CALL = { toolUseId: 'tu_1', rule: 'RL-1', file: 'src/x.ts' };

  function marked(dir: string) {
    const record = writeRuleStopRecord({
      projectRoot: dir,
      sessionId: 's1',
      rule: 'RL-1',
      file: 'src/x.ts',
      toolUseId: 'tu_1',
      managed: false,
      sole: true,
      now: NOW,
    });
    markRuleStopAllowedOnce(dir, record);
    return record;
  }

  const onDisk = (dir: string) => readFileSync(hudLastBlockPath(dir, 's1'), 'utf8');

  it('AC-7: a matching call consumes the mark once and keeps the token', () => {
    const dir = root();
    const record = marked(dir);
    expect(takeAllowedOnce(dir, 's1', { ...CALL, file: join(dir, 'src/x.ts') })).toBe(true);
    expect(readRuleStopRecord(dir, 's1')).toEqual({ ...record, used: true, allowed_once: false });
    expect(takeAllowedOnce(dir, 's1', CALL)).toBe(false);
  });

  it('AC-8: another tool_use_id, rule or file, or no tool_use_id, leaves the mark on disk', () => {
    const dir = root();
    marked(dir);
    const before = onDisk(dir);
    for (const call of [
      { ...CALL, toolUseId: 'tu_0' },
      { ...CALL, toolUseId: '' },
      { ...CALL, toolUseId: null },
      { ...CALL, toolUseId: undefined },
      { ...CALL, rule: 'RL-2' },
      { ...CALL, file: 'src/y.ts' },
      { ...CALL, file: '../outside.ts' },
    ]) {
      expect(takeAllowedOnce(dir, 's1', call)).toBe(false);
    }
    expect(onDisk(dir)).toBe(before);
    expect(takeAllowedOnce(dir, 'other', CALL)).toBe(false);
    expect(onDisk(dir)).toBe(before);
  });

  it('AC-9: an unmarked, missing or garbled record answers false and is left alone', () => {
    const dir = root();
    expect(takeAllowedOnce(dir, 's1', CALL)).toBe(false);
    writeRuleStopRecord({
      projectRoot: dir,
      sessionId: 's1',
      rule: 'RL-1',
      file: 'src/x.ts',
      toolUseId: 'tu_1',
      managed: false,
    });
    const unmarked = onDisk(dir);
    expect(takeAllowedOnce(dir, 's1', CALL)).toBe(false);
    expect(onDisk(dir)).toBe(unmarked);
    writeFileSync(hudLastBlockPath(dir, 's1'), '{not json');
    expect(takeAllowedOnce(dir, 's1', CALL)).toBe(false);
    expect(onDisk(dir)).toBe('{not json');
  });

  it('AC-10: parallel reads for the same tool_use_id let at most one through', async () => {
    const dir = root();
    marked(dir);
    const taken = await Promise.all(
      Array.from({ length: 8 }, () =>
        Promise.resolve().then(() => takeAllowedOnce(dir, 's1', CALL)),
      ),
    );
    expect(taken.filter(Boolean)).toHaveLength(1);
    marked(dir);
    const other = await Promise.all([
      Promise.resolve().then(() => takeAllowedOnce(dir, 's1', { ...CALL, toolUseId: 'tu_2' })),
      Promise.resolve().then(() => takeAllowedOnce(dir, 's1', { ...CALL, toolUseId: 'tu_3' })),
    ]);
    expect(other).toEqual([false, false]);
  });
});
