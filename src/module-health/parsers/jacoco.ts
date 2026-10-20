import type { CoverageRow, ParsedReport } from './types.js';

const PACKAGE_BLOCK = /<package\b([^>]*)>([\s\S]*?)<\/package>/g;
const SOURCEFILE_BLOCK = /<sourcefile\b([^>]*)>([\s\S]*?)<\/sourcefile>/g;
const NAME_ATTR = /\bname="([^"]+)"/;
const LINE_COUNTER_TAG = /<counter\b[^>]*\btype="LINE"[^>]*\/?>/;
const MISSED_ATTR = /\bmissed="(\d+)"/;
const COVERED_ATTR = /\bcovered="(\d+)"/;

export function parseReport(content: string): ParsedReport {
  const coverage: CoverageRow[] = [];
  for (const pkgMatch of content.matchAll(PACKAGE_BLOCK)) {
    const pkgName = (NAME_ATTR.exec(pkgMatch[1] ?? '')?.[1] ?? '').replace(/\\/g, '/');
    for (const fileMatch of (pkgMatch[2] ?? '').matchAll(SOURCEFILE_BLOCK)) {
      const fileName = NAME_ATTR.exec(fileMatch[1] ?? '')?.[1] ?? '';
      const body = fileMatch[2] ?? '';
      const counterTag = LINE_COUNTER_TAG.exec(body)?.[0] ?? '';
      const missed = Number.parseInt(MISSED_ATTR.exec(counterTag)?.[1] ?? '0', 10);
      const covered = Number.parseInt(COVERED_ATTR.exec(counterTag)?.[1] ?? '0', 10);
      coverage.push({
        file: joinPath(pkgName, fileName),
        lines_total: missed + covered,
        lines_covered: covered,
      });
    }
  }
  return { coverage };
}

function joinPath(pkg: string, file: string): string {
  if (pkg.length === 0) return file;
  if (file.length === 0) return pkg;
  return `${pkg.replace(/\.+$/, '')}/${file}`;
}
