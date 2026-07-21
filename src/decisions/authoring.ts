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
// plumbing). They are the exact counterpart to `paqad-ai stage` on the
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
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { ulid } from '@/core/ids/ulid.js';
import { isStrictDecisionId, type DecisionOptionEvidence } from '@/planning/decision-packet.js';

/**
 * How a packet came to exist. Absent on a packet the agent opened by hand through
 * `paqad-ai decision create`; `evidence-armed` on one the machine minted from computed
 * evidence (issue #361), so a reader can tell an asked question from a detected one.
 */
export type ContractDecisionOrigin = 'evidence-armed';

/**
 * A single option offered by a decision packet.
 *
 * `evidence` is optional and additive (issue #361): a hand-authored option carries none,
 * while an evidence-armed option carries the proof behind it (the matched file, when it
 * last changed, how many callers it has, how similar it is). It reuses the
 * {@link DecisionOptionEvidence} shape the automated `DecisionPacket` already defines
 * rather than introducing a second evidence representation.
 */
export interface ContractDecisionOption {
  option_key: string;
  label: string;
  evidence?: DecisionOptionEvidence;
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
  /** Set only on a machine-minted packet (issue #361); absent on a hand-opened one. */
  origin?: ContractDecisionOrigin;
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
  /** Set by a machine minter (issue #361); omitted when the agent opens the packet. */
  origin?: ContractDecisionOrigin;
}

/** Mint a fresh, collision-free decision id (`D-<ULID>`). */
export function mintDecisionId(): string {
  return `D-${ulid()}`;
}

/**
 * True when `id` is the collision-free `D-<ULID>` form (not legacy `D-{N}`). Delegates
 * to the single canonical write-time guard (`isStrictDecisionId`, issue #387) so the
 * contract-packet and automated-packet paths never carry divergent id regexes.
 */
export function isContractDecisionId(id: string): boolean {
  return isStrictDecisionId(id);
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
    // Copy field by field so a caller cannot smuggle extra keys into the stored packet;
    // `evidence` rides along only when the option actually carries it (issue #361).
    options: input.options.map((option) => ({
      option_key: option.option_key,
      label: option.label,
      ...(option.evidence !== undefined ? { evidence: option.evidence } : {}),
    })),
    recommendation: input.recommendation ?? null,
    created_at: new Date().toISOString(),
    status: 'pending',
    ...(input.origin !== undefined ? { origin: input.origin } : {}),
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

/** A compact listing row for `paqad-ai decision list`. */
export interface ContractDecisionListEntry {
  id: string;
  category: string;
  title: string;
  status: 'pending' | 'resolved';
}

/** A stored packet plus which directory it was read from. */
export interface StoredContractDecision {
  packet: PendingContractDecision;
  status: 'pending' | 'resolved';
}

/**
 * Read every stored decision packet (pending first, then resolved, each id-sorted). The one
 * reader for the contract store: the CLI listing renders it, and the evidence-armed minter
 * (issue #361) scans the packets' contexts for its machine tokens. Tolerant by design — a
 * missing directory yields no rows and a malformed packet is skipped, so a partial store
 * never throws.
 */
export function readContractDecisions(projectRoot: string): StoredContractDecision[] {
  const rows: StoredContractDecision[] = [];
  const sources = [
    [PATHS.DECISIONS_PENDING_DIR, 'pending'],
    [PATHS.DECISIONS_RESOLVED_DIR, 'resolved'],
  ] as const;
  for (const [relativeDir, status] of sources) {
    const abs = join(projectRoot, relativeDir);
    let files: string[];
    try {
      files = readdirSync(abs);
    } catch {
      continue;
    }
    for (const file of files.filter((name) => name.endsWith('.json')).sort()) {
      try {
        const packet = JSON.parse(readFileSync(join(abs, file), 'utf8')) as PendingContractDecision;
        rows.push({ packet, status });
      } catch {
        // Skip a malformed packet — a broken file never breaks the read.
      }
    }
  }
  return rows;
}

/**
 * List every decision packet (pending first, then resolved), for `paqad-ai decision
 * list`.
 */
export function listContractDecisions(projectRoot: string): ContractDecisionListEntry[] {
  return readContractDecisions(projectRoot).map(({ packet, status }) => ({
    id: packet.id,
    category: packet.category,
    title: packet.title,
    status,
  }));
}

/**
 * Append a write-in option to a pending packet and return its minted key. Honors the
 * Decision Pause Contract's "Other" flow without hand-editing the JSON: the user
 * picked a write-in answer, so the option is added to the packet before it resolves to
 * it. The key is `other` (or `other-2`, … on collision), never a duplicate.
 */
export function addWriteInOption(projectRoot: string, id: string, label: string): string {
  assertContractDecisionId(id);
  if (label.trim().length === 0) {
    throw new Error('A write-in option needs a non-empty label.');
  }
  const pendingPath = packetPath(projectRoot, PATHS.DECISIONS_PENDING_DIR, id);
  if (!existsSync(pendingPath)) {
    throw new Error(`Pending decision ${id} not found at ${pendingPath}.`);
  }
  const pending = JSON.parse(readFileSync(pendingPath, 'utf8')) as PendingContractDecision;
  const existing = new Set(pending.options.map((option) => option.option_key));
  let key = 'other';
  let suffix = 2;
  while (existing.has(key)) {
    key = `other-${suffix++}`;
  }
  pending.options = [...pending.options, { option_key: key, label }];
  atomicWriteJson(pendingPath, pending);
  return key;
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
