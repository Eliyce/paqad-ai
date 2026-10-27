// @paqad-rule-script
// rule_id: RL-132e
// source: docs/instructions/rules/coding/comments-and-issue-numbers.md
// kind: deterministic
// scope: changed-files
// runtime: node
// per_file: true
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const RULE_ID = 'RL-132e';
const SEV = 'high';
const MSG = 'Issue number in code or docs. Git keeps this history; remove it.';
const CODE = /\.(ts|tsx|js|jsx|mjs|cjs|sh|ps1|css)$/;
const DOC = /\.(md|yaml|yml|hbs)$/;
const DOC_ROOT = /^(docs|runtime|\.paqad\/scripts)\//;
const NEVER =
  /(^|\/)(CHANGELOG\.md$|\.changeset\/|research\/|node_modules\/|__fixtures__\/)|^\.paqad\/(decisions|ledger)\//;
const URL = /\b[a-z][a-z0-9+.-]*:\/\/[^\s)'"`<>\]]*/gi;
const IDS = /\b(RL|D|AC|INV)-[\w-]+/g;
const RULE_EXAMPLES = /`#123`|`issue 123`|`PR 123`/g;
const HASH = /(?<![\w&#])#\d{2,5}(?!\w)/g;
const KEYWORD = /\b(issues?|PR|pull)(\s+#?|\s*#)\d+(?![\w>])/gi;
const COLOUR_BEFORE = /(colou?r|fill|stroke|background|border)[^#;{}\n]{0,40}$/i;
const MAX_BYTES = 5 * 1024 * 1024;

function inScope(path) {
  if (NEVER.test(path)) return false;
  if (CODE.test(path)) return true;
  return DOC.test(path) && DOC_ROOT.test(path);
}

function blank(match) {
  return ' '.repeat(match.length);
}

function lineHasNumber(raw, isCss) {
  const line = raw.replace(URL, blank).replace(IDS, blank).replace(RULE_EXAMPLES, blank);
  KEYWORD.lastIndex = 0;
  if (KEYWORD.test(line)) return true;
  if (isCss) return false;
  HASH.lastIndex = 0;
  let m;
  while ((m = HASH.exec(line)) !== null) {
    if (!COLOUR_BEFORE.test(line.slice(0, m.index))) return true;
  }
  return false;
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
const findings = [];
for (const file of files) {
  const path = file.split('\\').join('/');
  if (!inScope(path)) continue;
  let text;
  try {
    const abs = join(projectRoot, file);
    if (statSync(abs).size > MAX_BYTES) continue;
    text = readFileSync(abs, 'utf8');
  } catch {
    continue;
  }
  const isCss = path.endsWith('.css');
  text.split('\n').forEach((line, i) => {
    if (lineHasNumber(line, isCss)) findings.push({ file, line: i + 1, message: MSG, severity: SEV });
  });
}
process.stdout.write(JSON.stringify({ rule_id: RULE_ID, kind: 'deterministic', findings }));
