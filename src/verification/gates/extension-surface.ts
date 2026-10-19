import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { Gate } from './gate.interface.js';
import { createFail, createNotRequired, createPass } from './shared.js';

/**
 * Extension-surface gate (PQD-92).
 *
 * Backs AC2/AC3 inside the verification pipeline: when a public export barrel is
 * changed, the canonical surface document (`docs/extension-surface.md`) must be
 * amended in the same change set. The gate reads not required (issue #639, Part 10)
 * when the document is absent or no barrel changed, so it stays backward-compatible
 * for projects that predate the contract without claiming a pass it never checked.
 */
export const SURFACE_DOC_PATH = 'docs/extension-surface.md';

const PUBLIC_BARRELS = ['src/index.ts', 'src/cli/index.ts', 'src/rule-scripts/index.ts'] as const;

const REMEDIATION = `Amend ${SURFACE_DOC_PATH} in the same change when adding, removing, or renaming a public export.`;

export class ExtensionSurfaceGate implements Gate {
  readonly gate = 'extension-surface' as const;

  async check(context: Parameters<Gate['check']>[0]) {
    const docAbsolutePath = join(context.project_root, ...SURFACE_DOC_PATH.split('/'));
    if (!existsSync(docAbsolutePath)) {
      return createNotRequired(
        this.gate,
        `Not required: this project has no extension surface document (${SURFACE_DOC_PATH}).`,
      );
    }

    const changedFiles = context.changed_files.map(normalizePath);
    const changedBarrel = changedFiles.find((filePath) =>
      (PUBLIC_BARRELS as readonly string[]).includes(filePath),
    );
    if (!changedBarrel) {
      return createNotRequired(this.gate, 'Not required: no public export barrel changed.');
    }

    const documentAmended = changedFiles.includes(SURFACE_DOC_PATH);
    if (!documentAmended) {
      return createFail(
        this.gate,
        `Public export barrel ${changedBarrel} changed without amending ${SURFACE_DOC_PATH}`,
        REMEDIATION,
      );
    }

    return createPass(
      this.gate,
      `Public export barrel ${changedBarrel} changed and ${SURFACE_DOC_PATH} amended in the same change.`,
    );
  }
}

function normalizePath(filePath: string): string {
  return filePath.replaceAll('\\', '/').replace(/^\.?\//, '');
}
