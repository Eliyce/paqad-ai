import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import {
  STAGE_AGENT_MARKER,
  renderStageAgentFiles,
  withManagedMarker,
} from '@/stage-isolation/agent-writer.js';

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

function carriesLegacyStamp(content: string): boolean {
  const lines = content.trimEnd().split('\n');
  return LEGACY_STAMP.test(lines[lines.length - 1] ?? '');
}

export function knownGeneratedBodies(): Set<string> {
  const bodies = new Set<string>();
  for (const { content } of renderStageAgentFiles('claude-code')) {
    bodies.add(content.trimEnd());
    bodies.add(withManagedMarker(content).trimEnd());
  }
  return bodies;
}

function removalReason(
  content: string,
  known: ReadonlySet<string>,
): RemovedStageAgent['reason'] | null {
  if (carriesManagedMarker(content)) return 'managed-marker';
  if (carriesLegacyStamp(content)) return 'legacy-stamp';
  if (known.has(content.trimEnd())) return 'generated-body';
  return null;
}

export function migrateProjectStageAgents(
  projectRoot: string,
  known: ReadonlySet<string> = knownGeneratedBodies(),
): StageAgentMigration {
  const result: StageAgentMigration = { removed: [], kept: [] };
  const dir = join(projectRoot, PROJECT_AGENTS_DIR);
  let names: string[];
  try {
    names = readdirSync(dir).filter((name) => STAGE_AGENT_FILE.test(name));
  } catch {
    return result;
  }
  const removed: RemovedStageAgent[] = [];
  for (const name of names.sort()) {
    const rel = `${PROJECT_AGENTS_DIR}/${name}`;
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
  if (!existsSync(path)) return;
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
