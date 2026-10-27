import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import { INJECTED_MARKERS, INJECTED_SCAN_CHARS, isInjectedText } from '@/speed-report/classify.js';

const FIXTURE = join(process.cwd(), 'tests/fixtures/speed-report');
const CHANGES = [
  '01M5DC6C8R1KBH145FZ8HS1VTC',
  '01M5XRN9CWF9RDTNFC1A21A0SV',
  '01M5DHQYW9J0Y7ZGF6QN0E34GE',
];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

interface Block {
  type: string;
  name?: string;
  input?: Record<string, unknown>;
  content?: unknown;
}

interface TranscriptRecord {
  type: string;
  timestamp: string;
  message: { content: string | Block[] };
}

function records(): TranscriptRecord[] {
  return files(join(FIXTURE, 'transcripts'))
    .filter((path) => path.endsWith('.jsonl'))
    .flatMap((path) =>
      readFileSync(path, 'utf8')
        .split('\n')
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as TranscriptRecord),
    );
}

function onlyX(text: string): boolean {
  return text.split('\n').every((line) => line === 'x');
}

describe('speed report fixture', () => {
  it('AC-2: holds the three bundles with their ledger rows', () => {
    const bundles = readdirSync(join(FIXTURE, 'ledger'));
    for (const change of CHANGES) {
      const dir = bundles.find((name) => name.endsWith(`-${change}`));
      expect(dir, change).toBeDefined();
      const rows = readFileSync(join(FIXTURE, 'ledger', dir!, 'stage-evidence.jsonl'), 'utf8');
      expect(rows.split('\n').filter(Boolean).length).toBeGreaterThan(10);
    }
  });

  it('AC-2: masks home folder names to x everywhere', () => {
    for (const path of files(FIXTURE)) {
      const text = readFileSync(path, 'utf8');
      for (const match of text.matchAll(/\/(Users|home)\/([^/\s"'\\]+)/g)) {
        expect(match[2], relative(FIXTURE, path)).toBe('x');
      }
      for (const match of text.matchAll(/-Users-([^-/\s"'\\]+)-/g)) {
        expect(match[1], relative(FIXTURE, path)).toBe('x');
      }
    }
  });

  it('AC-2: replaces prompts, tool results and written text with x lines', () => {
    const all = records();
    let prompts = 0;
    let injected = 0;
    let results = 0;
    let markers = 0;
    let commands = 0;
    for (const record of all) {
      const content = record.message.content;
      if (typeof content === 'string') {
        if (isInjectedText(content)) {
          injected += 1;
          expect(content.length).toBeLessThanOrEqual(INJECTED_SCAN_CHARS);
        } else {
          prompts += 1;
          expect(onlyX(content)).toBe(true);
        }
        continue;
      }
      for (const block of content) {
        if (block.type === 'tool_result') {
          results += 1;
          const [first, ...rest] = String(block.content).split('\n');
          expect(onlyX(rest.join('\n') || 'x')).toBe(true);
          if (first !== 'x') {
            markers += 1;
            expect(first).toMatch(
              /^(hook error|timed out|agent-entry)( (timed out|agent-entry))*$/,
            );
          }
        }
        if (block.type === 'tool_use') {
          const input = block.input ?? {};
          for (const key of ['new_string', 'content']) {
            if (typeof input[key] === 'string') expect(onlyX(input[key] as string)).toBe(true);
          }
          const allowed = new Set(['command', 'file_path', 'new_string', 'content']);
          for (const key of Object.keys(input)) expect(allowed.has(key), key).toBe(true);
          if (typeof input.command === 'string') commands += 1;
        }
      }
    }
    expect(prompts).toBeGreaterThan(0);
    expect(injected).toBeGreaterThan(0);
    expect(results).toBeGreaterThan(1000);
    expect(markers).toBeGreaterThan(0);
    expect(commands).toBeGreaterThan(100);
    expect(INJECTED_MARKERS.length).toBe(7);
  });

  it('AC-2: keeps the Bash command words and the cd prefix the classifier reads', () => {
    const commands = records()
      .flatMap((record) => (Array.isArray(record.message.content) ? record.message.content : []))
      .filter((block) => block.type === 'tool_use' && block.name === 'Bash')
      .map((block) => String(block.input?.command));
    expect(commands.some((command) => command.startsWith('cd "/Users/x/'))).toBe(true);
    expect(commands.some((command) => /paqad-ai checks run/.test(command))).toBe(true);
    expect(commands.some((command) => /vitest run tests\//.test(command))).toBe(true);
  });

  it('AC-2: keeps only the agent type in each subagent meta file', () => {
    const metas = files(join(FIXTURE, 'transcripts')).filter((path) => path.endsWith('.meta.json'));
    expect(metas.length).toBeGreaterThan(0);
    for (const path of metas) {
      expect(Object.keys(JSON.parse(readFileSync(path, 'utf8')) as object)).toEqual(['agentType']);
    }
  });
});
