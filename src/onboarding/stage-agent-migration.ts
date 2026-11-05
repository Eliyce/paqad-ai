import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  ftruncateSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  writeSync,
  type Dirent,
} from 'node:fs';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import {
  STAGE_AGENT_MARKER,
  renderStageAgentFiles,
  withManagedMarker,
} from '@/stage-isolation/agent-writer.js';

import { PAST_RELEASE_STAGE_AGENT_BODY_HASHES } from './stage-agent-past-bodies.js';

export const PROJECT_AGENTS_DIR = '.claude/agents';
const LEGACY_STAMP = /^<!-- written by paqad-ai \S+ -->$/u;
const STAGE_AGENT_FILE = /^paqad-[a-z0-9-]+\.md$/u;

export interface StageAgentMigration {
  removed: string[];
  kept: string[];
}

export interface RemovedStageAgent {
  path: string;
  reason: 'managed-marker' | 'legacy-stamp' | 'generated-body';
}

function bodyStart(lines: readonly string[]): number {
  if (lines[0] !== '---') return 0;
  const close = lines.indexOf('---', 1);
  return close < 0 ? 0 : close + 1;
}

export function carriesManagedMarker(content: string): boolean {
  const lines = content.split('\n');
  return lines[0] === STAGE_AGENT_MARKER || lines[bodyStart(lines)] === STAGE_AGENT_MARKER;
}

function stripLegacyStamp(content: string): string | null {
  const lines = content.trimEnd().split('\n');
  if (!LEGACY_STAMP.test(lines[lines.length - 1] ?? '')) return null;
  return lines.slice(0, -1).join('\n');
}

export function stageAgentBodyHash(body: string): string {
  return createHash('sha256').update(body.trimEnd()).digest('hex');
}

export function knownGeneratedBodies(): Set<string> {
  const hashes = new Set<string>(PAST_RELEASE_STAGE_AGENT_BODY_HASHES);
  for (const { content } of renderStageAgentFiles('claude-code')) {
    hashes.add(stageAgentBodyHash(content));
    hashes.add(stageAgentBodyHash(withManagedMarker(content)));
  }
  return hashes;
}

function removalReason(
  content: string,
  known: ReadonlySet<string>,
): RemovedStageAgent['reason'] | null {
  if (carriesManagedMarker(content)) return 'managed-marker';
  const unstamped = stripLegacyStamp(content);
  if (unstamped !== null) return known.has(stageAgentBodyHash(unstamped)) ? 'legacy-stamp' : null;
  if (known.has(stageAgentBodyHash(content))) return 'generated-body';
  return null;
}

export function migrateProjectStageAgents(
  projectRoot: string,
  known: ReadonlySet<string> = knownGeneratedBodies(),
): StageAgentMigration {
  const result: StageAgentMigration = { removed: [], kept: [] };
  const dir = join(projectRoot, PROJECT_AGENTS_DIR);
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true }).filter((entry) =>
      STAGE_AGENT_FILE.test(entry.name),
    );
  } catch {
    return result;
  }
  const removed: RemovedStageAgent[] = [];
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const name = entry.name;
    const rel = `${PROJECT_AGENTS_DIR}/${name}`;
    if (!entry.isFile()) {
      result.kept.push(rel);
      continue;
    }
    let content: string;
    try {
      content = readFileSync(join(dir, name), 'utf8');
    } catch {
      continue;
    }
    const reason = removalReason(content, known);
    if (reason === null) {
      result.kept.push(rel);
      continue;
    }
    rmSync(join(dir, name), { force: true });
    result.removed.push(rel);
    removed.push({ path: rel, reason });
  }
  if (removed.length > 0) recordRemovedStageAgents(projectRoot, removed);
  return result;
}

export function isGeneratedProjectStageAgent(path: string, content: string): boolean {
  const name = path.replaceAll('\\', '/').split('/').pop();
  return renderStageAgentFiles('claude-code').some(
    (agent) => agent.name === name && withManagedMarker(agent.content) === content,
  );
}

type SyncOutcome = 'same' | 'kept' | 'written';

function noFollowFlag(): number {
  return constants.O_NOFOLLOW ?? 0;
}

function createAgentFile(target: string, wanted: string): SyncOutcome {
  let fd: number;
  try {
    fd = openSync(
      target,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollowFlag(),
    );
  } catch {
    return 'kept';
  }
  try {
    writeSync(fd, wanted, 0, 'utf8');
  } finally {
    closeSync(fd);
  }
  return 'written';
}

function syncAgentFile(target: string, wanted: string, known: ReadonlySet<string>): SyncOutcome {
  let fd: number;
  try {
    fd = openSync(target, constants.O_RDWR | noFollowFlag());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return createAgentFile(target, wanted);
    return 'kept';
  }
  try {
    if (!fstatSync(fd).isFile() || lstatSync(target).isSymbolicLink()) return 'kept';
    const existing = readFileSync(fd, 'utf8');
    if (existing === wanted) return 'same';
    if (removalReason(existing, known) === null) return 'kept';
    ftruncateSync(fd, 0);
    writeSync(fd, wanted, 0, 'utf8');
    return 'written';
  } finally {
    closeSync(fd);
  }
}

export function syncProjectStageAgents(
  projectRoot: string,
  known: ReadonlySet<string> = knownGeneratedBodies(),
): { written: string[]; kept: string[] } {
  const result = { written: [] as string[], kept: [] as string[] };
  const dir = join(projectRoot, PROJECT_AGENTS_DIR);
  mkdirSync(dir, { recursive: true });
  for (const { name, content } of renderStageAgentFiles('claude-code')) {
    const rel = `${PROJECT_AGENTS_DIR}/${name}`;
    const outcome = syncAgentFile(join(dir, name), withManagedMarker(content), known);
    if (outcome === 'written') result.written.push(rel);
    if (outcome === 'kept') result.kept.push(rel);
  }
  return result;
}

export function recordRemovedStageAgents(
  projectRoot: string,
  removed: readonly RemovedStageAgent[],
): void {
  const path = join(projectRoot, PATHS.ONBOARDING_MANIFEST);
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch {
    return;
  }
  const prior = Array.isArray(manifest.removed_stage_agents)
    ? (manifest.removed_stage_agents as RemovedStageAgent[])
    : [];
  const byPath = new Map(prior.map((entry) => [entry.path, entry]));
  for (const entry of removed) byPath.set(entry.path, entry);
  manifest.removed_stage_agents = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}
