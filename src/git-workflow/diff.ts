type Op = { kind: ' ' | '-' | '+'; line: string; a: number; b: number };

function lines(text: string): string[] {
  if (text === '') return [];
  const split = text.split('\n');
  if (split[split.length - 1] === '') split.pop();
  return split;
}

function operations(before: string[], after: string[]): Op[] {
  const n = before.length;
  const m = after.length;
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i][j] =
        before[i] === after[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && before[i] === after[j]) {
      ops.push({ kind: ' ', line: before[i], a: i, b: j });
      i += 1;
      j += 1;
    } else if (i < n && (j >= m || table[i + 1][j] >= table[i][j + 1])) {
      ops.push({ kind: '-', line: before[i], a: i, b: j });
      i += 1;
    } else {
      ops.push({ kind: '+', line: after[j], a: i, b: j });
      j += 1;
    }
  }
  return ops;
}

export function unifiedDiff(
  name: string,
  before: string | null,
  after: string,
  context = 3,
): string {
  const ops = operations(lines(before ?? ''), lines(after));
  const changed = ops.map((op, index) => (op.kind === ' ' ? -1 : index)).filter((i) => i >= 0);
  if (changed.length === 0) return '';
  const hunks: Array<[number, number]> = [];
  for (const index of changed) {
    const start = Math.max(0, index - context);
    const end = Math.min(ops.length - 1, index + context);
    const last = hunks[hunks.length - 1];
    if (last && start <= last[1] + 1) last[1] = end;
    else hunks.push([start, end]);
  }
  const out = [`--- ${before === null ? '/dev/null' : `a/${name}`}`, `+++ b/${name}`];
  for (const [start, end] of hunks) {
    const slice = ops.slice(start, end + 1);
    const aCount = slice.filter((op) => op.kind !== '+').length;
    const bCount = slice.filter((op) => op.kind !== '-').length;
    const aStart = aCount === 0 ? slice[0].a : slice[0].a + 1;
    const bStart = bCount === 0 ? slice[0].b : slice[0].b + 1;
    out.push(`@@ -${aStart},${aCount} +${bStart},${bCount} @@`);
    for (const op of slice) out.push(`${op.kind}${op.line}`);
  }
  return `${out.join('\n')}\n`;
}
