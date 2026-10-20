import type { ExtractionTier, SymbolKind } from './types.js';

export interface ExtractedSymbol {
  name: string;
  kind: SymbolKind;
  line: number;
  signature: string;
  exported: boolean;
  extraction_tier: ExtractionTier;
}

const TS_JS_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

export function extractSymbols(relPath: string, content: string): ExtractedSymbol[] {
  const ext = extensionOf(relPath);
  if (TS_JS_EXTENSIONS.has(ext)) {
    return extractTsJs(content, ext === '.tsx' || ext === '.jsx');
  }
  if (ext === '.php') {
    return extractPhp(content);
  }
  if (ext === '.dart') {
    return extractDart(content);
  }
  return [];
}

function extensionOf(relPath: string): string {
  const base = relPath.slice(relPath.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot).toLowerCase();
}

const FN_RE = /^export\s+(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/;
const CLASS_RE = /^export\s+(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/;
const TYPE_RE = /^export\s+(?:declare\s+)?(interface|type|enum)\s+([A-Za-z_$][\w$]*)/;
const VAR_RE = /^export\s+(?:declare\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/;
const FN_VALUE_RE =
  /=\s*(?:async\s+)?(?:function\b|(?:<[^>]*>\s*)?\([^)]*\)\s*(?::[^=]+?)?=>|[A-Za-z_$][\w$]*\s*=>)/;

function extractTsJs(content: string, jsx: boolean): ExtractedSymbol[] {
  const lines = content.split(/\r?\n/);
  const out: ExtractedSymbol[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!.trimStart();

    const fn = FN_RE.exec(line);
    if (fn) {
      out.push(makeSymbol(fn[1]!, 'function', i, signatureHead(lines, i, fn[1]!)));
      continue;
    }
    const cls = CLASS_RE.exec(line);
    if (cls) {
      out.push(makeSymbol(cls[1]!, 'class', i, signatureHead(lines, i, cls[1]!)));
      continue;
    }
    const typ = TYPE_RE.exec(line);
    if (typ) {
      out.push(makeSymbol(typ[2]!, 'type', i, `${typ[1]} ${typ[2]}`));
      continue;
    }
    const varMatch = VAR_RE.exec(line);
    if (varMatch) {
      const name = varMatch[1]!;
      const isComponent = jsx && /^[A-Z]/.test(name) && FN_VALUE_RE.test(line);
      out.push(
        makeSymbol(name, isComponent ? 'component' : 'const', i, signatureHead(lines, i, name)),
      );
      continue;
    }
  }
  return out;
}

function makeSymbol(
  name: string,
  kind: SymbolKind,
  lineIndex: number,
  signature: string,
): ExtractedSymbol {
  return {
    name,
    kind,
    line: lineIndex + 1,
    signature,
    exported: true,
    extraction_tier: 'regex',
  };
}

function signatureHead(lines: string[], startIndex: number, name: string): string {
  const joined = lines
    .slice(startIndex, startIndex + 6)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  const fromExport = joined.replace(/^export\s+(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?/, '');
  const nameAt = fromExport.indexOf(name);
  /* v8 ignore next -- nameAt is always found; the regex just matched `name` in this text */
  const fromName = nameAt >= 0 ? fromExport.slice(nameAt) : fromExport;

  let cut = fromName;
  const brace = cut.indexOf('{');
  if (brace >= 0) cut = cut.slice(0, brace);
  const arrow = cut.indexOf('=>');
  if (arrow >= 0) cut = cut.slice(0, arrow + 2);
  else {
    const eq = cut.indexOf('=');
    if (eq >= 0) cut = cut.slice(0, eq).trim();
  }
  cut = cut.replace(/[;,]\s*$/, '').trim();
  /* v8 ignore next -- a matched declaration always leaves a non-empty head */
  if (cut.length === 0) return name;
  return cut.length > 200 ? name : cut;
}

const PHP_CLASS_RE = /^\s*(?:abstract\s+|final\s+)*(?:class|interface|trait)\s+([A-Za-z_]\w*)/;
const PHP_FN_RE =
  /^\s*(?:public\s+|private\s+|protected\s+|static\s+)*function\s+([A-Za-z_]\w*)\s*\(/;

function extractPhp(content: string): ExtractedSymbol[] {
  return extractByLine(content, (line, index) => {
    const cls = PHP_CLASS_RE.exec(line);
    if (cls) return makeFileLevel(cls[1]!, 'class', index, `class ${cls[1]}`);
    const fn = PHP_FN_RE.exec(line);
    if (fn) return makeFileLevel(fn[1]!, 'function', index, fn[1]!);
    return null;
  });
}

const DART_CLASS_RE = /^\s*(?:abstract\s+)?class\s+([A-Za-z_]\w*)/;
const DART_FN_RE = /^\s*(?:[A-Za-z_][\w<>,.\s?]*\s+)?([A-Za-z_]\w*)\s*\([^)]*\)\s*(?:async\s*)?\{/;
const DART_CONTROL_KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'do']);

function extractDart(content: string): ExtractedSymbol[] {
  return extractByLine(content, (line, index) => {
    const cls = DART_CLASS_RE.exec(line);
    if (cls) return makeFileLevel(cls[1]!, 'class', index, `class ${cls[1]}`);
    const fn = DART_FN_RE.exec(line);
    if (fn && !DART_CONTROL_KEYWORDS.has(fn[1]!)) {
      return makeFileLevel(fn[1]!, 'function', index, fn[1]!);
    }
    return null;
  });
}

function extractByLine(
  content: string,
  match: (line: string, index: number) => ExtractedSymbol | null,
): ExtractedSymbol[] {
  const lines = content.split(/\r?\n/);
  const out: ExtractedSymbol[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < lines.length; i += 1) {
    const symbol = match(lines[i]!, i);
    if (symbol && !seen.has(symbol.name)) {
      seen.add(symbol.name);
      out.push(symbol);
    }
  }
  return out;
}

function makeFileLevel(
  name: string,
  kind: SymbolKind,
  lineIndex: number,
  signature: string,
): ExtractedSymbol {
  return { name, kind, line: lineIndex + 1, signature, exported: true, extraction_tier: 'regex' };
}
