import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createReportCommand } from '@/cli/commands/report.js';
import { INJECTED_MARKERS, INJECTED_SCAN_CHARS, isInjectedText } from '@/speed-report/classify.js';
import { projectTranscriptSlug } from '@/speed-report/transcripts.js';

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

interface PinnedRow {
  change: string;
  busy_ms: number;
  development_ms: number;
  ceremony_ms: number;
  orchestrator_ms: number;
  other_agents_ms: number;
  owner_wait_ms: number;
}

const PINNED: PinnedRow[] = [
  {
    change: '01M5DC6C8R1KBH145FZ8HS1VTC',
    busy_ms: 3_848_185,
    development_ms: 1_836_521,
    ceremony_ms: 1_754_320,
    orchestrator_ms: 257_344,
    other_agents_ms: 0,
    owner_wait_ms: 1_172_983,
  },
  {
    change: '01M5XRN9CWF9RDTNFC1A21A0SV',
    busy_ms: 4_468_203,
    development_ms: 1_376_777,
    ceremony_ms: 2_640_000,
    orchestrator_ms: 451_426,
    other_agents_ms: 0,
    owner_wait_ms: 14_712_202,
  },
  {
    change: '01M5DHQYW9J0Y7ZGF6QN0E34GE',
    busy_ms: 7_737_487,
    development_ms: 4_415_380,
    ceremony_ms: 3_121_760,
    orchestrator_ms: 200_347,
    other_agents_ms: 0,
    owner_wait_ms: 12_457_530,
  },
];

function fixtureProject(): { projectRoot: string; transcriptsRoot: string } {
  const root = mkdtempSync(join(tmpdir(), 'paqad-speed-fixture-'));
  const projectRoot = join(root, 'project');
  const transcriptsRoot = join(root, 'projects');
  mkdirSync(join(projectRoot, '.paqad/ledger'), { recursive: true });
  cpSync(join(FIXTURE, 'ledger'), join(projectRoot, '.paqad/ledger/feature-evidence'), {
    recursive: true,
  });
  cpSync(join(FIXTURE, 'transcripts'), join(transcriptsRoot, projectTranscriptSlug(projectRoot)), {
    recursive: true,
  });
  return { projectRoot, transcriptsRoot };
}

describe('speed report on the fixture', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('AC-1: report speed --json gives the pinned true-union numbers for all three changes', async () => {
    const { projectRoot, transcriptsRoot } = fixtureProject();
    const out: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line?: unknown) => out.push(String(line)));
    await createReportCommand().parseAsync(
      ['speed', '--json', '--project-root', projectRoot, '--transcripts-root', transcriptsRoot],
      { from: 'user' },
    );
    const report = JSON.parse(out.join('\n')) as { changes: Array<PinnedRow & { status: string }> };
    const rows = [...report.changes].sort((a, b) => a.change.localeCompare(b.change));
    expect(rows.map((row) => row.status)).toEqual(['measured', 'measured', 'measured']);
    const pinned = [...PINNED].sort((a, b) => a.change.localeCompare(b.change));
    expect(
      rows.map((row) => ({
        change: row.change,
        busy_ms: row.busy_ms,
        development_ms: row.development_ms,
        ceremony_ms: row.ceremony_ms,
        orchestrator_ms: row.orchestrator_ms,
        other_agents_ms: row.other_agents_ms,
        owner_wait_ms: row.owner_wait_ms,
      })),
    ).toEqual(pinned);
    for (const row of rows) {
      expect(row.development_ms + row.ceremony_ms + row.orchestrator_ms + row.other_agents_ms).toBe(
        row.busy_ms,
      );
    }
  });
});
