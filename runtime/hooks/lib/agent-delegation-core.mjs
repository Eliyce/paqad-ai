export const DELEGATIONS_REL = '.paqad/ledger/authoring/delegations.jsonl';
export const PRUNE_THRESHOLD_BYTES = 1_000_000;
export const MAX_LINE_BYTES = 4096;
export const DEFAULT_DARK_WINDOW_DAYS = 30;
const MAX_NAME_LENGTH = 200;
const DAY_MS = 86_400_000;
const AGENT_TOOLS = new Set(['Agent', 'Task']);

export function isDelegationEvent(payload) {
  if (!payload || typeof payload !== 'object') return false;
  if (payload.hook_event_name === 'SubagentStop') return true;
  return AGENT_TOOLS.has(payload.tool_name);
}

function cleanName(raw) {
  if (typeof raw !== 'string') return null;
  const stripped = raw.trim().split(':').pop().trim();
  if (stripped === '' || !/^[A-Za-z0-9._-]+$/.test(stripped)) return null;
  return stripped.slice(0, MAX_NAME_LENGTH);
}

function shortId(value) {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, 200) : null;
}

function count(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : null;
}

function shortStatus(value, fallback) {
  return typeof value === 'string' && /^[A-Za-z_-]{1,40}$/.test(value) ? value : fallback;
}

export function agentNameFromPayload(payload) {
  if (!isDelegationEvent(payload)) return null;
  if (payload.hook_event_name === 'SubagentStop') return cleanName(payload.agent_type);
  const input = payload.tool_input;
  if (!input || typeof input !== 'object') return null;
  return cleanName(input.subagent_type ?? 'general-purpose');
}

export function delegationFromPayload(payload, now = new Date()) {
  const agent = agentNameFromPayload(payload);
  if (agent === null) return null;
  const response =
    payload.tool_response && typeof payload.tool_response === 'object' ? payload.tool_response : {};
  const usage = response.usage && typeof response.usage === 'object' ? response.usage : {};
  const stop = payload.hook_event_name === 'SubagentStop';
  return {
    agent,
    request_id: shortId(payload.tool_use_id ?? payload.agent_id ?? payload.prompt_id),
    session_id: shortId(payload.session_id),
    at: now.toISOString(),
    tokens: count(response.totalTokens ?? usage.total_tokens),
    duration_ms: count(response.totalDurationMs ?? response.duration_ms),
    status: stop ? 'stopped' : shortStatus(response.status, 'completed'),
  };
}

export function delegationLine(entry) {
  const line = `${JSON.stringify(entry)}\n`;
  return Buffer.byteLength(line) < MAX_LINE_BYTES ? line : null;
}

export function pruneDelegationText(
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

export const COMPACTING_SUFFIX = '.compacting';
export const LOCK_SUFFIX = '.lock';
export const STALE_LOCK_MS = 60_000;
const TAIL_PASSES = 3;

function takeLock(fs, lock, now) {
  try {
    fs.closeSync(fs.openSync(lock, 'wx'));
    return true;
  } catch {
    try {
      if (now.getTime() - fs.statSync(lock).mtimeMs > STALE_LOCK_MS)
        fs.rmSync(lock, { force: true });
    } catch {
      return false;
    }
    return false;
  }
}

function readFrom(fs, path, start) {
  const fd = fs.openSync(path, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    if (size <= start) return { text: '' };
    const buffer = Buffer.alloc(size - start);
    let offset = 0;
    while (offset < buffer.length) {
      const read = fs.readSync(fd, buffer, offset, buffer.length - offset, start + offset);
      if (read === 0) break;
      offset += read;
    }
    return { text: buffer.subarray(0, offset).toString('utf8') };
  } finally {
    fs.closeSync(fd);
  }
}

function completeLines(text) {
  const end = text.lastIndexOf('\n');
  return end === -1 ? '' : text.slice(0, end + 1);
}

export function compactDelegations(
  fs,
  file,
  now = new Date(),
  darkWindowDays = DEFAULT_DARK_WINDOW_DAYS,
) {
  const lock = `${file}${LOCK_SUFFIX}`;
  if (!takeLock(fs, lock, now)) return false;
  const compacting = `${file}${COMPACTING_SUFFIX}`;
  try {
    if (!fs.existsSync(compacting)) {
      try {
        fs.renameSync(file, compacting);
      } catch {
        return false;
      }
    }
    const head = completeLines(readFrom(fs, compacting, 0).text);
    const pruned = pruneDelegationText(head, now, darkWindowDays);
    if (pruned !== '') fs.appendFileSync(file, pruned, 'utf8');
    let offset = Buffer.byteLength(head);
    for (let pass = 0; pass < TAIL_PASSES; pass += 1) {
      const tail = completeLines(readFrom(fs, compacting, offset).text);
      if (tail === '') break;
      fs.appendFileSync(file, tail, 'utf8');
      offset += Buffer.byteLength(tail);
    }
    fs.rmSync(compacting, { force: true });
    return true;
  } finally {
    fs.rmSync(lock, { force: true });
  }
}
