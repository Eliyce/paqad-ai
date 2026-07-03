// Resident-load footprint measurement (issue #285, headline a). Pure helpers plus
// a filesystem discovery pass — no tokenizer here (the CLI injects a real one from
// src/context/tokenizer-cache.ts, or a labelled char/4 fallback). The runnable CLI
// (measure-footprint.mjs) wires these to the tokenizer and stdout.
//
// The measurement models what paqad makes the agent load at session start, per the
// framework bootstrap contract (AGENT-BOOTSTRAP.md step 2): the host entry file plus
// the rule slice, stack, design-system, and workflows areas. Everything else under
// docs/instructions is loaded on demand, not at session start, and is reported as
// such so no on-demand area is counted toward the resident number.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/** docs/instructions areas the bootstrap loads at session start (RULE-17 contract). */
export const RESIDENT_AREAS = ['rules', 'stack', 'design-system', 'workflows'];

/** Lean rule slice (#284): loaded as the rule contract instead of the full rules tree. */
export const RULE_SLICE_PATH = join('.paqad', 'context', 'session-context.md');

/**
 * Heading that separates the always-resident manifest (one capped line per rule) from
 * the task-varying loaded rule text inside the lean slice. Text before it is present
 * every session (the #284 resident floor); text from it on is the rule bodies loaded
 * for the files in play, which differs per session — so the two are measured apart and
 * only the manifest counts toward the resident headline.
 */
export const RULE_LOADED_TEXT_MARKER = '\n## Loaded rule text';

/** Host entry files any adapter may render; the first that exists is measured. */
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

/** Project-relative path to the docs/instructions root. */
const INSTRUCTIONS_DIR = join('docs', 'instructions');

/** Recursively collect every file under `dir` (absolute paths), or [] when absent. */
function walkFiles(dir) {
  if (!existsSync(dir)) {
    return [];
  }
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(full));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Discover every file that contributes to the session-start footprint of `projectRoot`.
 * Returns one record per file with its area and load kind. Read-only; tolerant of a
 * project with no entry file and no docs/instructions (returns []).
 *
 * @param {string} projectRoot
 * @returns {{area: string, kind: 'entry'|'resident'|'on-demand', path: string, text: string}[]}
 */
export function discoverFootprintFiles(projectRoot) {
  const records = [];

  // Host entry file (one, whichever adapter's file exists first).
  for (const candidate of ENTRY_FILE_CANDIDATES) {
    const abs = join(projectRoot, candidate);
    if (existsSync(abs) && statSync(abs).isFile()) {
      records.push({
        area: 'entry',
        kind: 'entry',
        path: candidate,
        text: readFileSync(abs, 'utf8'),
      });
      break;
    }
  }

  // Lean rule slice (#284) is the resident rule contract when present. Split it into
  // the always-resident manifest and the task-varying loaded rule text so only the
  // stable manifest floor counts toward the resident headline.
  const sliceAbs = join(projectRoot, RULE_SLICE_PATH);
  const hasSlice = existsSync(sliceAbs) && statSync(sliceAbs).isFile();
  if (hasSlice) {
    const slice = readFileSync(sliceAbs, 'utf8');
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

  // Every docs/instructions area. `rules` is resident only when no lean slice exists
  // (the slice replaces the full rule tree); the other named areas are always resident;
  // everything else is on-demand.
  const instructionsAbs = join(projectRoot, INSTRUCTIONS_DIR);
  if (existsSync(instructionsAbs)) {
    for (const entry of readdirSync(instructionsAbs, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
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
        records.push({
          area: entry.name,
          kind,
          path: relative(projectRoot, file),
          text: readFileSync(file, 'utf8'),
        });
      }
    }
  }

  return records;
}

/**
 * Aggregate discovered files into per-area rows and resident/full totals, counting
 * tokens with the injected `countTokens`. Pure — the CLI supplies the tokenizer.
 *
 * `resident` sums entry + resident-kind areas (what paqad adds at session start today).
 * `full` sums the same load with the full rule tree in place of the lean slice (the
 * pre-#284 "before"), so `reduction` is the honest lean-rules saving. When no lean
 * slice is present, resident == full and reduction is 0.
 *
 * @param {{area: string, kind: string, path: string, text: string}[]} records
 * @param {(text: string) => number} countTokens
 * @returns {{areas: object[], totals: object, reduction: object}}
 */
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

  // "Full" swaps the lean manifest back out for the full rule tree: resident minus the
  // manifest, plus the on-demand `rules` area (where the full tree sits once the slice is
  // present). With no slice, `rules` is already resident, so full == resident.
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

/** Format a reduction ratio as a rounded percentage string (e.g. `62%`). */
export function formatPercent(ratio) {
  return `${Math.round(ratio * 100)}%`;
}

/**
 * Build the machine-readable footprint report.
 *
 * @param {{areas: object[], totals: object, reduction: object}} aggregate
 * @param {{project: string, commit: string, tokenizerVersion: string, date: string}} meta
 */
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

/**
 * Render the footprint as a Markdown table plus a resident/full summary line.
 *
 * @param {{areas: object[], totals: object, reduction: object}} aggregate
 * @param {{project: string, commit: string, tokenizerVersion: string, date: string}} meta
 */
export function renderFootprintMarkdown(aggregate, meta) {
  const heuristic = meta.tokenizerVersion === 'heuristic';
  const lines = [];
  lines.push(`# Resident footprint — ${meta.project}`);
  lines.push('');
  lines.push(
    `Measured ${meta.date} at commit \`${meta.commit}\` with tokenizer \`${meta.tokenizerVersion}\`` +
      `${heuristic ? ' (char/4 heuristic — install @xenova/transformers for exact counts)' : ''}.`,
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
