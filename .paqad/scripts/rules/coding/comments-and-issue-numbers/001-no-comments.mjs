// @paqad-rule-script
// rule_id: RL-3059
// source: docs/instructions/rules/coding/comments-and-issue-numbers.md
// kind: deterministic
// scope: changed-files
// runtime: node
// per_file: true
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';

const RULE_ID = 'RL-3059';
const SEV = 'high';
const MSG = 'Comment in code. Move the reason into docs/ and delete the comment.';
const FILTER = /\.(ts|tsx|js|jsx|mjs|cjs|sh|ps1|css)$/;
const JS_FILE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const SKIP_PATH = /(^|\/)(node_modules|__fixtures__)\//;
const DIRECTIVE =
  /^(eslint-disable|eslint-enable|@ts-expect-error|@ts-ignore|prettier-ignore|(istanbul|c8|v8) ignore|@vitest-environment|@vite-ignore)(?![\w])/;
const REFERENCE = /^\/\/\/\s*<reference\b/;
const REGEX_AFTER = new Set([
  'return',
  'typeof',
  'instanceof',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'throw',
  'case',
  'do',
  'else',
  'yield',
  'await',
]);
const MAX_BYTES = 5 * 1024 * 1024;

function loadTypeScript(projectRoot) {
  if (process.env.PAQAD_RULE_SCRIPT_NO_TYPESCRIPT === '1') return null;
  for (const base of [import.meta.url, join(projectRoot, 'package.json')]) {
    try {
      return createRequire(base)('typescript');
    } catch {}
  }
  return null;
}

function scriptKind(ts, file) {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (file.endsWith('.ts')) return ts.ScriptKind.TS;
  if (file.endsWith('.jsx')) return ts.ScriptKind.JSX;
  return ts.ScriptKind.JS;
}

function tsComments(ts, file, text) {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind(ts, file));
  const seen = new Map();
  const jsxText = new Set([ts.SyntaxKind.JsxText, ts.SyntaxKind.JsxTextAllWhiteSpaces]);
  const visit = (node) => {
    if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode) return;
    const children = node.getChildren(sf);
    if (children.length === 0) {
      if (jsxText.has(node.kind)) return;
      const ranges = [
        ...(ts.getTrailingCommentRanges(text, node.pos) ?? []),
        ...(ts.getLeadingCommentRanges(text, node.pos) ?? []),
      ];
      for (const range of ranges) {
        seen.set(range.pos, { pos: range.pos, end: range.end });
      }
      return;
    }
    for (const child of children) visit(child);
  };
  visit(sf);
  return [...seen.values()].sort((a, b) => a.pos - b.pos);
}

function jsComments(text) {
  const out = [];
  const n = text.length;
  let i = 0;
  if (text.startsWith('#!')) {
    i = text.indexOf('\n');
    if (i < 0) i = n;
  }
  let regexOk = true;
  let depth = 0;
  const templates = [];
  const readTemplate = () => {
    while (i < n) {
      const ch = text[i];
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === '`') {
        i++;
        regexOk = false;
        return;
      }
      if (ch === '$' && text[i + 1] === '{') {
        i += 2;
        templates.push(depth);
        regexOk = true;
        return;
      }
      i++;
    }
  };
  while (i < n) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '/' && next === '/') {
      let end = text.indexOf('\n', i);
      if (end < 0) end = n;
      out.push({ pos: i, end });
      i = end;
      continue;
    }
    if (ch === '/' && next === '*') {
      let end = text.indexOf('*/', i + 2);
      end = end < 0 ? n : end + 2;
      out.push({ pos: i, end });
      i = end;
      continue;
    }
    if (ch === "'" || ch === '"') {
      i++;
      while (i < n && text[i] !== ch && text[i] !== '\n') {
        if (text[i] === '\\') i++;
        i++;
      }
      i++;
      regexOk = false;
      continue;
    }
    if (ch === '`') {
      i++;
      readTemplate();
      continue;
    }
    if (ch === '/' && regexOk) {
      i++;
      let inClass = false;
      while (i < n) {
        const c = text[i];
        if (c === '\\') {
          i += 2;
          continue;
        }
        if (c === '\n') break;
        if (inClass) {
          if (c === ']') inClass = false;
        } else if (c === '[') {
          inClass = true;
        } else if (c === '/') {
          i++;
          break;
        }
        i++;
      }
      while (i < n && /[a-z]/i.test(text[i])) i++;
      regexOk = false;
      continue;
    }
    if (/[A-Za-z_$\u0080-\uffff]/.test(ch)) {
      const start = i;
      while (i < n && /[\w$\u0080-\uffff]/.test(text[i])) i++;
      regexOk = REGEX_AFTER.has(text.slice(start, i));
      continue;
    }
    if (/[0-9]/.test(ch)) {
      while (i < n && /[\w.]/.test(text[i])) i++;
      regexOk = false;
      continue;
    }
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '{') {
      depth++;
      regexOk = true;
      i++;
      continue;
    }
    if (ch === '}') {
      i++;
      if (templates.length > 0 && templates[templates.length - 1] === depth) {
        templates.pop();
        readTemplate();
        continue;
      }
      depth--;
      regexOk = false;
      continue;
    }
    regexOk = ch !== ')' && ch !== ']';
    i++;
  }
  return out;
}

function shComments(text) {
  const out = [];
  const n = text.length;
  let i = 0;
  if (text.startsWith('#!')) {
    i = text.indexOf('\n');
    if (i < 0) i = n;
  }
  let wordStart = true;
  let heredocs = [];
  while (i < n) {
    const ch = text[i];
    if (ch === '\n') {
      i++;
      wordStart = true;
      for (const doc of heredocs) {
        while (i < n) {
          let end = text.indexOf('\n', i);
          if (end < 0) end = n;
          const line = text.slice(i, end);
          i = end + 1;
          if ((doc.dash ? line.replace(/^\t+/, '') : line) === doc.tag) break;
        }
      }
      heredocs = [];
      continue;
    }
    if (ch === '\\') {
      i += 2;
      wordStart = false;
      continue;
    }
    if (ch === "'") {
      const end = text.indexOf("'", i + 1);
      i = end < 0 ? n : end + 1;
      wordStart = false;
      continue;
    }
    if (ch === '"') {
      i++;
      while (i < n && text[i] !== '"') {
        if (text[i] === '\\') i++;
        i++;
      }
      i++;
      wordStart = false;
      continue;
    }
    if (ch === '#' && wordStart) {
      let end = text.indexOf('\n', i);
      if (end < 0) end = n;
      out.push({ pos: i, end });
      i = end;
      continue;
    }
    if (ch === '<' && text[i + 1] === '<' && text[i + 2] !== '<') {
      const m = /^<<(-?)\s*(['"]?)([A-Za-z_]\w*)\2/.exec(text.slice(i, i + 200));
      if (m) {
        heredocs.push({ tag: m[3], dash: m[1] === '-' });
        i += m[0].length;
        wordStart = false;
        continue;
      }
    }
    wordStart = /[\s;&|()]/.test(ch);
    i++;
  }
  return out;
}

function psComments(text) {
  const out = [];
  const n = text.length;
  let i = 0;
  while (i < n) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '<' && next === '#') {
      let end = text.indexOf('#>', i + 2);
      end = end < 0 ? n : end + 2;
      out.push({ pos: i, end });
      i = end;
      continue;
    }
    if (ch === '#') {
      let end = text.indexOf('\n', i);
      if (end < 0) end = n;
      out.push({ pos: i, end });
      i = end;
      continue;
    }
    if (ch === '@' && (next === "'" || next === '"') && /^[ \t]*\r?\n/.test(text.slice(i + 2, i + 20))) {
      const close = text.indexOf(`\n${next}@`, i + 2);
      i = close < 0 ? n : close + 3;
      continue;
    }
    if (ch === "'") {
      i++;
      while (i < n) {
        if (text[i] === "'") {
          if (text[i + 1] === "'") {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (ch === '"') {
      i++;
      while (i < n && text[i] !== '"') {
        if (text[i] === '`') i++;
        i++;
      }
      i++;
      continue;
    }
    i++;
  }
  return out;
}

function cssComments(text) {
  const out = [];
  const n = text.length;
  let i = 0;
  while (i < n) {
    const ch = text[i];
    if (ch === '/' && text[i + 1] === '*') {
      let end = text.indexOf('*/', i + 2);
      end = end < 0 ? n : end + 2;
      out.push({ pos: i, end });
      i = end;
      continue;
    }
    if (ch === "'" || ch === '"') {
      i++;
      while (i < n && text[i] !== ch && text[i] !== '\n') {
        if (text[i] === '\\') i++;
        i++;
      }
      i++;
      continue;
    }
    i++;
  }
  return out;
}

function headerEnd(text) {
  let offset = 0;
  let marker = false;
  let ruleId = false;
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (t !== '' && !t.startsWith('//')) break;
    if (t.includes('@paqad-rule-script')) marker = true;
    if (/^\/\/\s*rule_id\s*:/.test(t)) ruleId = true;
    offset += line.length + 1;
  }
  return marker && ruleId ? offset : 0;
}

function isDirective(comment) {
  if (REFERENCE.test(comment)) return true;
  let body;
  if (comment.startsWith('//')) body = comment.slice(2);
  else if (comment.startsWith('/*')) body = comment.slice(2, comment.endsWith('*/') ? -2 : undefined);
  else if (comment.startsWith('<#')) body = comment.slice(2, -2);
  else body = comment.slice(1);
  return DIRECTIVE.test(body.replace(/^[\s*]+/, ''));
}

function commentsFor(file, text, ts) {
  if (JS_FILE.test(file)) return ts ? tsComments(ts, file, text) : jsComments(text);
  if (file.endsWith('.sh')) return shComments(text);
  if (file.endsWith('.ps1')) return psComments(text);
  return cssComments(text);
}

function lineOf(starts, pos) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= pos) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

function listTree(root) {
  try {
    const out = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.split('\0').filter(Boolean);
  } catch {
    const files = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === '.git' || entry.name === 'node_modules') continue;
        const abs = join(dir, entry.name);
        if (entry.isDirectory()) walk(abs);
        else if (entry.isFile()) files.push(relative(root, abs).split('\\').join('/'));
      }
    };
    walk(root);
    return files;
  }
}

function readInput() {
  const at = process.argv.indexOf('--whole-tree');
  if (at >= 0) {
    const projectRoot = process.argv[at + 1] ?? process.cwd();
    return { projectRoot, files: listTree(projectRoot) };
  }
  return JSON.parse(readFileSync(0, 'utf8'));
}

const { projectRoot, files } = readInput();
const ts = loadTypeScript(projectRoot);
const findings = [];
for (const file of files) {
  const path = file.split('\\').join('/');
  if (!FILTER.test(path) || SKIP_PATH.test(path)) continue;
  let text;
  try {
    const abs = join(projectRoot, file);
    if (statSync(abs).size > MAX_BYTES) continue;
    text = readFileSync(abs, 'utf8');
  } catch {
    continue;
  }
  const keepUntil = JS_FILE.test(path) ? headerEnd(text) : 0;
  const starts = [0];
  for (let k = 0; k < text.length; k++) if (text[k] === '\n') starts.push(k + 1);
  for (const c of commentsFor(path, text, ts)) {
    if (c.pos < keepUntil) continue;
    if (isDirective(text.slice(c.pos, c.end))) continue;
    findings.push({ file, line: lineOf(starts, c.pos), message: MSG, severity: SEV });
  }
}
process.stdout.write(JSON.stringify({ rule_id: RULE_ID, kind: 'deterministic', findings }));
