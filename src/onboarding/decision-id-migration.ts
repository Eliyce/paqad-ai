// Legacy decision-id migration (issue #387).
//
// Before the ULID cutover (issue #184) decision packets carried sequential `D-{N}` ids.
// A project onboarded on an old version — or one where an agent hand-authored packets on
// an advisory host with no Decision-Pause hook — can still hold `D-1.json` / `D-2.json`
// on disk. Those files (a) seed the anti-pattern for the next agent to continue and
// (b) collide across parallel branches. This best-effort reconciliation, run on every
// onboard/update, renames each legacy packet to a freshly-minted `D-<ULID>.json`,
// updates the in-file id and any index.json reference, and leaves already-ULID packets
// untouched so a re-run is a no-op. Read-time tolerance for legacy ids is unchanged;
// this only heals the files on disk so nothing seeds a new sequential id.

import { readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { mintDecisionId } from '@/decisions/authoring.js';
import { isStrictDecisionId } from '@/planning/decision-packet.js';

/** A single renamed packet: its old `D-{N}` id and the minted `D-<ULID>` id. */
export interface DecisionIdMigration {
  from: string;
  to: string;
  dir: string;
}

/** The legacy sequential filename shape (`D-7.json`); ULID files never match. */
const LEGACY_PACKET_FILE = /^D-\d+\.json$/u;

/**
 * Rename every legacy `D-{N}.json` decision packet under `.paqad/decisions/{pending,resolved}`
 * to a minted `D-<ULID>.json`, updating the packet's own id field(s) and any index.json
 * reference. Best-effort and idempotent: already-ULID packets are skipped, a malformed or
 * unreadable packet is left in place (never dropped), and any per-file failure is swallowed
 * so onboarding never fails over a stale packet. Returns the renames performed.
 *
 * `mint` is injectable for deterministic tests; it defaults to the real ULID minter.
 */
export function migrateLegacyDecisionIds(
  projectRoot: string,
  mint: () => string = mintDecisionId,
): DecisionIdMigration[] {
  const migrations: DecisionIdMigration[] = [];
  const idRemap = new Map<string, string>();

  for (const relativeDir of [PATHS.DECISIONS_PENDING_DIR, PATHS.DECISIONS_RESOLVED_DIR]) {
    const absoluteDir = join(projectRoot, relativeDir);
    let files: string[];
    try {
      files = readdirSync(absoluteDir);
    } catch {
      continue; // dir absent on a fresh project — nothing to migrate
    }
    for (const file of files.filter((name) => LEGACY_PACKET_FILE.test(name))) {
      const oldId = file.replace(/\.json$/u, '');
      // Guard (defensive): the regex already excludes ULID files, but never touch one.
      if (isStrictDecisionId(oldId)) {
        continue;
      }
      const newId = mint();
      const oldPath = join(absoluteDir, file);
      const newPath = join(absoluteDir, `${newId}.json`);
      try {
        const rewritten = rewritePacketId(readFileSync(oldPath, 'utf8'), oldId, newId);
        writeFileSync(newPath, rewritten);
        unlinkSync(oldPath);
        idRemap.set(oldId, newId);
        migrations.push({ from: oldId, to: newId, dir: relativeDir });
      } catch {
        // Leave the packet in place — a broken file must never break onboarding.
      }
    }
  }

  if (idRemap.size > 0) {
    remapIndex(projectRoot, idRemap);
  }
  return migrations;
}

/**
 * Return `raw` with any top-level id field that holds the old id (`id` and/or
 * `decision_id` — the two packet schemas in play) set to the new id. A parse failure
 * throws so the caller leaves the original file untouched. Option bodies and every other
 * field are preserved verbatim.
 */
function rewritePacketId(raw: string, oldId: string, newId: string): string {
  const packet = JSON.parse(raw) as Record<string, unknown>;
  if (packet.id === oldId) {
    packet.id = newId;
  }
  if (packet.decision_id === oldId) {
    packet.decision_id = newId;
  }
  return `${JSON.stringify(packet, null, 2)}\n`;
}

/**
 * Rewrite `index.json` so any reference to a migrated id points at its new id: keys in
 * `decisions` and values in `fingerprints` (the two places an id appears). Best-effort —
 * a missing or malformed index is left alone.
 */
function remapIndex(projectRoot: string, idRemap: Map<string, string>): void {
  const indexPath = join(projectRoot, PATHS.DECISIONS_INDEX);
  // No existsSync check-then-use: reading a missing index throws ENOENT, which the
  // catch below already treats as "nothing to remap". Dropping the separate existence
  // probe removes a time-of-check/time-of-use file-system race (CodeQL js/file-system-race).
  try {
    const index = JSON.parse(readFileSync(indexPath, 'utf8')) as {
      fingerprints?: Record<string, string>;
      decisions?: Record<string, unknown>;
    };
    let changed = false;

    if (index.fingerprints) {
      for (const [fingerprint, decisionId] of Object.entries(index.fingerprints)) {
        const remapped = idRemap.get(decisionId);
        if (remapped) {
          index.fingerprints[fingerprint] = remapped;
          changed = true;
        }
      }
    }
    if (index.decisions) {
      for (const [oldId, value] of Object.entries(index.decisions)) {
        const remapped = idRemap.get(oldId);
        if (remapped) {
          delete index.decisions[oldId];
          index.decisions[remapped] = value;
          changed = true;
        }
      }
    }

    if (changed) {
      writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`);
    }
  } catch {
    // A malformed index never blocks onboarding.
  }
}
