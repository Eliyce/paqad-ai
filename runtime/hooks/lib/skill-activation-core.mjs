export const ACTIVATIONS_REL = '.paqad/ledger/authoring/activations.jsonl';
export const PRUNE_THRESHOLD_BYTES = 1_000_000;
export const MAX_LINE_BYTES = 4096;
export const DEFAULT_DARK_WINDOW_DAYS = 30;
const MAX_NAME_LENGTH = 200;
const DAY_MS = 86_400_000;

export function isSkillRead(payload) {
  if (!payload || typeof payload !== 'object') return false;
  if (payload.tool_name === 'Skill') return true;
  if (payload.tool_name !== 'Read') return false;
  const path = payload.tool_input && payload.tool_input.file_path;
  return typeof path === 'string' && /(^|[\\/])SKILL\.md$/.test(path);
}

function cleanName(raw) {
  if (typeof raw !== 'string') return null;
  const stripped = raw.trim().split(':').pop().trim();
  if (stripped === '' || !/^[A-Za-z0-9._-]+$/.test(stripped)) return null;
  return stripped.slice(0, MAX_NAME_LENGTH);
}

export function skillNameFromToolInput(payload) {
  const input = payload && payload.tool_input;
  if (!input || typeof input !== 'object') return null;
  if (payload.tool_name === 'Skill') {
    return cleanName(input.skill ?? input.name ?? input.command);
  }
  const parts = String(input.file_path).split(/[\\/]/).filter(Boolean);
  return parts.length >= 2 ? cleanName(parts[parts.length - 2]) : null;
}

function shortId(value) {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, 200) : null;
}

export function activationFromPayload(payload, now = new Date()) {
  if (!isSkillRead(payload)) return null;
  const skill = skillNameFromToolInput(payload);
  if (skill === null) return null;
  return {
    skill,
    request_id: shortId(payload.tool_use_id ?? payload.prompt_id),
    session_id: shortId(payload.session_id),
    at: now.toISOString(),
    source: payload.tool_name === 'Skill' ? 'Skill-tool' : 'SKILL.md-read',
  };
}

export function activationLine(entry) {
  const line = `${JSON.stringify(entry)}\n`;
  return Buffer.byteLength(line) < MAX_LINE_BYTES ? line : null;
}

export function pruneActivationText(
  text,
  now = new Date(),
  darkWindowDays = DEFAULT_DARK_WINDOW_DAYS,
) {
  const cutoff = now.getTime() - 2 * darkWindowDays * DAY_MS;
  const kept = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    try {
      const at = Date.parse(JSON.parse(line).at);
      if (Number.isFinite(at) && at >= cutoff) kept.push(line);
    } catch {
      continue;
    }
  }
  return kept.length === 0 ? '' : `${kept.join('\n')}\n`;
}
