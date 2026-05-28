// JaCoCo XML report parser. Format reference:
//   https://www.jacoco.org/jacoco/trunk/coverage/report.dtd
//
// One CoverageRow per <sourcefile name="…">. JaCoCo reports line totals as a
// `<counter type="LINE" missed="M" covered="C"/>` element; attribute order is
// not guaranteed, so we extract `missed` and `covered` by name. The
// enclosing <package name="java/foo/bar"> is prepended so generated paths
// match `src/main/java/foo/bar/Baz.java`-shaped globs in module-map.yml.

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
