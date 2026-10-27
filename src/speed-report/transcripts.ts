import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';

import { readCostCache } from '@/cost/change-cost.js';
import { scanTranscriptLines } from '@/cost/transcript-usage.js';
import { rowRecordedAt } from '@/feature-evidence/envelope.js';
import { listFeatureDirs } from '@/feature-evidence/enumerate.js';
import { readFeatureRecord } from '@/feature-evidence/feature-record.js';
import { parseFeatureDirName } from '@/feature-evidence/paths.js';
import { readFeatureStageUnit, resolveFeatureRef } from '@/feature-evidence/stage-ledger.js';
import { hudCostCachePath } from '@/hud/files.js';
import { claudeConfigDir } from '@/install/plugin-migration.js';

import {
  AGENT_TOOL,
  ASK_USER_TOOL,
  CATEGORY,
  OWNER_CATEGORY,
  WINDOW_PAD_MS,
  classifyUserRecord,
  countsTowardSize,
  isEditTool,
  isOutsidePaqadDir,
  isThinkingGap,
  keepsToolInterval,
  lineCount,
  ownerGapCategory,
  refusalLabel,
  roleForAgentType,
  testRunKind,
  toolCategory,
  type AgentRole,
  type BusyCategory,
  type OwnerCategory,
  type RefusalLabel,
  type TestRunKind,
} from './classify.js';

export const HOUSEKEEPING_SESSION = 'paqad-housekeeping';

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

export function isSafeId(value: string): boolean {
  return SAFE_ID.test(value);
}

export interface TranscriptRootOptions {
  transcriptsRoot?: string;
  env?: NodeJS.ProcessEnv;
  home?: string;
}

export function resolveTranscriptsRoot(options: TranscriptRootOptions = {}): string {
  if (options.transcriptsRoot) return resolve(options.transcriptsRoot);
  const configDir = claudeConfigDir(options.home ?? homedir(), options.env ?? process.env);
  return resolve(configDir, 'projects');
}

export function projectTranscriptSlug(projectRoot: string): string {
  return resolve(projectRoot).replace(/[\\/:._ ]/g, '-');
}

export interface ChangeWindow {
  start: number;
  end: number;
}

export interface LedgerChange {
  dirName: string;
  change: string;
  title: string;
  lane: string;
  window: ChangeWindow | null;
  sessions: string[];
}

function readLedgerChange(projectRoot: string, dirName: string): LedgerChange {
  const record = readFeatureRecord(projectRoot, dirName);
  const parts = parseFeatureDirName(dirName);
  const stamps: number[] = [];
  const sessions = new Set<string>();
  for (const row of readFeatureStageUnit(projectRoot, dirName)) {
    const recordedAt = rowRecordedAt(row);
    const at = recordedAt === null ? Number.NaN : Date.parse(recordedAt);
    if (Number.isNaN(at)) continue;
    stamps.push(at);
    if (row.session_id !== HOUSEKEEPING_SESSION) sessions.add(row.session_id);
  }
  const window =
    stamps.length === 0
      ? null
      : {
          start: Math.min(...stamps) - WINDOW_PAD_MS,
          end: Math.max(...stamps) + WINDOW_PAD_MS,
        };
  return {
    dirName,
    change: record?.change ?? parts?.ulid ?? dirName,
    title: record?.title ?? parts?.slug ?? dirName,
    lane: record?.lane ?? 'unknown',
    window,
    sessions: [...sessions].sort(),
  };
}

export function readLedgerChanges(
  projectRoot: string,
  dirNames?: readonly string[],
): LedgerChange[] {
  const names = dirNames ?? listFeatureDirs(projectRoot);
  return names.filter(isSafeId).map((dirName) => readLedgerChange(projectRoot, dirName));
}

export function resolveChangeDir(projectRoot: string, ref: string): string | null {
  const needle = ref.trim().replace(/^#/, '');
  if (!isSafeId(needle)) return null;
  return resolveFeatureRef(projectRoot, '', needle);
}

export interface TranscriptSource {
  path: string;
  agentType: string | null;
}

function isInside(root: string, path: string): boolean {
  const resolved = resolve(path);
  return resolved.startsWith(root.endsWith(sep) ? root : root + sep);
}

function readAgentType(metaPath: string): string | null {
  try {
    const parsed = JSON.parse(readFileSync(metaPath, 'utf8')) as { agentType?: unknown };
    return typeof parsed.agentType === 'string' ? parsed.agentType : null;
  } catch {
    return null;
  }
}

function recordedSources(projectRoot: string, sessionId: string, root: string): TranscriptSource[] {
  const cache = readCostCache(hudCostCachePath(projectRoot, sessionId), sessionId);
  return Object.entries(cache.sources)
    .filter(([path]) => isInside(root, path) && existsSync(path))
    .map(([path, source]) => ({
      path: resolve(path),
      agentType: source.kind === 'main' ? null : source.agent_type,
    }));
}

function derivedSources(sessionDir: string, sessionId: string): TranscriptSource[] {
  const sources: TranscriptSource[] = [];
  const main = join(sessionDir, `${sessionId}.jsonl`);
  if (existsSync(main)) sources.push({ path: main, agentType: null });
  const subagents = join(sessionDir, sessionId, 'subagents');
  if (!existsSync(subagents)) return sources;
  for (const name of readdirSync(subagents).sort()) {
    if (!name.startsWith('agent-') || !name.endsWith('.jsonl')) continue;
    const meta = join(subagents, `${name.slice(0, -'.jsonl'.length)}.meta.json`);
    sources.push({ path: join(subagents, name), agentType: readAgentType(meta) });
  }
  return sources;
}

export function sessionTranscripts(
  projectRoot: string,
  sessionId: string,
  transcriptsRoot: string,
): TranscriptSource[] {
  if (!isSafeId(sessionId)) return [];
  const root = resolve(transcriptsRoot);
  const sessionDir = join(root, projectTranscriptSlug(projectRoot));
  const byPath = new Map<string, TranscriptSource>();
  for (const source of recordedSources(projectRoot, sessionId, root)) {
    byPath.set(source.path, source);
  }
  for (const source of derivedSources(sessionDir, sessionId)) {
    if (!byPath.has(source.path)) byPath.set(source.path, source);
  }
  return [...byPath.values()];
}

export interface BusySpan {
  start: number;
  end: number;
  category: BusyCategory;
}

export interface OwnerSpan {
  start: number;
  end: number;
  category: OwnerCategory;
}

export interface EditCall {
  start: number;
  end: number;
  refused: RefusalLabel | null;
  filePath: string | null;
  lines: number;
}

export interface TestRun {
  at: number;
  kind: TestRunKind;
}

export interface TranscriptTimeline {
  role: AgentRole;
  busy: BusySpan[];
  owner: OwnerSpan[];
  edits: EditCall[];
  testRuns: TestRun[];
  badLines: number;
}

interface PendingTool {
  start: number;
  name: string;
  category: BusyCategory;
  sizedPath: string | null;
  lines: number;
}

interface ContentBlock {
  type?: unknown;
  id?: unknown;
  name?: unknown;
  input?: unknown;
  tool_use_id?: unknown;
  is_error?: unknown;
  content?: unknown;
  text?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function blocksOf(content: unknown): ContentBlock[] {
  return Array.isArray(content)
    ? content.filter((block): block is ContentBlock => asRecord(block) !== null)
    : [];
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  return blocksOf(content)
    .map((block) => (typeof block.text === 'string' ? block.text : ''))
    .join('\n');
}

function writtenText(name: string, input: Record<string, unknown>): string {
  const value = name === 'Write' ? input.content : input.new_string;
  return typeof value === 'string' ? value : '';
}

function pendingTool(start: number, name: string, input: Record<string, unknown>): PendingTool {
  const filePath = typeof input.file_path === 'string' ? input.file_path : null;
  const sized = countsTowardSize(name) && filePath !== null && isOutsidePaqadDir(filePath);
  return {
    start,
    name,
    category: toolCategory(name, input),
    sizedPath: sized ? filePath : null,
    lines: sized ? lineCount(writtenText(name, input)) : 0,
  };
}

class TimelineBuilder {
  readonly timeline: TranscriptTimeline;
  private readonly pending = new Map<string, PendingTool>();
  private lastAt: number | null = null;
  private anchor: number | null = null;

  constructor(role: AgentRole) {
    this.timeline = { role, busy: [], owner: [], edits: [], testRuns: [], badLines: 0 };
  }

  fold(event: unknown): void {
    const record = asRecord(event);
    if (!record || (record.type !== 'assistant' && record.type !== 'user')) return;
    const at = typeof record.timestamp === 'string' ? Date.parse(record.timestamp) : Number.NaN;
    if (Number.isNaN(at)) return;
    const content = asRecord(record.message)?.content;
    if (record.type === 'assistant') this.assistant(at, content);
    else this.user(at, content);
    this.lastAt = at;
  }

  private assistant(at: number, content: unknown): void {
    if (this.anchor !== null && isThinkingGap(at - this.anchor)) {
      this.timeline.busy.push({ start: this.anchor, end: at, category: CATEGORY.thinking });
    }
    this.anchor = null;
    for (const block of blocksOf(content)) {
      if (block.type !== 'tool_use' || typeof block.id !== 'string') continue;
      if (typeof block.name !== 'string') continue;
      const input = asRecord(block.input) ?? {};
      this.pending.set(block.id, pendingTool(at, block.name, input));
      const kind = block.name === 'Bash' ? bashTestRun(input) : null;
      if (kind !== null) this.timeline.testRuns.push({ at, kind });
    }
  }

  private user(at: number, content: unknown): void {
    const results = blocksOf(content).filter((block) => block.type === 'tool_result');
    const kind = classifyUserRecord(results.length > 0, textOf(content));
    if (kind === 'tool-result') {
      for (const block of results) this.close(at, block);
    } else if (kind === 'human' && this.lastAt !== null && at > this.lastAt) {
      this.timeline.owner.push({
        start: this.lastAt,
        end: at,
        category: ownerGapCategory(at - this.lastAt),
      });
    }
    this.anchor = at;
  }

  private close(at: number, block: ContentBlock): void {
    if (typeof block.tool_use_id !== 'string') return;
    const tool = this.pending.get(block.tool_use_id);
    if (!tool) return;
    this.pending.delete(block.tool_use_id);
    if (tool.name === AGENT_TOOL || !keepsToolInterval(at - tool.start)) return;
    if (tool.name === ASK_USER_TOOL) {
      this.timeline.owner.push({ start: tool.start, end: at, category: OWNER_CATEGORY.answering });
      return;
    }
    if (!isEditTool(tool.name)) {
      this.timeline.busy.push({ start: tool.start, end: at, category: tool.category });
      return;
    }
    const isError = block.is_error === true;
    const refused = refusalLabel(isError, isError ? textOf(block.content) : '');
    this.timeline.busy.push({ start: tool.start, end: at, category: refused ?? tool.category });
    this.timeline.edits.push({
      start: tool.start,
      end: at,
      refused,
      filePath: isError ? null : tool.sizedPath,
      lines: isError ? 0 : tool.lines,
    });
  }
}

function bashTestRun(input: Record<string, unknown>): TestRunKind | null {
  return typeof input.command === 'string' ? testRunKind(input.command) : null;
}

export function readTranscriptTimeline(source: TranscriptSource): TranscriptTimeline | null {
  const builder = new TimelineBuilder(roleForAgentType(source.agentType));
  try {
    const scan = scanTranscriptLines(source.path, (event) => builder.fold(event));
    builder.timeline.badLines = scan.badLines;
  } catch {
    return null;
  }
  return builder.timeline;
}
