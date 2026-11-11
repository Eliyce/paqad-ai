import { readFileSync } from 'node:fs';

function parse(stdin) {
  try {
    const parsed = JSON.parse(stdin);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n');
}

export function lastAssistantText(transcript) {
  if (typeof transcript !== 'string') return '';
  const lines = transcript.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    if (line === '') continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry?.type !== 'assistant' && entry?.message?.role !== 'assistant') continue;
    const text = textOf(entry?.message?.content);
    if (text.trim() !== '') return text;
  }
  return '';
}

export function finalMessageFromStdin(stdin) {
  const payload = parse(stdin);
  if (typeof payload.last_assistant_message === 'string') return payload.last_assistant_message;
  const path = payload.transcript_path;
  if (typeof path !== 'string' || path.trim() === '') return '';
  try {
    return lastAssistantText(readFileSync(path, 'utf8'));
  } catch {
    return '';
  }
}

export function isSubagentStop(stdin) {
  const payload = parse(stdin);
  if (payload.hook_event_name === 'SubagentStop') return true;
  return typeof payload.agent_id === 'string' && payload.agent_id !== '';
}

function escaped(word) {
  return word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function verdictWordIn(message, words) {
  if (typeof message !== 'string' || message === '') return null;
  let found = null;
  let at = Infinity;
  for (const word of words) {
    const match = new RegExp(`(^|[^A-Za-z])${escaped(word)}(?![A-Za-z])`).exec(message);
    if (match && match.index < at) {
      at = match.index;
      found = word;
    }
  }
  return found;
}

export function agreementReason(record) {
  const reasons = Array.isArray(record.reasons) ? record.reasons : [];
  const lines = [
    `paqad: your closing message names a different verdict than this session's verdict record, which says ${record.word}.`,
    `Start the end-of-change receipt with ${record.word}, the word \`paqad-ai status --verdict\` prints, and keep its reasons.`,
  ];
  if (reasons.length > 0) lines.push('Reasons:', ...reasons.map((reason) => `- ${reason}`));
  return lines.join('\n');
}

export function decideVerdictAgreement({ subagent, loopActive, message, words, reading, state }) {
  if (subagent) return { kind: 'skip', why: 'a stage helper stop is never checked' };
  const said = verdictWordIn(message, words);
  if (said === null) return { kind: 'skip', why: 'the closing message names no verdict' };
  if (reading.status !== 'found') return { kind: 'no-record', said, why: reading.why };
  const record = reading.record;
  if (said === record.word) return { kind: 'agree', said };
  const change = record.change ?? 'none';
  if (loopActive || state.blocked_changes.includes(change)) {
    return { kind: 'pass', said, change, why: 'the verdict was already held once for this change' };
  }
  return { kind: 'block', said, change, reason: agreementReason(record) };
}

export function checkVerdictAgreement({ api, projectRoot, stdin, hostSessionId, loopActive, log }) {
  const note = typeof log === 'function' ? log : () => {};
  const subagent = isSubagentStop(stdin);
  if (subagent) return null;
  const sessionId = api.verdictSessionId(projectRoot, hostSessionId ?? null);
  const state = api.readVerdictAgreement(projectRoot, sessionId);
  const decision = decideVerdictAgreement({
    subagent,
    loopActive: loopActive === true,
    message: finalMessageFromStdin(stdin),
    words: api.HUD_VERDICT_WORDS,
    reading: api.readHudVerdict(projectRoot, sessionId),
    state,
  });
  if (decision.kind === 'no-record') {
    note(`let the closing message through: ${decision.why}`);
    api.writeVerdictAgreement(projectRoot, sessionId, {
      ...state,
      no_record: { why: decision.why, at: new Date().toISOString() },
    });
    return null;
  }
  if (decision.kind === 'skip') return null;
  if (state.no_record) {
    api.writeVerdictAgreement(projectRoot, sessionId, { ...state, no_record: null });
  }
  if (decision.kind !== 'block') return null;
  api.writeVerdictAgreement(projectRoot, sessionId, {
    blocked_changes: [...state.blocked_changes, decision.change],
    no_record: null,
  });
  return { decision: 'block', reason: decision.reason };
}
