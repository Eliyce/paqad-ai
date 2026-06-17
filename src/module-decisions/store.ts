// Read / write / list module decision YAML files under
// .paqad/decisions/module-decisions/. Issue #80, Phase 1.
//
// File naming: <MD-id>.yml. One decision per file. Issue #184: ids are now
// `MD-<ULID>` (collision-free, time-sortable) instead of a monotonic
// `MD-{XXXX}` ordinal, so two branches never mint the same id. Allocation no
// longer reads the directory.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import YAML from 'yaml';

import { PATHS } from '@/core/constants/paths.js';
import { ulid } from '@/core/ids/ulid.js';

import {
  isExpired,
  isValidDecisionId,
  type ModuleDecision,
  type ModuleDecisionState,
} from './schema.js';

function decisionsDir(projectRoot: string): string {
  return join(projectRoot, PATHS.PROSPECTIVE_DECISIONS_DIR);
}

function ensureDir(projectRoot: string): string {
  const dir = decisionsDir(projectRoot);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function decisionPath(projectRoot: string, id: string): string {
  if (!isValidDecisionId(id)) {
    throw new Error(`Invalid MD id: ${id}`);
  }
  return join(decisionsDir(projectRoot), `${id}.yml`);
}

export function listDecisionIds(projectRoot: string): string[] {
  const dir = decisionsDir(projectRoot);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.yml'))
    .map((f) => f.replace(/\.yml$/, ''))
    .filter(isValidDecisionId)
    .sort();
}

// Issue #184: mint a fresh `MD-<ULID>`. ULIDs are time-sortable and
// collision-free across machines, so the old directory-walk + increment (which
// produced identical ids on parallel branches) is gone. Allocation no longer
// touches the filesystem, so it takes no `projectRoot`.
export function nextDecisionId(): string {
  return `MD-${ulid()}`;
}

export function readDecision(projectRoot: string, id: string): ModuleDecision | null {
  const path = decisionPath(projectRoot, id);
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, 'utf8');
  const parsed = YAML.parse(raw) as Partial<ModuleDecision> | null;
  if (parsed === null || typeof parsed !== 'object') return null;
  // We trust the schema-shaped writer below; deeper validation belongs to a
  // separate validator if we ever need it.
  return parsed as ModuleDecision;
}

export function writeDecision(projectRoot: string, decision: ModuleDecision): string {
  ensureDir(projectRoot);
  const path = decisionPath(projectRoot, decision.id);
  const yaml = YAML.stringify(decision, { indent: 2, lineWidth: 0 });
  writeFileSync(path, yaml, 'utf8');
  return path;
}

export function deleteDecision(projectRoot: string, id: string): void {
  const path = decisionPath(projectRoot, id);
  if (existsSync(path)) unlinkSync(path);
}

export function listDecisions(projectRoot: string): ModuleDecision[] {
  return listDecisionIds(projectRoot)
    .map((id) => readDecision(projectRoot, id))
    .filter((d): d is ModuleDecision => d !== null);
}

export function listDecisionsByState(
  projectRoot: string,
  state: ModuleDecisionState,
): ModuleDecision[] {
  return listDecisions(projectRoot).filter((d) => d.state === state);
}

// Walk every proposed decision and transition expired ones to "expired".
// Returns the list of decision IDs that moved.
export function expireStaleDecisions(projectRoot: string, now: Date = new Date()): string[] {
  const moved: string[] = [];
  for (const decision of listDecisionsByState(projectRoot, 'proposed')) {
    if (!isExpired(decision, now)) continue;
    const next: ModuleDecision = {
      ...decision,
      state: 'expired',
      updated_at: now.toISOString(),
    };
    writeDecision(projectRoot, next);
    moved.push(decision.id);
  }
  return moved;
}
