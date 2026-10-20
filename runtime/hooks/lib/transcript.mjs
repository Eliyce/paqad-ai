import { readFileSync } from 'node:fs';

import { resolveCodexRolloutText } from './codex-rollout.mjs';

export function transcriptPathFromStdin(stdin) {
  try {
    const parsed = JSON.parse(stdin);
    return typeof parsed?.transcript_path === 'string' ? parsed.transcript_path : null;
  } catch {
    return null;
  }
}

export function transcriptTextFromStdin(stdin) {
  const path = transcriptPathFromStdin(stdin);
  if (!path) return null;
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

export function resolveCompletionTranscriptText(stdin, adapter) {
  let payload;
  try {
    payload = JSON.parse(stdin);
  } catch {
    payload = undefined;
  }
  const path = payload?.transcript_path;
  if (typeof path === 'string' && path.trim() !== '') {
    try {
      return readFileSync(path, 'utf8');
    } catch {}
  }
  if (adapter === 'codex-cli') {
    const rollout = resolveCodexRolloutText(payload?.session_id);
    if (rollout) return rollout;
  }
  const inline = payload?.last_assistant_message ?? payload?.prompt_response;
  return typeof inline === 'string' ? inline : '';
}

export function resolveSubagentTranscriptText(stdin, adapter) {
  let payload;
  try {
    payload = JSON.parse(stdin);
  } catch {
    payload = undefined;
  }
  const path = payload?.agent_transcript_path;
  if (typeof path === 'string' && path.trim() !== '') {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      return resolveCompletionTranscriptText(stdin, adapter);
    }
  }
  return resolveCompletionTranscriptText(stdin, adapter);
}
