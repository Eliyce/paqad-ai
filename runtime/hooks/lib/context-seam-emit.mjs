import {
  buildInjection,
  isLeanRulesEnabledValue,
  isRagEnabledValue,
} from '../../scripts/context-seam.mjs';
import {
  recordSeamOutcome,
  resolveSeamSessionId,
  sectionsFromBlock,
} from '../../scripts/rag-evidence-record.mjs';
import { isPaqadDisabled, readLayeredKey, resolveProjectRoot } from './paqad-disabled.mjs';

export function sessionIdFromStdin(stdin) {
  try {
    const parsed = JSON.parse(stdin);
    if (parsed && typeof parsed.session_id === 'string') return parsed.session_id;
  } catch {}
  return undefined;
}

export function agentIdFromStdin(stdin) {
  try {
    const parsed = JSON.parse(stdin);
    if (parsed && typeof parsed.agent_id === 'string' && parsed.agent_id.trim().length > 0) {
      return parsed.agent_id;
    }
  } catch {}
  return undefined;
}

export function emitContext(stdin, projectRoot = resolveProjectRoot(), write, options = {}) {
  const emit = typeof write === 'function' ? write : (text) => process.stdout.write(text);
  try {
    if (isPaqadDisabled(projectRoot)) return;

    const ragEnabled = isRagEnabledValue(
      readLayeredKey(projectRoot, 'rag_enabled', 'PAQAD_RAG_ENABLED'),
    );
    const leanEnabled = isLeanRulesEnabledValue(
      readLayeredKey(projectRoot, 'lean_rules', 'PAQAD_LEAN_RULES'),
    );
    if (!ragEnabled && !leanEnabled) {
      return;
    }

    const block = buildInjection(projectRoot, { stripRules: options.stripRules === true });
    if (block) {
      emit(`${block}\n`);
    }

    try {
      const sessionId = resolveSeamSessionId(projectRoot, sessionIdFromStdin(stdin));
      if (block) {
        recordSeamOutcome(projectRoot, {
          sessionId,
          ragEnabled,
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
          ragEnabled,
          adapter: 'claude-code',
          kind: 'fallback',
          fields: {
            injected: false,
            fallback_reason: 'cold',
            note: options.stripRules
              ? 'seam: no non-rule context for this prompt'
              : 'seam: no precomputed context',
          },
        });
      }
    } catch {}
  } catch {}
}
