#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const CHANGES = [
  '01M5DC6C8R1KBH145FZ8HS1VTC',
  '01M5XRN9CWF9RDTNFC1A21A0SV',
  '01M5DHQYW9J0Y7ZGF6QN0E34GE',
];
const LEDGER_DIR = '.paqad/ledger/feature-evidence';
const PAD_MS = 5 * 60_000;
const MARGIN_MS = 60 * 60_000;
const SCAN_CHARS = 400;
const MARKERS = [
  '<task-notification',
  'Another Claude session sent',
  'Stop hook feedback',
  '<ci-monitor-event',
  '<system-reminder',
  '<side-sessions',
  'Request interrupted',
];
const RESULT_MARKERS = ['hook error', 'timed out', 'agent-entry'];
const SAFE_WORD = /^[^\s"'`\\;|&<>()]+$/;
const FRAMEWORK_PATH =
  /AGENT-BOOTSTRAP|AGENT-ROUTER|CLAUDE\.md|framework-path|session-context|docs\/instructions\/(stack|design-system|workflows)(\/|$)/;
const CHAINED_PREFIX = /^(cd|export)\s/;
const ASSIGNMENT_PREFIX = /^[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|[^\s&;|"']*)\s+/;

function argValue(name, fallback) {
  const at = process.argv.indexOf(name);
  return at === -1 ? fallback : process.argv[at + 1];
}

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(argValue('--project-root', process.cwd()));
const slug = projectRoot.replace(/[\\/:._ ]/g, '-');
const transcriptsDir = resolve(
  argValue('--transcripts-dir', join(homedir(), '.claude', 'projects', slug)),
);
const outDir = resolve(argValue('--out', here));

const user = userInfo().username;
const userForms = [...new Set([user, user.replace(/[._]/g, '-')])].filter(
  (form) => form.length > 2,
);

function mask(text) {
  let out = text.replace(/\/(Users|home)\/[^/\s"'\\]+/g, '/$1/x');
  for (const form of userForms) out = out.split(form).join('x');
  return out;
}

function xLines(text) {
  const count = text.length === 0 ? 1 : text.replace(/\n$/, '').split('\n').length;
  return Array.from({ length: count }, () => 'x').join('\n');
}

function isInjected(text) {
  return MARKERS.some((marker) => {
    const at = text.indexOf(marker);
    return at !== -1 && at < SCAN_CHARS;
  });
}

function firstAndAnd(text) {
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote !== null) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '\n' || ch === ';' || (ch === '|' && text[i + 1] !== '|')) return -1;
    else if (ch === '&' && text[i + 1] === '&') return i;
  }
  return -1;
}

function splitPrefix(command) {
  let rest = command.trimStart();
  for (;;) {
    let next = rest;
    if (CHAINED_PREFIX.test(rest)) {
      const at = firstAndAnd(rest);
      if (at !== -1) next = rest.slice(at + 2).trimStart();
    } else {
      const assignment = ASSIGNMENT_PREFIX.exec(rest);
      if (assignment) next = rest.slice(assignment[0].length);
    }
    if (next === rest) break;
    rest = next;
  }
  const prefix = command.trimStart().slice(0, command.trimStart().length - rest.length);
  return { prefix, rest: rest.trim() };
}

function words(stripped) {
  const out = [];
  let current = '';
  let quote = null;
  let started = false;
  for (const ch of stripped) {
    if (quote !== null) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
      continue;
    }
    if (ch === '&' || ch === '|' || ch === ';' || ch === '\n') break;
    if (/\s/.test(ch)) {
      if (started) out.push(current);
      current = '';
      started = false;
      continue;
    }
    current += ch;
    started = true;
  }
  if (started) out.push(current);
  return out;
}

function sanitizeCommand(command) {
  const { prefix, rest } = splitPrefix(command);
  const kept = words(rest).map((word) => (SAFE_WORD.test(word) ? mask(word) : 'x'));
  return `${mask(prefix)}${kept.join(' ')}`;
}

const outsidePaths = new Map();

function sanitizePath(path) {
  if (path.startsWith(`${projectRoot}/`) || path === projectRoot) {
    return mask(path);
  }
  if (!outsidePaths.has(path)) {
    const id = createHash('sha256').update(path).digest('hex').slice(0, 12);
    const paqad = /(^|[\\/])\.paqad([\\/]|$)/.test(path) ? '/.paqad' : '';
    const framework = FRAMEWORK_PATH.exec(path.replace(/\\/g, '/'));
    outsidePaths.set(path, `/x/outside-${id}${paqad}/${framework ? framework[0] : 'f'}`);
  }
  return outsidePaths.get(path);
}

function sanitizeInput(name, input) {
  const source = input && typeof input === 'object' ? input : {};
  const filePath =
    typeof source.file_path === 'string' ? sanitizePath(source.file_path) : undefined;
  if (name === 'Bash') {
    return typeof source.command === 'string' ? { command: sanitizeCommand(source.command) } : {};
  }
  if (name === 'Read' || name === 'NotebookEdit') return filePath ? { file_path: filePath } : {};
  if (name === 'Edit') {
    const body = typeof source.new_string === 'string' ? xLines(source.new_string) : undefined;
    return { file_path: filePath, new_string: body };
  }
  if (name === 'Write') {
    const body = typeof source.content === 'string' ? xLines(source.content) : undefined;
    return { file_path: filePath, content: body };
  }
  return {};
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => (block && typeof block.text === 'string' ? block.text : ''))
    .join('\n');
}

function sanitizeResult(block) {
  const text = textOf(block.content);
  const lines = xLines(text).split('\n');
  if (block.is_error === true) {
    const found = RESULT_MARKERS.filter((marker) => text.includes(marker));
    if (found.length > 0) lines[0] = found.join(' ');
  }
  const out = { type: 'tool_result', tool_use_id: block.tool_use_id, content: lines.join('\n') };
  if (block.is_error === true) out.is_error = true;
  return out;
}

function sanitizeRecord(record) {
  const content = record.message?.content;
  const blocks = Array.isArray(content) ? content.filter((b) => b && typeof b === 'object') : [];
  let next;
  if (record.type === 'assistant') {
    next = blocks
      .filter((block) => block.type === 'tool_use')
      .map((block) => ({
        type: 'tool_use',
        id: block.id,
        name: block.name,
        input: sanitizeInput(block.name, block.input),
      }));
  } else if (blocks.some((block) => block.type === 'tool_result')) {
    next = blocks.filter((block) => block.type === 'tool_result').map(sanitizeResult);
  } else {
    const text = textOf(content);
    next = isInjected(text) ? mask(text.slice(0, SCAN_CHARS)) : xLines(text);
  }
  return {
    type: record.type,
    timestamp: record.timestamp,
    message: { role: record.message?.role ?? record.type, content: next },
  };
}

function readJsonl(path) {
  const out = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (line.trim().length === 0) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      out.push(null);
    }
  }
  return out;
}

function bundleDir(ulid) {
  const name = readdirSync(join(projectRoot, LEDGER_DIR)).find((dir) => dir.endsWith(`-${ulid}`));
  if (!name) throw new Error(`no bundle ends with ${ulid}`);
  return name;
}

function windowOf(rows) {
  const stamps = rows
    .map((row) => Date.parse(row?.recorded_at ?? row?.ts ?? ''))
    .filter((at) => !Number.isNaN(at));
  if (stamps.length === 0) return null;
  return { start: Math.min(...stamps) - PAD_MS, end: Math.max(...stamps) + PAD_MS };
}

function keptRecords(records, ranges) {
  const timed = records
    .map((record, index) => ({ record, index }))
    .filter(
      ({ record }) =>
        record &&
        (record.type === 'user' || record.type === 'assistant') &&
        !Number.isNaN(Date.parse(record.timestamp ?? '')),
    );
  const inside = timed.map(({ record }) => {
    const at = Date.parse(record.timestamp);
    return ranges.some((range) => at >= range.start - MARGIN_MS && at <= range.end + MARGIN_MS);
  });
  const keep = inside.map((value, i) => value || inside[i - 1] === true || inside[i + 1] === true);
  const answered = new Set();
  timed.forEach(({ record }, i) => {
    if (!keep[i] || !Array.isArray(record.message?.content)) return;
    for (const block of record.message.content) {
      if (block?.type === 'tool_result') answered.add(block.tool_use_id);
    }
  });
  timed.forEach(({ record }, i) => {
    if (keep[i] || record.type !== 'assistant' || !Array.isArray(record.message?.content)) return;
    keep[i] = record.message.content.some(
      (block) => block?.type === 'tool_use' && answered.has(block.id),
    );
  });
  return timed.filter((_, i) => keep[i]).map(({ record }) => record);
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeJsonl(path, rows) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''),
  );
}

const ledgerOut = join(outDir, 'ledger');
const transcriptsOut = join(outDir, 'transcripts');
rmSync(ledgerOut, { recursive: true, force: true });
rmSync(transcriptsOut, { recursive: true, force: true });

const sessions = new Map();
for (const ulid of CHANGES) {
  const dir = bundleDir(ulid);
  const source = join(projectRoot, LEDGER_DIR, dir);
  const feature = JSON.parse(readFileSync(join(source, 'feature.json'), 'utf8'));
  writeJson(join(ledgerOut, dir, 'feature.json'), JSON.parse(mask(JSON.stringify(feature))));
  const rows = readJsonl(join(source, 'stage-evidence.jsonl')).filter(Boolean);
  writeJsonl(
    join(ledgerOut, dir, 'stage-evidence.jsonl'),
    rows.map((row) => JSON.parse(mask(JSON.stringify(row)))),
  );
  const range = windowOf(rows);
  if (!range) continue;
  for (const row of rows) {
    if (typeof row.session_id !== 'string' || row.session_id === 'paqad-housekeeping') continue;
    if (!sessions.has(row.session_id)) sessions.set(row.session_id, []);
    const list = sessions.get(row.session_id);
    if (!list.includes(range)) list.push(range);
  }
}

for (const [session, ranges] of sessions) {
  const files = [{ from: join(transcriptsDir, `${session}.jsonl`), to: `${session}.jsonl` }];
  const subagents = join(transcriptsDir, session, 'subagents');
  if (existsSync(subagents)) {
    for (const name of readdirSync(subagents).sort()) {
      if (name.startsWith('agent-') && name.endsWith('.jsonl')) {
        files.push({
          from: join(subagents, name),
          to: join(session, 'subagents', name),
          meta: join(subagents, name.replace(/\.jsonl$/, '.meta.json')),
        });
      }
    }
  }
  for (const file of files) {
    if (!existsSync(file.from)) continue;
    const kept = keptRecords(readJsonl(file.from), ranges).map(sanitizeRecord);
    if (kept.length === 0 && file.meta) continue;
    writeJsonl(join(transcriptsOut, file.to), kept);
    if (file.meta && existsSync(file.meta)) {
      const meta = JSON.parse(readFileSync(file.meta, 'utf8'));
      writeJson(join(transcriptsOut, file.to.replace(/\.jsonl$/, '.meta.json')), {
        agentType: meta.agentType,
      });
    }
  }
}

process.stdout.write('speed-report fixture written\n');
