import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

export const RESIDENT_AREAS = ['rules', 'stack', 'design-system', 'workflows'];

export const RULE_SLICE_PATH = join('.paqad', 'context', 'session-context.md');

export const RULE_LOADED_TEXT_MARKER = '\n## Loaded rule text';

export const ENTRY_FILE_CANDIDATES = [
  'CLAUDE.md',
  'AGENTS.md',
  'GEMINI.md',
  'ANTIGRAVITY.md',
  'CONVENTIONS.md',
  '.windsurfrules',
  join('.cursor', 'rules', 'paqad.mdc'),
  join('.junie', 'AGENTS.md'),
];

const INSTRUCTIONS_DIR = join('docs', 'instructions');

function readDirSorted(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

function readTextOrNull(abs) {
  try {
    return readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
}

function walkFiles(dir) {
  const out = [];
  for (const entry of readDirSorted(dir)) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(full));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

export function discoverFootprintFiles(projectRoot) {
  const records = [];

  for (const candidate of ENTRY_FILE_CANDIDATES) {
    const text = readTextOrNull(join(projectRoot, candidate));
    if (text !== null) {
      records.push({ area: 'entry', kind: 'entry', path: candidate, text });
      break;
    }
  }

  const slice = readTextOrNull(join(projectRoot, RULE_SLICE_PATH));
  const hasSlice = slice !== null;
  if (hasSlice) {
    const markerAt = slice.indexOf(RULE_LOADED_TEXT_MARKER);
    const manifest = markerAt >= 0 ? slice.slice(0, markerAt) : slice;
    const loaded = markerAt >= 0 ? slice.slice(markerAt) : '';
    records.push({
      area: 'rules-manifest',
      kind: 'resident',
      path: RULE_SLICE_PATH,
      text: manifest,
    });
    if (loaded.length > 0) {
      records.push({
        area: 'rules-loaded',
        kind: 'task-loaded',
        path: RULE_SLICE_PATH,
        text: loaded,
      });
    }
  }

  const instructionsAbs = join(projectRoot, INSTRUCTIONS_DIR);
  for (const entry of readDirSorted(instructionsAbs)) {
    const areaAbs = join(instructionsAbs, entry.name);
    const files = entry.isDirectory() ? walkFiles(areaAbs) : [areaAbs];
    const isNamedResident = RESIDENT_AREAS.includes(entry.name);
    const kind =
      entry.name === 'rules'
        ? hasSlice
          ? 'on-demand'
          : 'resident'
        : isNamedResident
          ? 'resident'
          : 'on-demand';
    for (const file of files) {
      const text = readTextOrNull(file);
      if (text !== null) {
        records.push({ area: entry.name, kind, path: relative(projectRoot, file), text });
      }
    }
  }

  return records;
}

export function aggregateFootprint(records, countTokens) {
  const byArea = new Map();
  for (const rec of records) {
    const chars = rec.text.length;
    const tokens = countTokens(rec.text);
    const existing = byArea.get(rec.area);
    if (existing) {
      existing.chars += chars;
      existing.tokens += tokens;
      existing.files += 1;
    } else {
      byArea.set(rec.area, { area: rec.area, kind: rec.kind, chars, tokens, files: 1 });
    }
  }

  const areas = [...byArea.values()].sort((a, b) => b.chars - a.chars);

  const sum = (predicate) =>
    areas
      .filter(predicate)
      .reduce((acc, a) => ({ chars: acc.chars + a.chars, tokens: acc.tokens + a.tokens }), {
        chars: 0,
        tokens: 0,
      });

  const resident = sum((a) => a.kind === 'entry' || a.kind === 'resident');
  const onDemand = sum((a) => a.kind === 'on-demand');
  const taskLoaded = sum((a) => a.kind === 'task-loaded');

  const manifest = areas.find((a) => a.area === 'rules-manifest');
  const fullRules = areas.find((a) => a.area === 'rules' && a.kind === 'on-demand');
  const full =
    manifest && fullRules
      ? {
          chars: resident.chars - manifest.chars + fullRules.chars,
          tokens: resident.tokens - manifest.tokens + fullRules.tokens,
        }
      : { chars: resident.chars, tokens: resident.tokens };

  const reduction = {
    chars: full.chars > 0 ? (full.chars - resident.chars) / full.chars : 0,
    tokens: full.tokens > 0 ? (full.tokens - resident.tokens) / full.tokens : 0,
  };

  return { areas, totals: { resident, onDemand, taskLoaded, full }, reduction };
}

export function formatPercent(ratio) {
  return `${Math.round(ratio * 100)}%`;
}

export function buildFootprintReport(aggregate, meta) {
  return {
    project: meta.project,
    commit: meta.commit,
    date: meta.date,
    tokenizer_version: meta.tokenizerVersion,
    areas: aggregate.areas,
    resident: aggregate.totals.resident,
    on_demand: aggregate.totals.onDemand,
    task_loaded: aggregate.totals.taskLoaded,
    full: aggregate.totals.full,
    reduction: aggregate.reduction,
  };
}

export function renderFootprintMarkdown(aggregate, meta) {
  const heuristic = meta.tokenizerVersion === 'heuristic';
  const lines = [];
  lines.push(`# Resident footprint — ${meta.project}`);
  lines.push('');
  lines.push(
    `Measured ${meta.date} at commit \`${meta.commit}\` with tokenizer \`${meta.tokenizerVersion}\`` +
      `${heuristic ? ' (char/4 heuristic — install @huggingface/transformers for exact counts)' : ''}.`,
  );
  lines.push('');
  lines.push('| Area | Load | Files | Chars | Tokens |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const area of aggregate.areas) {
    lines.push(
      `| ${area.area} | ${area.kind} | ${area.files} | ${area.chars.toLocaleString('en-US')} | ${area.tokens.toLocaleString('en-US')} |`,
    );
  }
  lines.push('');
  const { resident, taskLoaded, full } = aggregate.totals;
  lines.push(
    `**Resident at session start (manifest floor):** ${resident.tokens.toLocaleString('en-US')} tokens ` +
      `(${resident.chars.toLocaleString('en-US')} chars).`,
  );
  lines.push(
    `**Full instruction load (lean rules off):** ${full.tokens.toLocaleString('en-US')} tokens ` +
      `(${full.chars.toLocaleString('en-US')} chars).`,
  );
  lines.push(
    `**Resident vs full reduction:** ${formatPercent(aggregate.reduction.tokens)} tokens / ` +
      `${formatPercent(aggregate.reduction.chars)} chars.`,
  );
  lines.push(
    `**Task-loaded rule text (varies per session):** ${taskLoaded.tokens.toLocaleString('en-US')} tokens ` +
      `(${taskLoaded.chars.toLocaleString('en-US')} chars) — the rule bodies for the files in play when the ` +
      `slice was generated; not part of the resident floor.`,
  );
  return lines.join('\n');
}
