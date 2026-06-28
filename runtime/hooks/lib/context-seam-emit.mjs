// context-seam-emit.mjs — side-effect-free emit logic for the session-time
// context injection seam (RAG buildout F2). Extracted from context-seam-inject.mjs
// so BOTH the standalone hook AND the agent-entry prompt gate can reuse it
// in-process — the gate needs to control ordering (load directive BEFORE any
// context, never buried under it — Part 0 / always-load). Importing this module
// runs nothing; the caller invokes emitContext() explicitly.
//
// Project root is resolved from the host env (CLAUDE_PROJECT_DIR /
// PAQAD_PROJECT_ROOT, falling back to cwd) via the shared helper, so the single
// global copy under the install operates on whichever project the session is in.

import { buildInjection, isRagEnabledValue } from '../../scripts/context-seam.mjs';
import {
  recordSeamOutcome,
  resolveSeamSessionId,
  sectionsFromBlock,
} from '../../scripts/rag-evidence-record.mjs';
import { isPaqadDisabled, readLayeredKey, resolveProjectRoot } from './paqad-disabled.mjs';

/** Best-effort session id from the host hook stdin payload (Claude passes session_id). */
export function sessionIdFromStdin(stdin) {
  try {
    const parsed = JSON.parse(stdin);
    if (parsed && typeof parsed.session_id === 'string') return parsed.session_id;
  } catch {
    // Not JSON / no session id — fall back to the cached/minted local id.
  }
  return undefined;
}

/**
 * Emit the precomputed `[paqad-context]` block to stdout when RAG injection is on
 * and a context artifact exists; otherwise emit nothing. Always best-effort: any
 * failure (disabled project, missing artifact, read error) emits nothing and the
 * agent proceeds with grep/read exactly as today (F3). Records the rag-evidence
 * outcome for the turn (#249), which never affects the emitted block.
 */
export function emitContext(stdin, projectRoot = resolveProjectRoot()) {
  try {
    // Issue #220: when paqad is disabled the seam is a pure no-op — emitting a
    // `[paqad-context]` line would contaminate the OFF arm of an A/B comparison.
    if (isPaqadDisabled(projectRoot)) return;

    // RAG buildout F3 — disabled/cold-start == today's behavior. The injection
    // accelerator is OFF by default (honest grep/agentic default); only an
    // explicit `rag_enabled` truthy value turns it on. When off we emit nothing,
    // converging disabled == missing == baseline, even if a stale artifact from a
    // previously-enabled run still sits on disk.
    if (!isRagEnabledValue(readLayeredKey(projectRoot, 'rag_enabled', 'PAQAD_RAG_ENABLED'))) {
      return;
    }

    const block = buildInjection(projectRoot);
    if (block) {
      process.stdout.write(`${block}\n`);
    }

    // Issue #249 — record what happened on THIS prompt: `used` when a block was
    // injected (with the sections + bytes the script observed), else `fallback`
    // (RAG was on but produced nothing). Best-effort; never affects the block above.
    try {
      const sessionId = resolveSeamSessionId(projectRoot, sessionIdFromStdin(stdin));
      if (block) {
        recordSeamOutcome(projectRoot, {
          sessionId,
          ragEnabled: true,
          adapter: 'claude-code',
          kind: 'used',
          fields: {
            injected: true,
            injected_sections: sectionsFromBlock(block),
            bytes_injected: Buffer.byteLength(block, 'utf8'),
          },
        });
      } else {
        recordSeamOutcome(projectRoot, {
          sessionId,
          ragEnabled: true,
          adapter: 'claude-code',
          kind: 'fallback',
          fields: {
            injected: false,
            fallback_reason: 'cold',
            note: 'seam: no precomputed context',
          },
        });
      }
    } catch {
      // Evidence recording is best-effort; never break a turn over it.
    }
  } catch {
    // Never let the seam break a turn. Emit nothing on any failure.
  }
}
