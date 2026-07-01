// Decision Pause authoring helpers (issue #272).
//
// The Decision Pause Contract (shipped inline in the framework bootstrap,
// `AGENT-BOOTSTRAP.md`) asks the agent to write a decision packet to
// `.paqad/decisions/pending/D-{id}.json`, present it, then move it to
// `.paqad/decisions/resolved/` with `chosen` / `rationale` / `resolved_at`. Left
// to hand-author the JSON, an agent pattern-matches the legacy numeric `D-1` /
// `D-2` / `D-3` fixtures and continues the sequence (`D-4`) — two developers on
// parallel branches then mint the same id and collide (issue #184 introduced the
// collision-free `D-<ULID>` form precisely to stop this).
//
// These helpers are the writer the contract lacked: they mint the ULID id, build
// and validate the packet, and drive the pending -> resolved lifecycle, so the
// agent supplies only content (never the id, the timestamps, or the JSON
// plumbing). They are the exact counterpart to `scripts/se-mark.ts` on the
// stage-evidence ledger, and are surfaced to the agent through the bundled
// `decision` skill's `create` / `resolve` scripts.
//
// This is the *contract* packet — the small, human-facing decision record the
// agent writes by hand today — not the rich `DecisionPacket` in
// `src/planning/decision-packet.ts`, which is the schema the automated intake /
// reuse pipeline (`DecisionStore`) mints and consumes. The two are deliberately
// separate: this one is a readable trail committed alongside the PR it justifies.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { ULID_BODY, ulid } from '@/core/ids/ulid.js';

/** A single option offered by a decision packet. */
export interface ContractDecisionOption {
  option_key: string;
  label: string;
}

/** The pending form written by {@link createPendingDecision}. */
export interface PendingContractDecision {
  id: string;
  category: string;
  title: string;
  context: string;
  options: ContractDecisionOption[];
  recommendation: string | null;
  created_at: string;
  status: 'pending';
}

/** The resolved form written by {@link resolvePendingDecision}. */
export interface ResolvedContractDecision extends Omit<PendingContractDecision, 'status'> {
  status: 'resolved';
  chosen: string;
  rationale: string;
  resolved_at: string;
}

/** Fields the agent supplies to open a decision; the id/timestamps are minted. */
export interface CreateDecisionInput {
  category: string;
  title: string;
  context: string;
  options: ContractDecisionOption[];
  recommendation?: string | null;
}

/** A `D-<ULID>` id: literal `D-` prefix followed by a 26-char ULID body. */
const CONTRACT_DECISION_ID = new RegExp(`^D-${ULID_BODY}$`, 'u');

/** Mint a fresh, collision-free decision id (`D-<ULID>`). */
export function mintDecisionId(): string {
  return `D-${ulid()}`;
}

/** True when `id` is the collision-free `D-<ULID>` form (not legacy `D-{N}`). */
export function isContractDecisionId(id: string): boolean {
  return CONTRACT_DECISION_ID.test(id);
}

/**
 * Reject any id that is not the collision-free `D-<ULID>` form. A hand-written
 * sequential `D-4` (or any other shape) throws here, so a new packet can only
 * ever carry a minted ULID id — the guarantee issue #272 needs at creation time.
 */
export function assertContractDecisionId(id: string): void {
  if (!isContractDecisionId(id)) {
    throw new Error(
      `Decision id "${id}" must be the collision-free D-<ULID> form. ` +
        `Mint one with mintDecisionId() (never hand-write a sequential D-{N}).`,
    );
  }
}

function validateCreateInput(input: CreateDecisionInput): string[] {
  const errors: string[] = [];
  if (input.category.trim().length === 0) {
    errors.push('category is required');
  }
  if (input.title.trim().length === 0) {
    errors.push('title is required');
  }
  if (input.context.trim().length === 0) {
    errors.push('context is required');
  }
  if (!Array.isArray(input.options) || input.options.length < 2) {
    errors.push('at least 2 options are required');
  } else {
    const seen = new Set<string>();
    for (const [index, option] of input.options.entries()) {
      if (typeof option?.option_key !== 'string' || option.option_key.trim().length === 0) {
        errors.push(`options[${index}].option_key is required`);
        continue;
      }
      if (typeof option.label !== 'string' || option.label.trim().length === 0) {
        errors.push(`options[${index}].label is required`);
      }
      if (seen.has(option.option_key)) {
        errors.push(`options[${index}].option_key "${option.option_key}" is duplicated`);
      }
      seen.add(option.option_key);
    }
  }
  if (
    input.recommendation !== undefined &&
    input.recommendation !== null &&
    !input.options?.some((option) => option.option_key === input.recommendation)
  ) {
    errors.push('recommendation must reference an option_key');
  }
  return errors;
}

/**
 * Open a decision: mint a `D-<ULID>` id, build the pending packet from the
 * supplied content, and write it atomically to `.paqad/decisions/pending/`.
 * Returns the minted id and the absolute path written.
 */
export function createPendingDecision(
  projectRoot: string,
  input: CreateDecisionInput,
): { id: string; path: string } {
  const errors = validateCreateInput(input);
  if (errors.length > 0) {
    throw new Error(`Cannot create decision packet: ${errors.join('; ')}`);
  }

  const id = mintDecisionId();
  const packet: PendingContractDecision = {
    id,
    category: input.category,
    title: input.title,
    context: input.context,
    options: input.options.map((option) => ({
      option_key: option.option_key,
      label: option.label,
    })),
    recommendation: input.recommendation ?? null,
    created_at: new Date().toISOString(),
    status: 'pending',
  };

  const path = packetPath(projectRoot, PATHS.DECISIONS_PENDING_DIR, id);
  atomicWriteJson(path, packet);
  return { id, path };
}

/**
 * Resolve a pending decision: record the chosen option (and any free-text
 * rationale), move the packet from `pending/` to `resolved/`, and stamp
 * `resolved_at`. `chosen` must reference one of the packet's option keys.
 * Returns the resolved packet and the absolute path written.
 */
export function resolvePendingDecision(
  projectRoot: string,
  id: string,
  chosen: string,
  rationale = '',
): { path: string; packet: ResolvedContractDecision } {
  assertContractDecisionId(id);
  const pendingPath = packetPath(projectRoot, PATHS.DECISIONS_PENDING_DIR, id);
  if (!existsSync(pendingPath)) {
    throw new Error(`Pending decision ${id} not found at ${pendingPath}.`);
  }

  const pending = JSON.parse(readFileSync(pendingPath, 'utf8')) as PendingContractDecision;
  if (!pending.options?.some((option) => option.option_key === chosen)) {
    const keys = pending.options?.map((option) => option.option_key).join(', ') ?? '';
    throw new Error(`Chosen option "${chosen}" is not one of the packet's options (${keys}).`);
  }

  const resolved: ResolvedContractDecision = {
    ...pending,
    status: 'resolved',
    chosen,
    rationale,
    resolved_at: new Date().toISOString(),
  };

  const resolvedPath = packetPath(projectRoot, PATHS.DECISIONS_RESOLVED_DIR, id);
  atomicWriteJson(resolvedPath, resolved);
  unlinkSync(pendingPath);
  return { path: resolvedPath, packet: resolved };
}

function packetPath(projectRoot: string, relativeDir: string, id: string): string {
  return join(projectRoot, relativeDir, `${id}.json`);
}

function atomicWriteJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tempPath, path);
}
