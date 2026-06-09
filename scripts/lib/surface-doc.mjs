// Shared parsing + analysis helpers for the engine extension surface contract
// (PQD-92). Pure functions only — no I/O — so they are deterministic and unit
// testable. The runnable CLIs (check-surface-orphans.mjs, check-surface-drift.mjs)
// wire these to the filesystem and git.

/** Public export barrels whose change must be mirrored in the surface document. */
export const PUBLIC_BARRELS = ['src/index.ts', 'src/cli/index.ts', 'src/rule-scripts/index.ts'];

/** Canonical location of the surface document. */
export const SURFACE_DOC_PATH = 'docs/extension-surface.md';

/**
 * Parse the canonical surface document into structured entries.
 *
 * Reads every Markdown table whose header row contains both a `Symbol` and a
 * `Stability` column. Column order is resolved from the header, so the table may
 * carry extra columns (e.g. an optional `Exempt` column) in any order.
 *
 * @param {string} markdown
 * @returns {{consumer: string, engineModule: string, symbol: string, signature: string, stability: string, since: string, exempt: string｜undefined}[]}
 */
export function parseSurfaceDoc(markdown) {
  const lines = markdown.split(/\r?\n/u);
  const entries = [];
  let columns = null;

  for (const line of lines) {
    const cells = parseTableRow(line);
    if (!cells) {
      columns = null;
      continue;
    }

    if (isSeparatorRow(cells)) {
      continue;
    }

    const header = resolveHeader(cells);
    if (header) {
      columns = header;
      continue;
    }

    if (!columns) {
      continue;
    }

    const entry = rowToEntry(cells, columns);
    if (entry) {
      entries.push(entry);
    }
  }

  return entries;
}

/**
 * Report documented entries whose symbol is not used by any known consumer.
 * Exempt entries are never reported — that is the documented escape hatch for
 * call sites static analysis cannot reach.
 *
 * @param {{symbol: string, engineModule: string, stability: string, exempt?: string}[]} entries
 * @param {Set<string>｜string[]} usedSymbols
 * @returns {{symbol: string, engineModule: string, stability: string, recommendation: string}[]}
 */
export function findOrphans(entries, usedSymbols) {
  const used = usedSymbols instanceof Set ? usedSymbols : new Set(usedSymbols);
  const orphans = [];

  for (const entry of entries) {
    if (entry.exempt) {
      continue;
    }
    if (used.has(entry.symbol)) {
      continue;
    }
    orphans.push({
      symbol: entry.symbol,
      engineModule: entry.engineModule,
      stability: entry.stability,
      recommendation:
        entry.stability === 'internal'
          ? `Remove ${entry.symbol} from ${SURFACE_DOC_PATH} — no consumer references it.`
          : `Downgrade ${entry.symbol} to "internal" or remove it from ${SURFACE_DOC_PATH} — no consumer references it.`,
    });
  }

  return orphans;
}

/**
 * Decide whether a change set drifts from the surface contract: a public barrel
 * changed without the surface document being amended in the same change set.
 *
 * @param {string[]} changedFiles paths relative to the repo root
 * @returns {{violation: boolean, changedBarrels: string[], documentAmended: boolean}}
 */
export function evaluateBarrelDrift(changedFiles) {
  const normalized = changedFiles.map(normalizeRepoPath);
  const changedBarrels = PUBLIC_BARRELS.filter((barrel) => normalized.includes(barrel));
  const documentAmended = normalized.includes(SURFACE_DOC_PATH);
  return {
    violation: changedBarrels.length > 0 && !documentAmended,
    changedBarrels,
    documentAmended,
  };
}

function parseTableRow(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|')) {
    return null;
  }
  const withoutEdges = trimmed.replace(/^\|/u, '').replace(/\|$/u, '');
  return withoutEdges.split('|').map((cell) => cell.trim());
}

function isSeparatorRow(cells) {
  return cells.every((cell) => /^:?-{1,}:?$/u.test(cell));
}

function resolveHeader(cells) {
  const normalized = cells.map((cell) => cell.toLowerCase());
  const index = (name) => normalized.indexOf(name);
  const symbol = index('symbol');
  const stability = index('stability');
  if (symbol === -1 || stability === -1) {
    return null;
  }
  return {
    consumer: index('consumer'),
    engineModule: index('engine module'),
    symbol,
    signature: index('signature'),
    stability,
    since: index('since'),
    exempt: index('exempt'),
  };
}

function rowToEntry(cells, columns) {
  const symbol = stripCode(cellAt(cells, columns.symbol));
  if (!symbol) {
    return null;
  }
  const exempt = stripCode(cellAt(cells, columns.exempt));
  return {
    consumer: stripCode(cellAt(cells, columns.consumer)),
    engineModule: stripCode(cellAt(cells, columns.engineModule)),
    symbol,
    signature: cellAt(cells, columns.signature),
    stability: stripCode(cellAt(cells, columns.stability)),
    since: stripCode(cellAt(cells, columns.since)),
    exempt: exempt === '' || exempt === '-' ? undefined : exempt,
  };
}

function cellAt(cells, index) {
  if (index === undefined || index === -1 || index >= cells.length) {
    return '';
  }
  return cells[index];
}

function stripCode(value) {
  return value.replaceAll('`', '').trim();
}

function normalizeRepoPath(filePath) {
  return filePath.replaceAll('\\', '/').replace(/^\.?\//, '');
}
