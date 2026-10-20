export const PUBLIC_BARRELS = ['src/index.ts', 'src/cli/index.ts', 'src/rule-scripts/index.ts'];

export const SURFACE_DOC_PATH = 'docs/extension-surface.md';

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
