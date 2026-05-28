// OpenCover XML coverage parser. Format reference:
//   https://github.com/OpenCover/opencover/wiki/Output-File
//
// Per <Module>: resolve fileid → fullPath from <File .../> tags, then walk
// every <SequencePoint .../> tag and bucket it by fileid. Attribute order is
// not guaranteed by the schema, so we extract each attribute by name from
// the matched tag rather than from a positional regex.

import type { CoverageRow, ParsedReport } from './types.js';

const MODULE_BLOCK = /<Module\b[^>]*>([\s\S]*?)<\/Module>/g;
const FILE_TAG = /<File\b[^>]*\/?>/g;
const SEQUENCE_POINT_TAG = /<SequencePoint\b[^>]*\/?>/g;
const UID_ATTR = /\buid="(\d+)"/;
const FULLPATH_ATTR = /\bfullPath="([^"]+)"/;
const FILEID_ATTR = /\bfileid="(\d+)"/;
const VC_ATTR = /\bvc="(\d+)"/;

export function parseReport(content: string): ParsedReport {
  const coverage: CoverageRow[] = [];
  for (const moduleMatch of content.matchAll(MODULE_BLOCK)) {
    const body = moduleMatch[1] ?? '';
    const filesById = new Map<string, string>();
    for (const fileMatch of body.matchAll(FILE_TAG)) {
      const tag = fileMatch[0];
      const uid = UID_ATTR.exec(tag)?.[1];
      const path = FULLPATH_ATTR.exec(tag)?.[1];
      if (uid && path) filesById.set(uid, path.replace(/\\/g, '/'));
    }

    const stats = new Map<string, { total: number; covered: number }>();
    for (const id of filesById.keys()) {
      stats.set(id, { total: 0, covered: 0 });
    }

    for (const spMatch of body.matchAll(SEQUENCE_POINT_TAG)) {
      const tag = spMatch[0];
      const fileId = FILEID_ATTR.exec(tag)?.[1];
      if (!fileId) continue;
      const acc = stats.get(fileId);
      if (!acc) continue;
      const vc = Number.parseInt(VC_ATTR.exec(tag)?.[1] ?? '0', 10);
      acc.total += 1;
      if (vc > 0) acc.covered += 1;
    }

    for (const [id, { total, covered }] of stats) {
      const file = filesById.get(id);
      if (!file) continue;
      coverage.push({ file, lines_total: total, lines_covered: covered });
    }
  }
  coverage.sort((a, b) => a.file.localeCompare(b.file));
  return { coverage };
}
