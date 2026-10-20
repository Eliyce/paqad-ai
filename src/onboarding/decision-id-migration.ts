import { readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { PATHS } from '@/core/constants/paths.js';
import { mintDecisionId } from '@/decisions/authoring.js';
import { isStrictDecisionId } from '@/planning/decision-packet.js';

export interface DecisionIdMigration {
  from: string;
  to: string;
  dir: string;
}

const LEGACY_PACKET_FILE = /^D-\d+\.json$/u;

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
      continue;
    }
    for (const file of files.filter((name) => LEGACY_PACKET_FILE.test(name))) {
      const oldId = file.replace(/\.json$/u, '');
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
      } catch {}
    }
  }

  if (idRemap.size > 0) {
    remapIndex(projectRoot, idRemap);
  }
  return migrations;
}

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

function remapIndex(projectRoot: string, idRemap: Map<string, string>): void {
  const indexPath = join(projectRoot, PATHS.DECISIONS_INDEX);
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
  } catch {}
}
