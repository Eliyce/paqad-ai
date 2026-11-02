import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, rmSync, writeFileSync, type Dirent } from 'node:fs';
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
